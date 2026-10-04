/** Ordinary headed Chrome: capture-time clock controls, paused caching, and export snapshot. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const failures = [],
  report = {};
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { height: 1080, width: 1920 } });
page.on('pageerror', (error) => failures.push(error.message));
page.on('console', (message) => {
  if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(message.text()))
    failures.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) =>
  route.fulfill({
    body: readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv'),
    contentType: 'text/csv',
  }),
);
const url = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=23.5';
async function raw(seconds, label) {
  const frame = await page.evaluate(async (seconds) => {
    const bytes = await globalThis.__flightVideoExport.renderFrame(seconds);
    let binary = '';
    for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
    return btoa(binary);
  }, seconds);
  const image = new PNG({ height: 1080, width: 1920 });
  image.data = Buffer.from(frame, 'base64');
  writeFileSync(`captures/time-flow-export-${label}.png`, PNG.sync.write(image));
  return image;
}
async function ready() {
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
}
async function seek(seconds) {
  await page.locator('#scrub').evaluate((element, value) => {
    element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
  await page.waitForFunction((s) => Math.abs(globalThis.__flight.instrumentState?.s - s) < 0.002, seconds);
  return state();
}
async function slider(id, value) {
  await page.locator('#' + id).evaluate((element, value) => {
    element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function state() {
  return page.evaluate(() => {
    const effective = globalThis.__flight.envHud.match(/eff=([^,]+),([\d.-]+)/);
    return {
      flow: document.getElementById('timeFlow').checked,
      hour: Number(effective[2]),
      label: document.getElementById('hourLabel').textContent,
      renders: globalThis.__flight.renders,
      seconds: globalThis.__flight.instrumentState.s,
      skipped: globalThis.__flight.skippedFrames,
      weather: Number(effective[1]),
    };
  });
}
try {
  await page.goto(url);
  await ready();
  assert.equal((await state()).flow, false);
  assert.equal((await seek(90)).hour, 23.5, 'Default remains fixed');
  await seek(30);
  await page.locator('#timeFlow').check();
  assert.equal((await state()).hour, 23.5, 'Enabling must not jump');
  report.midnight = await seek(90);
  assert.equal(report.midnight.hour, 0.5);
  assert.equal(report.midnight.label, '00:30');
  assert.equal((await seek(0)).hour, 23, 'Scrubbing backward rewinds the same clock');
  await seek(90);
  // Let streamed cells/colliders finish after the large seek before checking cached pause.
  await page.waitForTimeout(5000);
  const paused = await state();
  await page.waitForTimeout(600);
  const stillPaused = await state();
  assert.equal(stillPaused.hour, paused.hour);
  assert.equal(stillPaused.renders, paused.renders, 'Time flow must retain paused-frame caching');
  assert(stillPaused.skipped > paused.skipped);
  await page.locator('#timeFlow').uncheck();
  assert.equal((await seek(30)).hour, 0.5, 'Disabling freezes the current hour');
  await slider('hourSlider', 6);
  await page.locator('#timeFlow').check();
  assert.equal((await seek(90)).hour, 7);
  await slider('hourSlider', 10);
  assert.equal((await seek(120)).hour, 10.5, 'Changing the slider rebases the active clock');
  await slider('weatherSlider', 8);
  assert.equal((await state()).weather, 8);
  assert.equal((await state()).flow, true, 'Changing weather does not stop the clock');
  await page.locator('#followEnv').check();
  assert.equal((await state()).flow, false);
  assert.equal((await state()).hour, 23.5);
  assert.equal((await state()).weather, 10);

  await seek(30);
  await slider('hourSlider', 17.5);
  await page.locator('#timeFlow').check();
  await page.locator('#speed').selectOption('4');
  await page.locator('#canvas').click({ position: { x: 800, y: 350 } });
  await page.keyboard.press('p');
  await page.waitForTimeout(700);
  await page.keyboard.press('p');
  report.playing = await state();
  assert(report.playing.seconds > 30.5);
  assert(Math.abs(report.playing.hour - (17.5 + (report.playing.seconds - 30) / 60)) < 0.006);
  await seek(30);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'captures/time-flow-controls.png' });
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  await page.keyboard.press('p');
  report.fullscreen = await state();
  assert(report.fullscreen.flow && report.fullscreen.seconds > 30);
  await page.evaluate(() => document.exitFullscreen());
  await seek(30);
  let request;
  await page.route('**/video-export', (route) => {
    request = route.request().postDataJSON();
    return route.fulfill({
      body: JSON.stringify({ error: 'Test captured the export request' }),
      contentType: 'application/json',
      status: 400,
    });
  });
  await page.getByRole('button', { exact: true, name: '导出 MP4' }).click();
  await page.waitForFunction(() => document.getElementById('exportNote').textContent.includes('Test captured'));
  assert.deepEqual(request.view.environment, { hour: 17.5, timeFlow: { hour: 17.5, seconds: 30 }, weather: 10 });
  report.environment = request.view.environment;
  await page.goto(url + `&videoExport=1&exportView=${encodeURIComponent(JSON.stringify(request.view))}`);
  await ready();
  await page.evaluate(() => globalThis.__flightVideoExport.ready());
  const first = await raw(30, 'start');
  assert.equal((await state()).hour, 17.5);
  await raw(90, 'one-hour');
  assert.equal((await state()).hour, 18.5);
  const repeated = await raw(30, 'repeat');
  assert.deepEqual(first.data, repeated.data, 'Export must be deterministic despite reverse frame order');
  report.encoding = await page.evaluate(async () => {
    const api = globalThis.__flightVideoExport;
    const support = await api.beginEncode(30);
    if (!support.supported) return { reason: support.reason, supported: false };
    const batch = await api.encodeFrames(900, 2);
    const tail = await api.endEncode();
    return {
      chunks: [...batch.chunks, ...tail.chunks],
      error: batch.error ?? tail.error,
      frames: tail.framesEncoded,
      supported: true,
    };
  });
  if (report.encoding.supported) {
    assert.equal(report.encoding.error, null);
    assert.equal(report.encoding.frames, 2);
    writeFileSync(
      'captures/time-flow.h264',
      Buffer.concat(report.encoding.chunks.map((chunk) => Buffer.from(chunk, 'base64'))),
    );
    const mux = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-r',
        '30',
        '-f',
        'h264',
        '-i',
        'captures/time-flow.h264',
        '-c:v',
        'copy',
        'captures/time-flow.mp4',
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(mux.status, 0, mux.stderr);
    delete report.encoding.chunks;
  }
  assert.deepEqual(failures, []);
  report.failures = failures;
  writeFileSync('captures/time-flow.json', JSON.stringify(report, null, 2));
  console.log('PASS', JSON.stringify(report));
} finally {
  await browser.close();
}
