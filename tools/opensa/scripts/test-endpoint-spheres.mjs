/** Published replay, fresh headed Chrome: spherical beacons, free-view-only visibility, real-time animation and GPU export. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const fixture = [
  '# synthetic,stationary_endpoint_beacon_animation',
  'local_timestamp,model,health,x,y,z,capture_elapsed_s',
  '2026-10-03T00:00:00.000,520,1000,1200,-800,400,0',
  '2026-10-03T00:00:08.000,520,1000,1200,-800,400,8',
].join('\n');
const failures = [];
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { height: 1080, width: 1920 } });
page.on('pageerror', (error) => failures.push(error.message));
page.on('console', (message) => {
  if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(message.text()))
    failures.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) => route.fulfill({ body: fixture, contentType: 'text/csv' }));
const base = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&hour=12&weather=10';
const view = {
  mode: 'free',
  pitch: Math.atan2(-80, Math.hypot(85, 119)),
  position: [1285, 480, 919],
  yaw: Math.atan2(-85, 119),
};

function difference(a, b, markerOnly = false) {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (
      markerOnly &&
      ![a, b].some((pixels) => pixels[i] > 110 && pixels[i] - Math.max(pixels[i + 1], pixels[i + 2]) > 50)
    )
      continue;
    if ([0, 1, 2].some((c) => a[i + c] !== b[i + c])) changed++;
  }
  return changed;
}
async function raw(seconds, name) {
  const encoded = await page.evaluate(async (seconds) => {
    const bytes = await globalThis.__flightVideoExport.renderFrame(seconds);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(binary);
  }, seconds);
  const image = new PNG({ height: 1080, width: 1920 });
  image.data = Buffer.from(encoded, 'base64');
  writeFileSync(`captures/endpoint-spheres-${name}.png`, PNG.sync.write(image));
  return image.data;
}
function redPixelCount(pixels) {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] > 110 && pixels[i] - Math.max(pixels[i + 1], pixels[i + 2]) > 50) count++;
  return count;
}
try {
  console.log('Open normal replay');
  await page.goto(base);
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.locator('#resetView').click();
  assert.equal(await page.evaluate(() => globalThis.__flight.markerCount), 1);
  assert.equal(await page.evaluate(() => globalThis.__flight.markerVisible), false);
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.markerScreenPositions), []);
  await page.screenshot({ path: 'captures/endpoint-spheres-hidden-chase.png' });
  await page.locator('#scrub').evaluate((slider) => {
    slider.value = slider.max;
    slider.dispatchEvent(new Event('input'));
  });
  await page.locator('#freeView').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'free' && !globalThis.__flight.flyActive);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  assert.equal(await page.evaluate(() => globalThis.__flight.markerVisible), true);
  // Recording remains paused at 8 s while the free-view beacon continues animating.
  const pausedSeconds = await page.locator('#scrub').inputValue();
  const startClock = await page.evaluate(() => globalThis.__flight.markerAnimationSeconds);
  const pausedStart = PNG.sync.read(await page.locator('#canvas').screenshot());
  await page.waitForTimeout(400);
  const pausedMoving = PNG.sync.read(await page.locator('#canvas').screenshot());
  assert.equal(await page.locator('#scrub').inputValue(), pausedSeconds);
  assert.ok((await page.evaluate(() => globalThis.__flight.markerAnimationSeconds)) > startClock);
  const pausedAnimatedPixels = difference(pausedStart.data, pausedMoving.data, true);
  assert.ok(pausedAnimatedPixels > 100, 'paused free view must animate the sphere');
  await page.screenshot({ path: 'captures/endpoint-spheres-ui.png' });
  // Pull back to a global overview before selecting recordings through their beacons.
  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 7500);
  await page.waitForTimeout(300);
  const overview = await page.evaluate(() => globalThis.__flight.cameraState);
  assert.ok(Math.hypot(overview.eye[0] - 1200, overview.eye[1] - 400, overview.eye[2] - 800) > 600);
  // Pick the rendered sphere centre, using the original anchor projection.
  const marker = await page.evaluate(() => globalThis.__flight.markerScreenPositions[0]);
  await page.mouse.click(box.x + marker.x, box.y + marker.y);
  assert.equal(await page.evaluate(() => globalThis.__flight.markerPickedTrackId), 0);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => globalThis.__flight.flyActive), false);
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.cameraState), overview);
  await page.screenshot({ path: 'captures/endpoint-spheres-overview-selected.png' });

  // Coincident imports still own separate markers, grow both buffers and cycle selection.
  const singleCapacity = await page.evaluate(() => globalThis.__flight.markerCapacity);
  await page.setInputFiles(
    '#picker',
    ['b', 'c'].map((name) => ({ buffer: Buffer.from(fixture), mimeType: 'text/csv', name: `sphere-${name}.csv` })),
  );
  await page.waitForFunction(() => globalThis.__flight.markerCount === 3);
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.markerTrackIds), [0, 1, 2]);
  assert.equal(await page.evaluate(() => globalThis.__flight.markerCapacity), singleCapacity * 3);
  assert.equal(await page.evaluate(() => globalThis.__flight.densityMax), 3);
  assert.equal(await page.evaluate(() => globalThis.__flight.markerHalos), 1);
  const activeBeforePick = await page.evaluate(() => globalThis.__flight.markerActiveTrackId);
  const clusterMarker = await page.evaluate(() => globalThis.__flight.markerScreenPositions[0]);
  await page.mouse.click(box.x + clusterMarker.x, box.y + clusterMarker.y);
  assert.equal(await page.evaluate(() => globalThis.__flight.markerPickedTrackId), activeBeforePick === 0 ? 1 : 0);
  await page.waitForTimeout(800);
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.cameraState), overview);
  assert.equal(await page.evaluate(() => globalThis.__flight.activeTrackIndex), activeBeforePick === 0 ? 1 : 0);
  assert.equal(await page.locator('#scrub').inputValue(), '8');
  for (
    let attempt = 0;
    attempt < 3 && (await page.evaluate(() => globalThis.__flight.activeTrackIndex)) !== 2;
    attempt++
  )
    await page.mouse.click(box.x + clusterMarker.x, box.y + clusterMarker.y);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => globalThis.__flight.activeTrackIndex), 2);
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.cameraState), overview);
  await page.screenshot({ path: 'captures/endpoint-spheres-overview-switched.png' });

  await page.locator('#cockpitLook').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'cockpit-look');
  assert.equal(await page.evaluate(() => globalThis.__flight.markerVisible), false);
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.markerScreenPositions), []);
  await page.screenshot({ path: 'captures/endpoint-spheres-hidden-cockpit-look.png' });
  const hiddenModes = [];
  for (let i = 0; i < 5; i++) {
    await page.locator('#follow').click();
    assert.equal(await page.evaluate(() => globalThis.__flight.markerVisible), false);
    hiddenModes.push(await page.evaluate(() => globalThis.__flight.cameraMode));
  }
  assert.equal(new Set(hiddenModes).size, 5);
  await page.locator('#resetView').click();
  let stable = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const before = await page.evaluate(() => globalThis.__flight.renders);
    await page.waitForTimeout(250);
    if ((await page.evaluate(() => globalThis.__flight.renders)) === before) {
      stable = true;
      break;
    }
  }
  assert.ok(stable, 'hidden markers must retain the ordinary paused-frame cache');
  await page.locator('#freeView').click();
  assert.equal(await page.evaluate(() => globalThis.__flight.markerVisible), true);
  await page.locator('#freeView').click();
  assert.equal(await page.evaluate(() => globalThis.__flight.markerVisible), false);

  console.log('Open fixed-camera export replay');
  await page.goto(`${base}&videoExport=1&exportView=${encodeURIComponent(JSON.stringify(view))}`);
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.evaluate(() => globalThis.__flightVideoExport.ready());
  await raw(0, 'warmup');
  const start = await raw(0, 'start');
  await page.waitForTimeout(400);
  const moving = await raw(0, 'moving');
  const animatedPixels = difference(start, moving, true);
  // Tiny beacons can cover fewer than 100 pixels; measure motion relative to their rendered footprint.
  assert.ok(
    animatedPixels > Math.max(1, redPixelCount(start) * 0.05),
    'same recording time must still animate in free-view export',
  );
  const beforeSeekClock = await page.evaluate(() => globalThis.__flight.markerAnimationSeconds);
  await raw(7.5, 'seek');
  const afterSeekClock = await page.evaluate(() => globalThis.__flight.markerAnimationSeconds);
  assert.ok(afterSeekClock - beforeSeekClock < 2, 'seek must not jump the beacon clock by recording seconds');
  assert.equal(await page.evaluate(() => globalThis.__flight.markerVisible), true);
  // Many recordings along one small route: 5 m endpoint spacing, previously swallowed by 20 m balls.
  await page.setInputFiles(
    '#picker',
    Array.from({ length: 48 }, (_, i) => ({
      buffer: Buffer.from(
        fixture.replaceAll('1200,-800,400', `${1200 + (i % 8) * 5},${-800 + Math.floor(i / 8) * 5},400`),
      ),
      mimeType: 'text/csv',
      name: `dense-route-${i}.csv`,
    })),
  );
  await page.waitForFunction(() => globalThis.__flight.markerCount === 49);
  const denseCount = await page.evaluate(() => globalThis.__flight.markerCount);
  assert.equal(denseCount, 49);
  assert.equal(await page.evaluate(() => globalThis.__flight.densityMax), 49);
  assert.equal(await page.evaluate(() => globalThis.__flight.markerHalos), 1);
  const densePixels = await raw(0, 'dense-route');
  const denseProjections = await page.evaluate(() => globalThis.__flight.markerScreenPositions);
  assert.equal(denseProjections.filter((point) => point.onScreen).length, 49);
  for (const point of denseProjections) {
    let red = false;
    for (let y = Math.floor(point.y) - 4; y <= Math.floor(point.y) + 4; y++)
      for (let x = Math.floor(point.x) - 4; x <= Math.floor(point.x) + 4; x++) {
        const at = (y * 1920 + x) * 4;
        if (densePixels[at] > 110 && densePixels[at] - Math.max(densePixels[at + 1], densePixels[at + 2]) > 50)
          red = true;
      }
    assert.ok(red, `dense endpoint ${point.trackIndex} must remain visible at its recorded projection`);
  }
  await page.locator('#resetView').evaluate((button) => button.click());
  await raw(0, 'hidden-export');
  assert.equal(await page.evaluate(() => globalThis.__flight.markerVisible), false);
  assert.deepEqual(failures, []);
  writeFileSync(
    'captures/endpoint-spheres.json',
    JSON.stringify({ animatedPixels, denseCount, failures, hiddenModes, overview, pausedAnimatedPixels }, null, 2),
  );
  console.log(
    `PASS: overview retained across endpoint selection, free-view-only visibility, paused animation (${pausedAnimatedPixels} pixels) and 1080p GPU export`,
  );
} finally {
  await browser.close();
}
