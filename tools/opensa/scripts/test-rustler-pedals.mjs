/** Published build, fresh ordinary headed Chrome: real Rustler + explicit synthetic pedal strokes. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const real = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260928_003025_495_m476_003.csv', 'utf8');
const lines = real.split(/\r?\n/).filter((s) => s && !s.startsWith('#'));
const source = Object.fromEntries(lines[0].split(',').map((name, i) => [name, lines[1].split(',')[i]]));
const states = ['neutral', 'left', 'right', 'unknown', 'detached', 'half-right'];
const rows = states.map((name, i) => {
  const angle = ((i === 1 ? -40 : i === 2 ? 40 : i === 5 ? 20 : 0) * Math.PI) / 180;
  const row = {
    capture_elapsed_s: i,
    forward_x: 0,
    forward_y: 1,
    forward_z: 0,
    health: 920,
    key_s: 0,
    key_w: 0,
    keyboard_state_valid: 1,
    landing_gear_status: 0,
    local_timestamp: new Date(Date.UTC(2026, 9, 3, 0, 0, i)).toISOString(),
    model: 476,
    node_status: 31,
    plane_damage_raw: i === 4 ? 2 << 8 : 0,
    right_x: 1,
    right_y: 0,
    right_z: 0,
    surface_damage_source: 'game_memory',
    surface_damage_valid: 31,
    up_x: 0,
    up_y: 0,
    up_z: 1,
    x: +source.x,
    y: +source.y,
    z: 100,
  };
  ['rudder', 'elevator_l', 'elevator_r', 'aileron_l', 'aileron_r'].forEach((surface, index) => {
    row[surface + '_damage'] = i === 4 && index === 0 ? 2 : 0;
    for (const axis of ['x', 'y', 'z', 'w'])
      row[surface + '_q' + axis] =
        index === 0 && (i === 3 || i === 4)
          ? 'nan'
          : axis === 'w'
            ? Math.cos(index === 0 ? angle / 2 : 0)
            : axis === 'z' && index === 0
              ? Math.sin(angle / 2)
              : 0;
  });
  return row;
});
const columns = ['local_timestamp', ...Object.keys(rows[0]).filter((s) => s !== 'local_timestamp')];
const fixture =
  '# gtasa_flight_recorder,version=12,sample_hz=25\n# synthetic,rustler_pedal_strokes_fixed_body\n' +
  columns.join(',') +
  '\n' +
  rows.map((r) => columns.map((s) => r[s]).join(',')).join('\n');
const base = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12';
const failures = [];
const report = { failures, motions: [] };
let browser, page;
function changed(a, b, left = 0, right = a.width) {
  let count = 0;
  for (let y = Math.floor(a.height * 0.45); y < a.height; y++)
    for (let x = left; x < right; x++) {
      const at = (y * a.width + x) * 4;
      if ([0, 1, 2].some((c) => Math.abs(a.data[at + c] - b.data[at + c]) > 8)) count++;
    }
  return count;
}
async function cockpit() {
  for (let i = 0; i < 5 && (await page.evaluate(() => globalThis.__flight.cameraMode !== 'cockpit')); i++)
    await page.locator('#follow').click();
  assert.equal(await page.evaluate(() => globalThis.__flight.cameraMode), 'cockpit');
}
async function open(csv, url = base) {
  browser = await chromium.launch({ channel: 'chrome', headless: false });
  page = await browser.newPage({ viewport: { height: 1080, width: 1920 } });
  page.on('pageerror', (e) => failures.push(e.message));
  page.on('console', (m) => {
    if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(m.text())) failures.push(m.text());
  });
  await page.route('**/local-recording/latest.csv', (r) => r.fulfill({ body: csv, contentType: 'text/csv' }));
  await page.goto(url);
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.waitForFunction(() => globalThis.__flight.pedalMotion);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
}
async function raw(s, name) {
  const encoded = await page.evaluate(async (s) => {
    const pixels = await globalThis.__flightVideoExport.renderFrame(s);
    let binary = '';
    for (let i = 0; i < pixels.length; i += 32768) binary += String.fromCharCode(...pixels.subarray(i, i + 32768));
    return btoa(binary);
  }, s);
  const image = new PNG({ height: 1080, width: 1920 });
  image.data = Buffer.from(encoded, 'base64');
  writeFileSync(`captures/rustler-pedals-${name}.png`, PNG.sync.write(image));
  return image;
}
async function seek(s) {
  await page.locator('#scrub').evaluate((e, s) => {
    e.value = String(s);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, s);
  await page.waitForFunction((s) => Math.abs(globalThis.__flight.instrumentState?.s - s) < 0.002, s);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  await page.waitForTimeout(350);
  return page.evaluate(() => globalThis.__flight.pedalMotion);
}
async function shot(name) {
  const style = await page.addStyleTag({
    content: 'body > :not(#canvas):not(script) { visibility:hidden !important; }',
  });
  const png = PNG.sync.read(await page.locator('#canvas').screenshot({ path: `captures/rustler-pedals-${name}.png` }));
  await style.evaluate((e) => e.remove());
  return png;
}
try {
  await open(real);
  await cockpit();
  report.real = await seek(10.379);
  await shot('real-default');
  await page.locator('#cockpitLook').click();
  await page.mouse.move(650, 390);
  await page.mouse.down();
  await page.mouse.move(650, 610, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await shot('real-footwell');
  await page
    .locator('#picker')
    .setInputFiles({ buffer: Buffer.from(fixture), mimeType: 'text/csv', name: 'synthetic-rustler-pedals.csv' });
  await page.locator('.track').filter({ hasText: 'synthetic-rustler-pedals.csv' }).click();
  await page.waitForFunction(
    () => document.querySelector('.track.active .track-name')?.textContent === 'synthetic-rustler-pedals.csv',
  );
  const images = [];
  for (let i = 0; i < states.length; i++) {
    report.motions.push(await seek(i));
    images.push(await shot('synthetic-' + states[i]));
  }
  assert.equal(report.motions[0].control, 0);
  assert.equal(report.motions[1].leftTravel, 0.07);
  assert.equal(report.motions[1].rightTravel, 0);
  assert.equal(report.motions[2].rightTravel, 0.07);
  assert.equal(report.motions[2].leftTravel, 0);
  for (const i of [3, 4]) assert.equal(report.motions[i].source, 'unknown');
  assert.equal(report.motions[5].rightTravel, 0.035);
  report.changed = [changed(images[0], images[1], 0, 960), changed(images[0], images[2], 960, 1920)];
  assert(
    report.changed.every((c) => c > 100),
    'Both pedal strokes must visibly change the footwell',
  );
  await seek(2);
  const still = await shot('paused');
  await page.waitForTimeout(700);
  assert.deepEqual((await shot('paused-repeat')).data, still.data);
  await seek(0);
  assert.deepEqual(await seek(2), report.motions[2]);
  assert.deepEqual((await shot('scrub-repeat')).data, still.data);
  const hydra = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv');
  await page.locator('#picker').setInputFiles({ buffer: hydra, mimeType: 'text/csv', name: 'actual-hydra-pedals.csv' });
  await page.locator('.track').filter({ hasText: 'actual-hydra-pedals.csv' }).click();
  await page.waitForFunction(() => globalThis.__flight.aircraft?.includes('hydra'));
  report.hydra = await seek(8.003);
  assert(report.hydra.rightTravel > 0 && report.hydra.leftTravel === 0);
  await browser.close();
  browser = null;
  const view = encodeURIComponent(JSON.stringify({ cockpitLookPose: { pitch: -0.65, yaw: 0 }, mode: 'cockpit-look' }));
  await open(fixture, base + `&videoExport=1&exportView=${view}`);
  await page.evaluate(() => globalThis.__flightVideoExport.ready());
  const neutral = await raw(0, 'export-neutral');
  const left = await raw(1, 'export-left');
  const right = await raw(2, 'export-right');
  assert(changed(neutral, left, 0, 960) > 100);
  assert(changed(neutral, right, 960, 1920) > 100);
  await raw(3, 'export-unknown');
  await raw(4, 'export-detached');
  assert.deepEqual((await raw(2, 'export-repeat')).data, right.data);
  await page.locator('#hourSlider').evaluate((e) => {
    e.value = '0';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const night = await raw(2, 'export-night');
  assert.notDeepEqual(night.data, right.data);
  assert.deepEqual((await raw(2, 'export-night-repeat')).data, night.data);
  assert.deepEqual(failures, []);
  writeFileSync('captures/rustler-pedals.json', JSON.stringify(report, null, 2));
  console.log(
    'PASS: Rustler pedal shape, both strokes, missing/detached, pause/scrub, Hydra and day/night GPU export',
    JSON.stringify(report),
  );
} finally {
  await browser?.close();
}
