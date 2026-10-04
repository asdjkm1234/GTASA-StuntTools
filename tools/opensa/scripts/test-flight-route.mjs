/** Fresh ordinary headed Chrome: selected trajectory, health colors, free-only controls and GPU export. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const header =
  'local_timestamp,model,health,x,y,z,capture_elapsed_s,surface_damage_source,surface_damage_valid,plane_damage_raw,rudder_damage,elevator_l_damage,elevator_r_damage,aileron_l_damage,aileron_r_damage';
const positions = [
  [1200, -800, 400],
  [1280, -800, 415],
  [1360, -780, 435],
  [1440, -810, 420],
  [1520, -800, 410],
];
const fixture =
  '# synthetic,route_colors\n# gtasa_flight_recorder,version=12\n' +
  header +
  '\n' +
  positions
    .map((pos, i) =>
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
    )
    .join('\n');
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (/validation error|device.*lost|Invalid CommandBuffer/i.test(message.text())) errors.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) => route.fulfill({ body: fixture, contentType: 'text/csv' }));
const base = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&hour=12&weather=10';
const view = { mode: 'free', routeVisible: true, position: [1360, 610, 1180], pitch: Math.atan2(-195, 380), yaw: 0 };
async function open(query = '') {
  await page.goto(base + query);
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  if (!query.includes('videoExport=1')) await page.locator('#resetView').click();
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
}
async function raw(seconds, name) {
  const encoded = await page.evaluate(async (seconds) => {
    const bytes = await globalThis.__flightVideoExport.renderFrame(seconds);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(binary);
  }, seconds);
  const png = new PNG({ width: 1920, height: 1080 });
  png.data = Buffer.from(encoded, 'base64');
  if (name) writeFileSync('captures/flight-route-' + name + '.png', PNG.sync.write(png));
  return png.data;
}
try {
  console.log('Normal controls');
  await open();
  assert.equal(await page.locator('#flightRoute').isVisible(), false);
  assert.equal(await page.evaluate(() => globalThis.__flight.routeVisible), false);
  await page.locator('#scrub').evaluate((slider) => {
    slider.value = slider.max;
    slider.dispatchEvent(new Event('input'));
  });
  await page.locator('#freeView').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'free' && !globalThis.__flight.flyActive);
  assert.equal(await page.locator('#flightRoute').isVisible(), true);
  assert.equal(await page.locator('#flightRoute').getAttribute('aria-pressed'), 'false');
  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 6000);
  await page.locator('#flightRoute').click();
  assert.equal(await page.evaluate(() => globalThis.__flight.routeVisible), true);
  const counts = await page.evaluate(() => globalThis.__flight.routeSegments);
  for (const color of ['green', 'yellow', 'red']) assert.ok(counts[color] > 0);
  assert.equal(counts.unknown, 0);
  assert.equal(await page.locator('#flightRouteLegend').isVisible(), true);
  await page.screenshot({ path: 'captures/flight-route-headed.png' });
  await page.locator('#scrub').evaluate((slider) => {
    slider.value = '1';
    slider.dispatchEvent(new Event('input'));
  });
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.routeSegments), counts);
  await page.locator('#cockpitLook').click();
  assert.equal(await page.locator('#flightRoute').isVisible(), false);
  assert.equal(await page.locator('#flightRouteLegend').isVisible(), false);
  assert.equal(await page.evaluate(() => globalThis.__flight.routeVisible), false);
  await page.locator('#follow').click();
  assert.equal(await page.locator('#flightRoute').isVisible(), false);
  await page.locator('#freeView').click();
  assert.equal(await page.evaluate(() => globalThis.__flight.routeVisible), true);
  await page.locator('#flightRoute').click();
  assert.equal(await page.evaluate(() => globalThis.__flight.routeVisible), false);
  assert.equal(await page.locator('#flightRouteLegend').isVisible(), false);

  console.log('GPU free-view route');
  await open('&videoExport=1&exportView=' + encodeURIComponent(JSON.stringify(view)));
  await page.evaluate(() => globalThis.__flightVideoExport.ready());
  for (let i = 0; i < 3; i++) await raw(0);
  const on = await raw(0, 'colored');
  assert.equal(await page.evaluate(() => globalThis.__flight.routeVisible), true);
  await page.locator('#flightRoute').evaluate((button) => button.click());
  const off = await raw(0, 'off');
  const pixels = { green: 0, yellow: 0, red: 0 };
  for (let i = 0; i < on.length; i += 4) {
    if (Math.max(...[0, 1, 2].map((c) => Math.abs(on[i + c] - off[i + c]))) < 8) continue;
    const [r, g, b] = on.subarray(i, i + 3);
    if (g > 200 && r < 170 && b < 190) pixels.green++;
    if (r > 180 && g > 140 && b < 130) pixels.yellow++;
    if (r > 200 && g < 160 && b < 160) pixels.red++;
  }
  for (const color of ['green', 'yellow', 'red'])
    assert.ok(pixels[color] > 30, `${color} line must be visible: ${pixels[color]} pixels`);
  await page.locator('#flightRoute').evaluate((button) => button.click());
  await raw(3);
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.routeSegments), counts);
  const before = await page.evaluate(() => globalThis.__flight.cameraState);
  const unknown =
    '# synthetic,unknown_route\nlocal_timestamp,model,health,x,y,z,capture_elapsed_s\n' +
    positions.map((pos, i) => ['2026-10-03T00:00:00.000', 520, 1000, ...pos, i].join(',')).join('\n');
  await page.setInputFiles('#picker', {
    buffer: Buffer.from(unknown),
    name: 'unknown-route.csv',
    mimeType: 'text/csv',
  });
  await page.waitForFunction(() => globalThis.__flight.activeTrackIndex === 1);
  await raw(0, 'unknown');
  const unknownCounts = await page.evaluate(() => globalThis.__flight.routeSegments);
  assert.equal(unknownCounts.green, 0);
  assert.equal(unknownCounts.yellow, 0);
  assert.equal(unknownCounts.red, 0);
  assert.ok(unknownCounts.unknown > 0);
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.cameraState), before);
  await page.locator('#resetView').evaluate((button) => button.click());
  await raw(0, 'hidden-chase');
  assert.equal(await page.evaluate(() => globalThis.__flight.routeVisible), false);
  assert.deepEqual(errors, []);
  writeFileSync(
    'captures/flight-route-result.json',
    JSON.stringify({ counts, pixels, unknownCounts, errors }, null, 2),
  );
  console.log('PASS: route colors/arrows, free-only UI, selected track switching, stable geometry and GPU export');
} finally {
  await browser.close();
}
