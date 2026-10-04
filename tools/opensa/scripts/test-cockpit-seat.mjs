/** Headed Chrome with default GPU settings: observation-only transparency and export. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const before = process.argv.includes('--before');
const tag = before ? 'before' : 'fixed';
const failures = [];
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
await page.route('**/assets/flightReplay-*.js', async (route) => {
  const response = await route.fetch();
  const oldBundle = before && existsSync('captures/seat-before-bundle.js');
  let body = oldBundle ? readFileSync('captures/seat-before-bundle.js', 'utf8') : await response.text();
  if (before && !oldBundle) {
    // A fresh checkout can generate the opaque reference with the same authored geometry.
    assert(body.includes('.setCockpitLook('));
    body = body.replaceAll('.setCockpitLook(', '.setCockpitLook(false&&');
  }
  const hook = 'this.statsValue.residencyBytes=this.resources.totalBytes(),this.statsValue';
  assert(body.includes(hook));
  body = body.replace(
    hook,
    'this.statsValue.residencyBytes=this.resources.totalBytes(),globalThis.__seatEngine=this,this.statsValue',
  );
  await route.fulfill({ body, response });
});
const url = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=15';
async function raw(label, time) {
  await page.evaluate(() => globalThis.__flightVideoExport.ready());
  await page.evaluate((time) => globalThis.__flightVideoExport.renderFrame(time), time);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  const frame = await page.evaluate(async (time) => {
    const bytes = await globalThis.__flightVideoExport.renderFrame(time);
    let binary = '';
    for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
    return btoa(binary);
  }, time);
  const image = new PNG({ height: 1080, width: 1920 });
  image.data = Buffer.from(frame, 'base64');
  writeFileSync(`captures/cockpit-seat-${tag}-${label}.png`, PNG.sync.write(image));
  return image;
}
async function ready() {
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
}
async function rotate(dx, dy = 0) {
  await page.mouse.move(450, 450);
  await page.mouse.down();
  await page.mouse.move(450 + dx, 450 + dy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}
async function seatState() {
  return page.evaluate(() => {
    const model = [...globalThis.__seatEngine.vehicleModels.values()].find((model) => model.submeshes.length > 20);
    return Array.from(model.instances.find(Boolean).submeshVisible.slice(-4));
  });
}
async function seek(s) {
  await page.locator('#scrub').evaluate((element, value) => {
    element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, s);
  await page.waitForFunction((value) => Math.abs(globalThis.__flight.instrumentState?.s - value) < 0.002, s);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  await page.waitForTimeout(500);
}
async function shot(label) {
  await page.waitForTimeout(500);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  const style = await page.addStyleTag({
    content: 'body > :not(#canvas):not(script) { visibility:hidden !important; }',
  });
  const image = await page.locator('#canvas').screenshot({ path: `captures/cockpit-seat-${tag}-${label}.png` });
  await style.evaluate((element) => element.remove());
  return PNG.sync.read(image);
}
try {
  await page.goto(url);
  await ready();
  await seek(59.074);
  await shot('chase');
  if (!before) assert.deepEqual(await seatState(), [1, 1, 0, 0]);
  for (let i = 0; i < 5 && (await page.evaluate(() => globalThis.__flight.cameraMode !== 'cockpit')); i++)
    await page.locator('#follow').click();
  assert.equal(await page.evaluate(() => globalThis.__flight.cameraMode), 'cockpit');
  await shot('front');
  await page.locator('#cockpitLook').click();
  if (!before) assert.deepEqual(await seatState(), [0, 0, 1, 1]);
  await rotate(Math.PI / 0.004, (-16 * Math.PI) / 180 / 0.004);
  const back = await shot('back');
  await page.screenshot({ path: `captures/cockpit-seat-${tag}-back-ui.png` });
  const paused = await shot('paused');
  assert.deepEqual(paused.data, back.data, 'Paused observation frame stays stable');
  await page.keyboard.press('p');
  await page.waitForTimeout(400);
  await page.keyboard.press('p');
  if (!before) assert.deepEqual(await seatState(), [0, 0, 1, 1], 'Playback retains the translucent copy');
  await seek(59.074);
  await rotate(-0.5 / 0.004);
  await shot('rear-quarter');
  await page.locator('#cockpitLook').click();
  if (!before) assert.deepEqual(await seatState(), [1, 1, 0, 0], 'Leaving observation restores opaque back');
  await shot('restored-front');
  await page.locator('#follow').click();
  if (!before) assert.deepEqual(await seatState(), [1, 1, 0, 0], 'Chase stays opaque');
  for (let i = 0; i < 3; i++) await page.locator('#follow').click();
  assert.equal(await page.evaluate(() => globalThis.__flight.cameraMode), 'first-person');
  if (!before) assert.deepEqual(await seatState(), [0, 0, 0, 0], 'Whole-aircraft hiding hides both copies');
  await page.locator('#cockpitLook').click();
  if (!before)
    assert.deepEqual(
      await seatState(),
      [0, 0, 1, 1],
      'Observation after whole-aircraft hiding restores only the translucent copy',
    );
  const view = encodeURIComponent(
    JSON.stringify({ cockpitLookPose: { pitch: (8 * Math.PI) / 180, yaw: Math.PI }, mode: 'cockpit-look' }),
  );
  await page.goto(url + `&videoExport=1&exportView=${view}`);
  await ready();
  await raw('export-back-day', 59.074);
  if (!before) assert.deepEqual(await seatState(), [0, 0, 1, 1]);
  await page.goto(url.replace('hour=15', 'hour=0') + `&videoExport=1&exportView=${view}`);
  await ready();
  const night = await raw('export-back-night', 59.074);
  const again = await raw('export-back-night-repeat', 59.074);
  assert.deepEqual(night.data, again.data, 'Export is deterministic');
  assert.deepEqual(failures, []);
  const differences = {};
  if (!before && existsSync('captures/cockpit-seat-before-export-back-night.png')) {
    for (const label of [
      'chase',
      'front',
      'restored-front',
      'back',
      'rear-quarter',
      'export-back-day',
      'export-back-night',
    ]) {
      const original = PNG.sync.read(readFileSync(`captures/cockpit-seat-before-${label}.png`));
      const fixed = PNG.sync.read(readFileSync(`captures/cockpit-seat-fixed-${label}.png`));
      let changed = 0,
        max = 0;
      for (let at = 0; at < fixed.data.length; at += 4) {
        const delta = Math.max(
          ...[0, 1, 2].map((channel) => Math.abs(fixed.data[at + channel] - original.data[at + channel])),
        );
        if (delta > 2) changed++;
        max = Math.max(max, delta);
      }
      differences[label] = { changed, max };
      if (label === 'chase' || label === 'front' || label === 'restored-front')
        assert(max <= 2, 'Other views preserve the authored opaque appearance');
      else assert(changed > 10000, 'The actual image must show the translucent upper back');
    }
  }
  const report = { differences, failures, tag };
  writeFileSync(`captures/cockpit-seat-${tag}.json`, JSON.stringify(report, null, 2));
  console.log('PASS', JSON.stringify(report));
} finally {
  await browser.close();
}
