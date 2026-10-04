/** Published replay in ordinary headed Chrome, no GPU flags: five gauges, lamps, stick and GPU export. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const real = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260928_003025_495_m476_003.csv', 'utf8');
const lines = real.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
const source = Object.fromEntries(lines[0].split(',').map((name, i) => [name, lines[1].split(',')[i]]));
const surfaces = ['rudder', 'elevator_l', 'elevator_r', 'aileron_l', 'aileron_r'];
function synthetic() {
  const rows = Array.from({ length: 151 }, (_, i) => {
    const seconds = i * 0.04,
      phase = Math.min(5, Math.floor(seconds + 1e-8));
    const heading = [0, 90, 274, 180, 270, 359][phase],
      a = (heading * Math.PI) / 180;
    const damaged = phase === 2 || phase === 4;
    const row = {
      capture_elapsed_s: seconds,
      forward_x: Math.sin(a),
      forward_y: Math.cos(a),
      forward_z: 0,
      health: phase >= 2 ? 700 : 920,
      key_s: phase === 2 || phase === 4 ? 1 : 0,
      key_w: phase === 4 ? 1 : phase === 2 ? 0 : 1,
      keyboard_state_valid: 1,
      landing_gear_status: phase === 1 || phase === 2 ? 1 : phase === 4 ? -0.5 : 0,
      local_timestamp: new Date(Date.UTC(2026, 9, 3, 0, 0, 0, i * 40)).toISOString(),
      model: 476,
      node_status: phase === 4 ? 0 : 31,
      plane_damage_raw: damaged ? 1 << 16 : 0,
      right_x: Math.cos(a),
      right_y: -Math.sin(a),
      right_z: 0,
      surface_damage_source: phase === 3 ? 'unknown' : 'game_memory',
      surface_damage_valid: phase === 3 ? 0 : 31,
      up_x: 0,
      up_y: 0,
      up_z: 1,
      x: +source.x,
      y: +source.y + seconds * 50,
      z: 100,
    };
    surfaces.forEach((name, index) => {
      row[name + '_damage'] = damaged && index === 4 ? 1 : 0;
      const angle = (index === 0 ? 0.15 : index < 3 ? -0.25 : index === 3 ? 0.3 : -0.3) * (phase === 5 ? -1 : 1);
      for (const axis of ['x', 'y', 'z', 'w'])
        row[name + '_q' + axis] =
          phase === 4 || index === 1
            ? 'nan'
            : axis === 'w'
              ? Math.cos(angle / 2)
              : axis === (index === 0 ? 'z' : 'x')
                ? Math.sin(angle / 2)
                : 0;
    });
    return row;
  });
  // The recorder/parser require local_timestamp first, independent of object property formatting.
  const columns = ['local_timestamp', ...Object.keys(rows[0]).filter((name) => name !== 'local_timestamp')];
  return (
    '# gtasa_flight_recorder,version=12,sample_hz=25\n# synthetic,isolated_instruments_and_surface_nodes\n' +
    columns.join(',') +
    '\n' +
    rows.map((r) => columns.map((c) => r[c]).join(',')).join('\n')
  );
}
const fixture = synthetic();
const failures = [];
const base = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12';
let browser, page;
async function atlas(name) {
  const result = await page.evaluate(() => {
    const canvas = globalThis.__rustlerAtlas,
      c = canvas.getContext('2d');
    const rgb = (x, y) => Array.from(c.getImageData(x, y, 1, 1).data).slice(0, 3);
    return {
      damage: rgb(534, 603),
      gear: rgb(446, 603),
      labels: globalThis.__rustlerLabels,
      png: canvas.toDataURL().split(',')[1],
    };
  });
  writeFileSync(`captures/rustler-instruments-atlas-${name}.png`, Buffer.from(result.png, 'base64'));
  delete result.png;
  return result;
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
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype,
      clear = proto.clearRect,
      text = proto.fillText;
    proto.clearRect = function (...args) {
      if (this.canvas.width === 1024 && this.canvas.height === 1024) {
        globalThis.__rustlerAtlas = this.canvas;
        globalThis.__rustlerLabels = [];
      }
      return clear.apply(this, args);
    };
    proto.fillText = function (...args) {
      if (this.canvas === globalThis.__rustlerAtlas) globalThis.__rustlerLabels.push(args[0]);
      return text.apply(this, args);
    };
  });
  await page.route('**/local-recording/latest.csv', (r) => r.fulfill({ body: csv, contentType: 'text/csv' }));
  await page.goto(url);
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.waitForFunction(() => globalThis.__flight.instrumentUploads > 0);
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
  writeFileSync(`captures/rustler-instruments-${name}.png`, PNG.sync.write(image));
  return image;
}
async function seek(s) {
  await page.locator('#scrub').evaluate((e, s) => {
    e.value = String(s);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, s);
  await page.waitForFunction((s) => Math.abs(globalThis.__flight.instrumentState?.s - s) < 0.002, s);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  await page.waitForTimeout(300);
  return page.evaluate(() => globalThis.__flight.instrumentState);
}
async function shot(name) {
  const style = await page.addStyleTag({
    content: 'body > :not(#canvas):not(script) { visibility:hidden !important; }',
  });
  const png = PNG.sync.read(
    await page.locator('#canvas').screenshot({ path: `captures/rustler-instruments-${name}.png` }),
  );
  await style.evaluate((e) => e.remove());
  return png;
}
const report = { failures, states: [] };
try {
  await open(real);
  await cockpit();
  await seek(10.379);
  await shot('real-cockpit');
  report.realStick = await page.evaluate(() => globalThis.__flight.stickMotion);
  assert(report.realStick, 'Stock Rustler now has a replay stick');
  await page
    .locator('#picker')
    .setInputFiles({ buffer: Buffer.from(fixture), mimeType: 'text/csv', name: 'synthetic-rustler-instruments.csv' });
  await page.locator('.track').filter({ hasText: 'synthetic-rustler-instruments.csv' }).click();
  await page.waitForFunction(
    () => document.querySelector('.track.active .track-name')?.textContent === 'synthetic-rustler-instruments.csv',
  );
  await cockpit();
  for (const s of [0, 1, 2, 3, 4, 5]) {
    const state = await seek(s);
    const drawing = await atlas(String(s));
    assert(
      drawing.labels.includes('N') &&
        drawing.labels.includes('E') &&
        drawing.labels.includes('S') &&
        drawing.labels.includes('W'),
    );
    assert(!drawing.labels.includes('NOZZLE'), 'Rustler has five faces without Hydra nozzle controls');
    assert.deepEqual(drawing.gear, state.gear === 'DOWN' ? [130, 233, 163] : [24, 35, 29]);
    assert.deepEqual(drawing.damage, s === 2 || s === 4 ? [240, 183, 77] : s === 3 ? [103, 113, 109] : [24, 35, 29]);
    if (s === 4) {
      assert.equal(state.throttle, null);
      assert.equal(await page.evaluate(() => globalThis.__flight.stickMotion.available), false);
    } else assert.equal(await page.evaluate(() => globalThis.__flight.stickMotion.available), true);
    report.states.push({ drawing, state, stick: await page.evaluate(() => globalThis.__flight.stickMotion) });
    await shot('synthetic-' + s);
  }
  assert.deepEqual(
    report.states.map((r) => Math.round(r.state.heading)),
    [0, 90, 274, 180, 270, 359],
  );
  assert(Math.sign(report.states[0].stick.pitch) !== Math.sign(report.states[5].stick.pitch));
  const first = await seek(2),
    still = await shot('paused');
  const uploads = await page.evaluate(() => globalThis.__flight.instrumentUploads);
  await page.waitForTimeout(700);
  assert.equal(
    await page.evaluate(() => globalThis.__flight.instrumentUploads),
    uploads,
    'Paused atlas never uploads again',
  );
  assert.deepEqual((await shot('paused-repeat')).data, still.data);
  await seek(0);
  assert.deepEqual(await seek(2), first, 'Rewind restores identical gauge data');
  assert.deepEqual((await shot('scrub-repeat')).data, still.data);
  const hydra = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv');
  await page
    .locator('#picker')
    .setInputFiles({ buffer: hydra, mimeType: 'text/csv', name: 'actual-hydra-regression.csv' });
  await page.locator('.track').filter({ hasText: 'actual-hydra-regression.csv' }).click();
  await page.waitForFunction(() => globalThis.__flight.aircraft?.includes('hydra'));
  await cockpit();
  await seek(18.468);
  const hydraAtlas = await atlas('hydra');
  assert(hydraAtlas.labels.includes('NOZZLE') && hydraAtlas.labels.includes('LANDING GEAR'));
  assert(!hydraAtlas.labels.includes('DMG'), 'Hydra retains its existing atlas');
  await shot('hydra-regression');
  await browser.close();
  browser = null;
  const view = encodeURIComponent(JSON.stringify({ cockpitLookPose: { pitch: -0.1, yaw: 0 }, mode: 'cockpit-look' }));
  await open(fixture, base + `&videoExport=1&exportView=${view}`);
  await page.evaluate(() => globalThis.__flightVideoExport.ready());
  const frame = await raw(2, 'export-day');
  await raw(0, 'export-down');
  assert.deepEqual(
    (await raw(2, 'export-repeat')).data,
    frame.data,
    'GPU export stays deterministic after reverse seek',
  );
  const labels = await atlas('export');
  assert.deepEqual(labels.damage, [240, 183, 77]);
  assert.deepEqual(labels.gear, [24, 35, 29]);
  await page.locator('#hourSlider').evaluate((e) => {
    e.value = '0';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const night = await raw(2, 'export-night');
  assert.notDeepEqual(night.data, frame.data, 'Night environment must affect the actual frame');
  assert.deepEqual((await raw(2, 'export-night-repeat')).data, night.data);
  assert.deepEqual(failures, []);
  writeFileSync('captures/rustler-instruments.json', JSON.stringify(report, null, 2));
  console.log(
    'PASS: actual Rustler cockpit, five gauges, independent lamps, unknown data, stick motion, pause/scrub and GPU export',
  );
} finally {
  await browser?.close();
}
