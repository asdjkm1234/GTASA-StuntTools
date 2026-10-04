/** Fresh headed Chrome without GPU flags: route click/seek, camera retention, drag and beacon arbitration. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { viewProjection } from '../apps/web/src/flight/endpoint-picking.ts';
import { gtaToEngine } from '../apps/web/src/flight/math.ts';

mkdirSync('captures', { recursive: true });
const positions = [
  [1200, -800, 400],
  [1280, -800, 415],
  [1360, -780, 435],
  [1440, -810, 420],
  [1520, -800, 410],
];
const fixture = [
  '# synthetic,route_clicks_with_measured_explosion',
  '# gtasa_flight_recorder,version=12',
  'local_timestamp,model,health,x,y,z,capture_elapsed_s,surface_damage_source,surface_damage_valid,plane_damage_raw,rudder_damage,elevator_l_damage,elevator_r_damage,aileron_l_damage,aileron_r_damage',
  ...positions.map((pos, i) =>
    [
      '2026-10-03T00:00:00.000',
      520,
      [1000, 900, 500, 200, 100][i],
      ...pos,
      i,
      'game_memory',
      31,
      i ? 65536 : 0,
      0,
      0,
      0,
      0,
      i ? 1 : 0,
    ].join(','),
  ),
  '# event,4.000000,explosion,1520,-800,410',
].join('\n');
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (/validation error|device.*lost|Invalid CommandBuffer/i.test(message.text())) errors.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) => route.fulfill({ body: fixture, contentType: 'text/csv' }));
const results = [];
async function point(segment, t) {
  const camera = await page.evaluate(() => globalThis.__flight.cameraState);
  const box = await page.locator('#canvas').boundingBox();
  const matrix = viewProjection(camera);
  const pos = gtaToEngine(...positions[segment].map((v, i) => v + (positions[segment + 1][i] - v) * t));
  const clip = [0, 1, 3].map(
    (axis) => matrix[axis] * pos[0] + matrix[axis + 4] * pos[1] + matrix[axis + 8] * pos[2] + matrix[axis + 12],
  );
  const x = box.x + ((clip[0] / clip[2] + 1) * box.width) / 2,
    y = box.y + ((1 - clip[1] / clip[2]) * box.height) / 2;
  assert.ok(
    x > 300 && x < box.width - 30 && y > 60 && y < box.height - 150,
    `click target must be clear of UI: ${x},${y}`,
  );
  return { x, y };
}
async function clickTime(segment, t, label) {
  const p = await point(segment, t);
  const before = await page.evaluate(() => ({
    camera: globalThis.__flight.cameraState,
    seeks: globalThis.__flight.seeks,
  }));
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction((seeks) => globalThis.__flight.seeks > seeks, before.seeks);
  const picked = await page.evaluate(() => globalThis.__flight.routePickedSeconds);
  assert.ok(
    picked !== null && Math.abs(picked - (segment + t)) < 0.035,
    `${label}: expected ${segment + t}, got ${picked}`,
  );
  assert.ok(Math.abs(Number(await page.locator('#scrub').inputValue()) - picked) < 0.0011);
  assert.equal(await page.locator('#play').textContent(), '▶');
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.cameraState), before.camera);
  assert.equal(await page.evaluate(() => globalThis.__flight.explosionAge), null);
  results.push({ label, expected: segment + t, picked });
}
try {
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&hour=12&weather=10');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.locator('#resetView').click();
  await page.locator('#scrub').evaluate((slider) => {
    slider.value = slider.max;
    slider.dispatchEvent(new Event('input'));
  });
  await page.locator('#freeView').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'free' && !globalThis.__flight.flyActive);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  const box = await page.locator('#canvas').boundingBox();
  // Use the free-camera drag to view the route from the side, so each tested segment spans enough pixels.
  const angles = await page.evaluate(() => {
    const { eye, target } = globalThis.__flight.cameraState;
    const [x, y, z] = target.map((value, axis) => value - eye[axis]);
    return { yaw: Math.atan2(x, -z), pitch: Math.atan2(y, Math.hypot(x, z)) };
  });
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - angles.yaw / 0.004, centre.y + (angles.pitch + 0.35) / 0.004, { steps: 10 });
  await page.mouse.up();
  await page.mouse.wheel(0, 7500);
  await page.waitForTimeout(300);
  await page.locator('#flightRoute').click();
  const counts = await page.evaluate(() => globalThis.__flight.routeSegments);
  await clickTime(1, 0.37, 'paused overview');
  await page.locator('#play').click();
  assert.equal(await page.locator('#play').textContent(), 'Ⅱ');
  await clickTime(2, 0.4, 'playing then paused');
  await page.screenshot({ path: 'captures/route-picking-overview.png' });

  // A drag returning to its starting pixel is still a drag, never a seek.
  const drag = await point(1, 0.37);
  const unchanged = await page.evaluate(() => ({
    seeks: globalThis.__flight.seeks,
    seconds: document.querySelector('#scrub').value,
  }));
  await page.mouse.move(drag.x, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.x + 40, drag.y, { steps: 5 });
  await page.mouse.move(drag.x, drag.y, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(
    await page.evaluate(() => ({ seeks: globalThis.__flight.seeks, seconds: document.querySelector('#scrub').value })),
    unchanged,
  );

  // A line near the beacon must not be swallowed by the beacon's generous hit radius.
  const near = await point(3, 0.85);
  const marker = await page.evaluate(() => globalThis.__flight.markerScreenPositions[0]);
  const distance = Math.hypot(near.x - box.x - marker.x, near.y - box.y - marker.y);
  assert.ok(distance > 3 && distance < 26, `test must exercise beacon overlap: ${distance}`);
  await clickTime(3, 0.85, 'line within beacon hit radius');
  await page.mouse.click(box.x + marker.x, box.y + marker.y);
  assert.equal(await page.evaluate(() => globalThis.__flight.markerPickedTrackId), 0);
  assert.equal(await page.locator('#scrub').inputValue(), '4');
  assert.equal(await page.evaluate(() => globalThis.__flight.routePickedSeconds), null);
  await clickTime(0, 0.6, 'rewind clears independent explosion');

  await page.locator('#flightRoute').click();
  const hidden = await point(1, 0.37);
  const seeks = await page.evaluate(() => globalThis.__flight.seeks);
  await page.mouse.click(hidden.x, hidden.y);
  assert.equal(await page.evaluate(() => globalThis.__flight.seeks), seeks);
  assert.equal(await page.evaluate(() => globalThis.__flight.routePickedSeconds), null);
  await page.locator('#flightRoute').click();
  await page.mouse.click(box.x + box.width / 2, box.y + 80); // empty sky
  assert.equal(await page.evaluate(() => globalThis.__flight.seeks), seeks);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(250);
  await clickTime(1, 0.37, 'resized CSS viewport');
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.routeSegments), counts);
  await page.screenshot({ path: 'captures/route-picking-resized.png' });
  await page.locator('#cockpitLook').click();
  const inactive = await page.evaluate(() => globalThis.__flight.seeks);
  await page.mouse.click(640, 350);
  assert.equal(await page.evaluate(() => globalThis.__flight.seeks), inactive);
  assert.equal(await page.evaluate(() => globalThis.__flight.routeVisible), false);
  assert.equal(await page.evaluate(() => globalThis.__flight.routePickedSeconds), null);
  assert.deepEqual(errors, []);
  writeFileSync(
    'captures/route-picking-result.json',
    JSON.stringify({ results, beaconOverlapDistance: distance, errors }, null, 2),
  );
  console.log(
    'PASS: route interpolation, paused/play seek, exact overview retention, drag/miss/hidden guards, beacon priority, explosion rewind and resized viewport',
    results,
  );
} finally {
  await browser.close();
}
