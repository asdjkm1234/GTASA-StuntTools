/** Verify that both supported aircraft render using only the baked pak. */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { chromium } from 'playwright';

const recording = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(recording)) throw new Error('pass a Hydra CSV path');
const original = readFileSync(recording, 'utf8');
const rustlerRecording = process.argv[3] ? resolve(process.argv[3]) : null;
if (rustlerRecording && !existsSync(rustlerRecording)) throw new Error('Rustler CSV path does not exist');
const rustler = rustlerRecording
  ? readFileSync(rustlerRecording, 'utf8')
  : original.replace(/(^[^#\r\n][^,\r\n]*,)520,/gm, (_match, prefix) => `${prefix}476,`);
if (rustler === original) throw new Error('the CSV has no Hydra rows to use for the Rustler asset check');
const replayUrl = process.env.REPLAY_URL ?? 'http://127.0.0.1:4173/opensa/flight-replay.html';
const seek = Number(process.env.REPLAY_SEEK ?? 0);
if (!Number.isFinite(seek) || seek < 0) throw new Error('REPLAY_SEEK must be a nonnegative number');
const output = join(process.cwd(), 'captures');
mkdirSync(output, { recursive: true });
const profile = join(tmpdir(), `opensa-standalone-pak-${Date.now()}`);
const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
].find((candidate) => existsSync(candidate));
if (!chrome) throw new Error('Chrome not found');
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: chrome,
  headless: false,
  viewport: { width: 1600, height: 900 },
  args: ['--no-first-run', '--no-default-browser-check'],
});
try {
  const page = browser.pages()[0] ?? (await browser.newPage());
  await page.goto(replayUrl);
  const errors = [];
  const installRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/\/(?:game-src|gta)\//.test(new URL(request.url()).pathname)) installRequests.push(request.url());
  });
  await page.waitForFunction(() => globalThis.__flight?.worldReady, null, { timeout: 60000 });
  await page.waitForSelector('#tracks .track', { timeout: 60000 });
  for (const [model, csv, source] of [
    ['hydra', original, recording],
    ['rustler', rustler, rustlerRecording],
  ]) {
    const previousCount = await page.locator('#tracks .track').count();
    await page.setInputFiles('#picker', {
      name: source ? basename(source) : `${model}-asset-check.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await page.waitForFunction((count) => document.querySelectorAll('#tracks .track').length > count, previousCount, {
      timeout: 60000,
    });
    await page.locator('#tracks .track').last().click();
    await page.waitForFunction((name) => globalThis.__flight?.aircraft?.includes(name), model, { timeout: 60000 });
    if (seek > 0) {
      await page.evaluate((at) => {
        const scrub = document.getElementById('scrub');
        scrub.value = String(at);
        scrub.dispatchEvent(new Event('input', { bubbles: true }));
      }, seek);
    }
    if (process.env.REPLAY_FIRST_PERSON === '1') {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (await page.evaluate(() => globalThis.__flight?.cameraMode === 'first-person')) break;
        await page.click('#follow');
      }
      await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'first-person');
    }
    await page.waitForTimeout(3500);
    const shot = join(output, `standalone-pak-${model}-${basename(source ?? recording, '.csv')}.png`);
    await page.screenshot({ path: shot });
    const state = await page.evaluate(() => ({
      error: globalThis.__flight?.error,
      aircraft: globalThis.__flight?.aircraft,
      renders: globalThis.__flight?.renders,
      cells: globalThis.__flight?.cells,
      worldReady: globalThis.__flight?.worldReady,
    }));
    console.log(JSON.stringify({ model, shot, state }));
    if (state.error || !state.worldReady || state.renders < 1 || state.cells < 1 || !state.aircraft?.includes(model)) {
      throw new Error(`${model} replay failed`);
    }
    await page.click('#play');
    await page.waitForFunction(
      () => globalThis.__flight?.audioWebPlaying && globalThis.__flight?.audioWebLiveSources > 0,
      null,
      { timeout: 15000 },
    );
    const audio = await page.evaluate(() => ({
      bank: globalThis.__flight?.audioWebEngineBank,
      gain: globalThis.__flight?.audioWebEngineGain,
      samples: globalThis.__flight?.audioWebSamples,
      sources: globalThis.__flight?.audioWebLiveSources,
      state: globalThis.__flight?.audioWebState,
    }));
    console.log(JSON.stringify({ model, audio }));
    if (audio.state !== 'ready' || audio.samples !== 34 || audio.sources < 1 || audio.gain <= 0) {
      throw new Error(`${model} synthesized audio did not play`);
    }
    await page.click('#play');
    if (process.env.REPLAY_CLOSEUP === '1') {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (await page.evaluate(() => globalThis.__flight?.cameraMode === 'chase-near')) break;
        await page.click('#follow');
        await page.waitForTimeout(100);
      }
      await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'chase-near');
      await page.waitForTimeout(1200);
      const nearShot = join(output, `standalone-pak-${model}-near-${basename(recording, '.csv')}.png`);
      await page.screenshot({ path: nearShot });
      console.log(JSON.stringify({ model, nearShot }));
      for (let i = 0; i < 3; i += 1) await page.click('#follow');
      await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'first-person');
      for (let i = 0; i < 2; i += 1) await page.click('#follow');
      await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'chase-near');
      await page.waitForTimeout(500);
      const returnedShot = join(output, `standalone-pak-${model}-near-return-${basename(recording, '.csv')}.png`);
      await page.screenshot({ path: returnedShot });
      console.log(JSON.stringify({ model, returnedShot }));
    }
  }
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
  if (installRequests.length) throw new Error(`unexpected game install requests: ${installRequests.join('; ')}`);
  console.log('standalone pak: no game install requests');
} finally {
  await browser.close();
}
