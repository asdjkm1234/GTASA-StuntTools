/** Fresh ordinary Chrome: explicit synthetic damage/motion, real local DFF anchors, shared particle budget. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { parseDff } from '../packages/renderware/src/parsers/binary/dff.ts';
import { buildVehicleModel } from '../packages/renderware/src/vehicle/build-vehicle-model.ts';
import { VehicleTextures } from '../packages/renderware/src/vehicle/textures.ts';
import { parseFlightCsv, sampleTrack, SURFACE_NAMES } from '../apps/web/src/flight/csv.ts';
import { flightSmokeSources } from '../apps/web/src/flight/flight-smoke.ts';

mkdirSync('captures', { recursive: true });
const buf = (name) => new Uint8Array(readFileSync('map-pak/aircraft/' + name)).buffer;
const model = buildVehicleModel(parseDff(buf('hydra.dff')), new VehicleTextures([buf('hydra.txd'), buf('vehicle.txd')]), {});
function fixture(all) {
  const header = ['local_timestamp', 'model', 'health', 'x', 'y', 'z', 'capture_elapsed_s',
    'right_x', 'right_y', 'right_z', 'up_x', 'up_y', 'up_z', 'forward_x', 'forward_y', 'forward_z',
    'vx', 'vy', 'vz', 'surface_damage_valid', 'surface_damage_source', 'plane_damage_raw',
    ...SURFACE_NAMES.map((name) => name + '_damage'),
    ...SURFACE_NAMES.flatMap((name) => ['qx', 'qy', 'qz', 'qw'].map((axis) => name + '_' + axis))];
  const rows = [];
  for (let i = 0; i <= 150; i++) {
    const s = i / 25;
    const states = s < 1 ? [0, 0, 0, 0, 0] : all ? [1, 1, 1, 1, 1]
      : [0, 0, s < 4 ? 1 : 0, 0, s < 1.5 ? 0 : s < 4 ? 1 : 2];
    const raw = states.reduce((value, state, n) => value | (state << (8 + 2 * n)), 0);
    const nodes = SURFACE_NAMES.flatMap((_, n) => {
      const half = Math.sin(s * 3 + n) * 0.2;
      return n === 0 ? [0, 0, Math.sin(half), Math.cos(half)] : [Math.sin(half), 0, 0, Math.cos(half)];
    });
    rows.push(['2026-10-03T00:00:00.000', 520, s < 1 ? 1000 : 850, 1200 + s * 35, -800, 400, s,
      0, -1, 0, 0, 0, 1, 1, 0, 0, 0.7, 0, 0, 31, 'game_memory', raw, ...states, ...nodes].join(','));
  }
  return '# synthetic,node_attached_smoke_motion_and_damage\n# gtasa_flight_recorder,version=12\n' + header.join(',') + '\n' + rows.join('\n');
}
let csv = fixture(false);
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (/validation error|device.*lost|Invalid CommandBuffer/i.test(m.text())) errors.push(m.text()); });
await page.route('**/local-recording/latest.csv', (r) => r.fulfill({ body: csv, contentType: 'text/csv' }));
await page.route('**/assets/flightReplay-*.js', async (r) => {
  const response = await r.fetch();
  const body = await response.text();
  const hook = 'this.statsValue.residencyBytes=this.resources.totalBytes(),this.statsValue';
  assert.ok(body.includes(hook));
  await r.fulfill({ response, body: body.replace(hook, 'this.statsValue.residencyBytes=this.resources.totalBytes(),globalThis.__smokeEngine=this,this.statsValue') });
});
const base = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&hour=12&weather=10';
async function ready(exporting) {
  await page.goto(base + (exporting ? '&videoExport=1&exportView=' + encodeURIComponent(JSON.stringify({ mode: 'chase-far' })) : ''));
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.waitForTimeout(2500);
  if (exporting) await page.evaluate(() => globalThis.__flightVideoExport.ready());
}
async function frame(s, name) {
  const bytes = await page.evaluate(async (s) => {
    const data = await globalThis.__flightVideoExport.renderFrame(s);
    let binary = '';
    for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
    return btoa(binary);
  }, s);
  const image = new PNG({ width: 1920, height: 1080 });
  image.data = Buffer.from(bytes, 'base64');
  if (name) writeFileSync('captures/surface-smoke-' + name + '.png', PNG.sync.write(image));
  return image.data;
}
async function particles() {
  return page.evaluate(() => {
    const pool = globalThis.__smokeEngine.dynamicParticles.blend.pool;
    const rows = [];
    for (let i = 0; i < pool.count; i++) if (Math.floor(pool.data[i * 9 + 8]) === 0)
      rows.push(Array.from(pool.data.subarray(i * 9, i * 9 + 9)));
    return rows;
  });
}
function checkAnchors(rows, track) {
  const counts = {};
  for (const p of rows) {
    const born = Math.round(-p[7] * 25) / 25;
    const expected = flightSmokeSources(track, born, sampleTrack(track, born), model);
    const source = expected.find((source) => Math.hypot(...source.position.map((v, i) => v - p[i])) < 0.003);
    assert.ok(source, 'every puff must originate on a damaged node at its own birth pose: ' + born);
    counts[source.id] = (counts[source.id] ?? 0) + 1;
  }
  return counts;
}
try {
  console.log('Normal two-node replay');
  await ready(false);
  await page.locator('#scrub').evaluate((el) => { el.value = '2.5'; el.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'captures/surface-smoke-two-node-headed.png' });
  const twoTrack = parseFlightCsv(csv, 'synthetic-two-node.csv');
  const normalRows = await particles();
  assert.deepEqual(Object.keys(checkAnchors(normalRows, twoTrack)).sort(), ['2', '4']);
  console.log('Export, seek and detached stump');
  await ready(true);
  await frame(2.5);
  await frame(2.5, 'two-node');
  const rows = await particles();
  const twoCounts = checkAnchors(rows, twoTrack);
  assert.deepEqual(Object.keys(twoCounts).sort(), ['2', '4']);
  assert.ok(rows.length >= 250);
  await frame(0.5);
  assert.equal((await particles()).length, 0);
  await frame(2.5);
  assert.deepEqual(await particles(), rows);
  await frame(4.5, 'detached-stump');
  const stumpRows = await particles();
  checkAnchors(stumpRows, twoTrack);
  const newest = stumpRows.filter((p) => -p[7] > 4.47);
  assert.equal(newest.length, 4);
  const stump = flightSmokeSources(twoTrack, 4.48, sampleTrack(twoTrack, 4.48), model);
  assert.deepEqual(stump.map((s) => s.id), [4]);
  console.log('All five surfaces, bounded budget');
  csv = fixture(true);
  await ready(true);
  await frame(6);
  await frame(6, 'all-five');
  const allRows = await particles();
  const allCounts = checkAnchors(allRows, parseFlightCsv(csv, 'synthetic-all-five.csv'));
  assert.deepEqual(Object.keys(allCounts).sort(), ['0', '1', '2', '3', '4']);
  assert.ok(allRows.length < 800 && allRows.length > 500);
  assert.equal(allRows.filter((p) => -p[7] > 5.99).length, 8, 'latest smoke survives the full reconstruction window');
  assert.deepEqual(errors, []);
  const result = { fixture: 'synthetic motion/damage; real locally baked Hydra geometry', twoCounts, allCounts, allParticles: allRows.length, errors };
  writeFileSync('captures/surface-smoke-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
