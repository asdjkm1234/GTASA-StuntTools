/** Null adapters reproduce the blank page; retry must preserve an imported Rustler track and seek. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

mkdirSync('captures', { recursive: true });
const name = 'flight_20260928_003025_495_m476_003.csv';
const csv = readFileSync(`../../GTA San Andreas/flight_recordings/${name}`);
const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 911 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(() => {
    const original = navigator.gpu.requestAdapter.bind(navigator.gpu);
    globalThis.__allowAdapter = false;
    globalThis.__adapterAttempts = 0;
    navigator.gpu.requestAdapter = async (options) => {
      globalThis.__adapterAttempts++;
      return globalThis.__allowAdapter ? original(options) : null;
    };
  });
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?weather=10&hour=12');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'engine-failed');
  assert.equal(await page.evaluate(() => globalThis.__adapterAttempts), 4);
  assert(await page.locator('#renderError').isVisible(), 'Fatal errors remain independently visible');
  assert.equal(await page.locator('#right, #audioStatus').count(), 0);
  assert.match(await page.locator('#renderErrorMessage').innerText(), /未能连接显卡/);
  await page.locator('#picker').setInputFiles({ name, mimeType: 'text/csv', buffer: csv });
  await page.waitForFunction(() => document.querySelectorAll('#tracks .track').length === 1);
  for (const id of ['play', 'follow', 'freeView', 'cockpitLook', 'resetView']) await page.locator(`#${id}`).click();
  await page.locator('#scrub').evaluate((input) => {
    input.value = '10.379';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.match(await page.locator('#renderErrorMessage').innerText(), /未能连接显卡/);
  assert.match(await page.locator('#retryRenderer').innerText(), /重试初始化/);
  await page.screenshot({ path: 'captures/renderer-startup-failed.png' });
  await page.locator('#retryRenderer').click();
  await page.waitForFunction(
    () => globalThis.__flight?.phase === 'engine-failed' && globalThis.__adapterAttempts === 8,
  );
  assert.equal(await page.locator('#tracks .track').count(), 1, 'An unsuccessful retry must also retain the import');
  assert(await page.locator('#renderError').isVisible());
  await page.evaluate(() => {
    globalThis.__allowAdapter = true;
  });
  await page.locator('#retryRenderer').click();
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 90000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' && globalThis.__flight?.instrumentState);
  const state = await page.evaluate(() => ({
    trackCount: document.querySelectorAll('#tracks .track').length,
    seconds: __flight.instrumentState.s,
    aircraft: __flight.aircraft,
    renders: __flight.renders,
    gpu: __flight.gpu,
  }));
  assert.equal(state.trackCount, 1);
  assert.equal(state.seconds, 10.379);
  assert.match(state.aircraft, /rustler/);
  assert(state.renders > 0);
  assert.equal(await page.locator('#renderError').isVisible(), false);
  assert.equal(await page.locator('#audioStatus').count(), 0);
  await page.screenshot({ path: 'captures/renderer-startup-recovered.png' });
  await page.locator('#play').click();
  await page.waitForTimeout(300);
  await page.locator('#play').click();
  assert((await page.evaluate(() => __flight.instrumentState.s)) > state.seconds, 'Recovered playback advances');
  assert.deepEqual(errors, []);
  writeFileSync('captures/renderer-startup.json', JSON.stringify({ state, errors }, null, 2));
  console.log('PASS: visible adapter failure, safe controls/import, in-page retry and retained Rustler seek', state);
} finally {
  await browser.close();
}
