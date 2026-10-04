/** Ordinary headed Chrome, fresh profile: frame filtering, removal, undo, markers, camera and audio. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

mkdirSync('captures', { recursive: true });
function csv(frames) {
  return (
    '# synthetic,recording_removal\n# gtasa_flight_recorder,version=12\n' +
    'local_timestamp,model,health,x,y,z,capture_elapsed_s\n' +
    Array.from(
      { length: frames },
      (_, i) => `2026-10-03T00:00:00.000,520,1000,${1200 + i * 0.5},-800,400,${i / 25}`,
    ).join('\n')
  );
}
function file(name, frames) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(csv(frames)) };
}
const errors = [];
const checkpoints = {};
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (/validation error|device.*lost|Invalid CommandBuffer/i.test(message.text())) errors.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) =>
  route.fulfill({ body: csv(100), contentType: 'text/csv' }),
);
const names = () => page.locator('.track-name').allTextContents();
const activeName = () => page.locator('.track.active .track-name').textContent();
async function count(expected) {
  await page.waitForFunction((count) => document.querySelectorAll('.track').length === count, expected);
  assert.equal(await page.locator('#endpoint-list').count(), 0);
  await page.waitForFunction((count) => globalThis.__flight.markerCount === count, expected);
  assert.deepEqual(
    await page.evaluate(() => globalThis.__flight.markerTrackIds),
    Array.from({ length: expected }, (_, i) => i),
  );
}
const removeNamed = (name) =>
  page
    .locator('.track')
    .filter({ has: page.locator('.track-name', { hasText: name }) })
    .locator('.track-delete')
    .click();
async function undo() {
  await page.locator('#undoTrackRemoval').click();
}
const state = () =>
  page.evaluate(() => ({
    active: globalThis.__flight.activeTrackIndex,
    camera: globalThis.__flight.cameraState,
    clock: document.getElementById('clock').textContent,
    route: globalThis.__flight.routeSegments,
    error: globalThis.__flight.error,
  }));
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:4173/opensa/flight-replay.html?hour=12&weather=10');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.locator('#resetView').click();
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  await count(1);
  console.log('Auto filter one batch, excluding the already loaded recording');
  await page.setInputFiles('#picker', [
    file('short.csv', 5),
    file('a.csv', 100),
    file('b.csv', 110),
    file('c.csv', 1000),
  ]);
  await count(4);
  assert.deepEqual(await names(), ['最新本地记录.csv', 'a.csv', 'b.csv', 'c.csv']);
  assert.match(await page.locator('#trackNotice').textContent(), /中位数 105 帧，少于 10.5 帧/);
  assert.equal(await activeName(), 'c.csv');
  checkpoints.filtered = await state();
  await page.screenshot({ path: 'captures/recording-removal-filtered.png' });

  console.log('Beacon selection and inactive removal retain the selected flight, time, route and free camera');
  await page.locator('#scrub').evaluate((slider) => {
    slider.value = slider.max;
    slider.dispatchEvent(new Event('input'));
  });
  await page.locator('#freeView').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'free' && !globalThis.__flight.flyActive);
  const marker = await page.evaluate(() =>
    globalThis.__flight.markerScreenPositions.find((item) => item.trackIndex === 3),
  );
  const canvasBox = await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvasBox.x + marker.x, canvasBox.y + marker.y);
  assert.equal(await page.evaluate(() => globalThis.__flight.markerPickedTrackId), 3);
  await page.locator('#flightRoute').click();
  await page.locator('#scrub').evaluate((slider) => {
    slider.value = '1';
    slider.dispatchEvent(new Event('input'));
  });
  const before = await state();
  await removeNamed('a.csv');
  await count(3);
  assert.equal(await activeName(), 'c.csv');
  assert.equal((await state()).clock, before.clock);
  assert.deepEqual((await state()).camera, before.camera);
  assert.deepEqual((await state()).route, before.route);
  await removeNamed('b.csv');
  await count(2);
  assert.equal(await activeName(), 'c.csv');
  assert.equal((await state()).clock, before.clock);
  assert.deepEqual((await state()).camera, before.camera);
  await undo();
  await count(3);
  await undo();
  await count(4);
  assert.deepEqual(await names(), ['最新本地记录.csv', 'a.csv', 'b.csv', 'c.csv']);
  await undo();
  await count(5);
  assert.deepEqual(await names(), ['最新本地记录.csv', 'short.csv', 'a.csv', 'b.csv', 'c.csv']);
  assert.deepEqual((await state()).camera, before.camera);
  assert.equal((await state()).clock, before.clock);
  assert.equal(await page.locator('#undoTrackRemoval').isDisabled(), true);
  await page.locator('.track[data-i="1"] .track-select').click();
  checkpoints.undoWithAudio = await state();

  console.log('Manual frame filtering removes an active short recording and pauses its audio');
  await page.locator('#play').click();
  await page.locator('#filterShort').click();
  await count(4);
  assert.equal(await activeName(), 'a.csv');
  assert.equal(await page.locator('#play').textContent(), '▶');
  assert.deepEqual((await state()).camera, before.camera);
  await undo();
  await count(5);

  console.log('Removing all recordings clears aircraft, route, controls, markers and sound; undo works');
  while (await page.locator('.track').count()) await page.locator('.track-delete').first().click();
  await count(0);
  assert.equal(await page.evaluate(() => globalThis.__flight.activeTrackIndex), -1);
  assert.equal(await page.evaluate(() => globalThis.__flight.controlsVisible), false);
  assert.equal(await page.evaluate(() => globalThis.__flight.routeVisible), false);
  assert.equal(await page.evaluate(() => globalThis.__flight.explosionAnimating), false);
  assert.equal(await page.evaluate(() => globalThis.__flight.audioWebPlaying), false);
  assert.equal(await page.locator('#scrub').getAttribute('max'), '0');
  await page.locator('#play').click();
  assert.equal(await page.locator('#play').textContent(), '▶');
  await page.screenshot({ path: 'captures/recording-removal-empty.png' });
  await undo();
  await count(1);
  assert.equal(await activeName(), 'c.csv');
  await page.waitForFunction(() => globalThis.__flight.controls !== null);
  await page.screenshot({ path: 'captures/recording-removal-restored.png' });
  checkpoints.restoredFromEmpty = await state();

  console.log('Disabling auto filter preserves all records; single import remains intact; malformed CSV stays visible');
  await page.locator('#autoFilterShort').uncheck();
  await page.setInputFiles('#picker', [file('tiny.csv', 5), file('d.csv', 100), file('e.csv', 110)]);
  await count(4);
  assert.ok((await names()).includes('tiny.csv'));
  assert.match(await page.locator('#trackNotice').textContent(), /自动过滤已关闭/);
  await page.locator('#autoFilterShort').check();
  await page.setInputFiles('#picker', [file('single.csv', 2)]);
  await count(5);
  assert.ok((await names()).includes('single.csv'));
  assert.match(await page.locator('#trackNotice').textContent(), /不足 3 条/);
  await page.setInputFiles('#picker', [{ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('invalid') }]);
  await page.waitForFunction(() => document.getElementById('trackNotice').textContent.includes('导入失败'));
  await count(5);
  assert.match(await page.locator('#trackNotice').textContent(), /invalid.csv/);
  assert.deepEqual(errors, []);
  assert.equal((await state()).error, null);
  console.log('PASS');
} finally {
  writeFileSync('captures/recording-removal-result.json', JSON.stringify({ checkpoints, errors }, null, 2));
  await browser.close();
}
