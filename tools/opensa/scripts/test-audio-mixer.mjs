/** Verify the two model-specific mixer panels, live cue changes, saved values and export snapshot. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { chromium } from 'playwright';

const hydra = resolve(process.argv[2] ?? '');
const rustler = resolve(process.argv[3] ?? '');
if (!existsSync(hydra) || !existsSync(rustler)) throw new Error('pass real Hydra and Rustler CSV paths');
const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
].find((path) => existsSync(path));
if (!chrome) throw new Error('Chrome not found');
const output = join(process.cwd(), 'captures');
mkdirSync(output, { recursive: true });
const browser = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'opensa-audio-mixer-')), {
  args: ['--no-first-run', '--no-default-browser-check'],
  executablePath: chrome,
  headless: false,
  viewport: { width: 1600, height: 900 },
});

async function upload(page, path, model) {
  const count = await page.locator('#tracks .track').count();
  await page.setInputFiles('#picker', { buffer: readFileSync(path), mimeType: 'text/csv', name: basename(path) });
  await page.waitForFunction((previous) => document.querySelectorAll('#tracks .track').length > previous, count);
  await page.locator('#tracks .track').last().click();
  await page.waitForFunction((expected) => document.getElementById('audioMixerModel')?.textContent?.includes(expected), model);
}

async function setSlider(page, key, value) {
  await page.locator(`#audioTune-${key}`).evaluate((slider, next) => {
    slider.value = String(next);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  assert.equal(await page.locator(`#audioTune-${key}`).inputValue(), String(value));
}

try {
  const page = browser.pages()[0] ?? (await browser.newPage());
  await page.goto(process.env.REPLAY_URL ?? 'http://127.0.0.1:4173/opensa/flight-replay.html');
  await page.waitForFunction(() => globalThis.__flight?.worldReady, null, { timeout: 60000 });
  await page.waitForSelector('#tracks .track', { timeout: 60000 });
  await upload(page, hydra, 'Hydra');
  await page.click('#audioMixerToggle');
  assert.equal(await page.locator('#audioMixerRows input[type=range]').count(), 14);
  await setSlider(page, 'powerDynamics', 1.25);
  await setSlider(page, 'front', 0.35);
  await setSlider(page, 'presenceHighHz', 650);
  await setSlider(page, 'jetDistance', 0.25);
  await page.screenshot({ path: join(output, 'audio-mixer-hydra.png') });
  await page.click('#audioMixerCopy');
  const report = await page.locator('#audioMixerReport').inputValue();
  assert.match(report, /HARRIER_FRONT.*0\.35/);
  assert.match(report, /650 Hz/);
  assert.match(report, /jetDistance.*0\.25/);
  assert.match(report, /powerDynamics.*1\.25/);
  await page.click('#play');
  await page.waitForFunction(() => globalThis.__flight?.audioWebState === 'ready' && globalThis.__flight?.audioWebPlaying, null, { timeout: 30000 });
  await setSlider(page, 'master', 0);
  await page.waitForFunction(() => globalThis.__flight?.audioWebEngineGain === 0, null, { timeout: 10000 });
  await setSlider(page, 'master', 1);

  await upload(page, rustler, 'Rustler');
  assert.equal(await page.locator('#audioMixerRows input[type=range]').count(), 10);
  await setSlider(page, 'front', 0.6);
  await page.screenshot({ path: join(output, 'audio-mixer-rustler.png') });

  let exportRequest = null;
  await page.route('**/video-export', async (route) => {
    if (route.request().method() === 'POST') {
      exportRequest = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ body: JSON.stringify({ error: 'mixer test intercepted export' }), contentType: 'application/json', status: 400 });
    } else {
      await route.continue();
    }
  });
  await page.getByRole('button', { name: '导出 MP4' }).click();
  await page.waitForFunction(() => document.body.textContent?.includes('mixer test intercepted export'));
  assert.equal(exportRequest?.view?.audioTuning?.front, 0.6);
  await page.reload();
  await page.waitForFunction(() => globalThis.__flight?.worldReady, null, { timeout: 60000 });
  await page.waitForSelector('#tracks .track', { timeout: 60000 });
  await upload(page, hydra, 'Hydra');
  assert.equal(await page.locator('#audioTune-front').inputValue(), '0.35');
  assert.equal(await page.locator('#audioTune-powerDynamics').inputValue(), '1.25');
  await upload(page, rustler, 'Rustler');
  assert.equal(await page.locator('#audioTune-front').inputValue(), '0.6');
  console.log(JSON.stringify({ hydraSliders: 14, rustlerSliders: 10, exportedFront: 0.6, saved: true, liveGainUpdated: true }));
} finally {
  await browser.close();
}
