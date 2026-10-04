/** Fixed aircraft and camera isolate the display propeller in actual GPU exports. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const real = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260928_003025_495_m476_003.csv', 'utf8');
const lines = real.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
const header = lines[0].split(',');
const template = lines[1].split(',');
const column = (name) => header.indexOf(name);
const x = Number(template[column('x')]);
const y = Number(template[column('y')]);
const z = 100;
const rows = [1000, 1000, 0, 0].map((health, seconds) => {
  const row = [...template];
  const set = (name, value) => {
    if (column(name) >= 0) row[column(name)] = String(value);
  };
  set('local_timestamp', new Date(Date.UTC(2026, 8, 30, 12, 0, seconds)).toISOString());
  set('capture_elapsed_s', seconds);
  set('z', z);
  for (const name of [
    'speed_kmh',
    'vx',
    'vy',
    'vz',
    'smoke_active',
    'node_status',
    'prop_node_status',
    'center_gear_status',
  ])
    set(name, 0);
  set('health', health);
  set('gear_status', 1);
  for (const axis of ['x', 'y', 'z']) {
    set(`right_${axis}`, axis === 'x' ? 1 : 0);
    set(`forward_${axis}`, axis === 'y' ? 1 : 0);
    set(`up_${axis}`, axis === 'z' ? 1 : 0);
  }
  return row.join(',');
});
const synthetic =
  real.split(/\r?\n/)[0] + '\n# synthetic,frozen_pose,visual_propeller\n' + [lines[0], ...rows].join('\n');
const direction = [-6, -2, 6];
const view = {
  mode: 'free',
  position: [x + 6, z + 2, -y - 8],
  yaw: Math.atan2(direction[0], -direction[2]),
  pitch: Math.atan2(direction[1], Math.hypot(direction[0], direction[2])),
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let csv = synthetic;
const failures = [];
page.on('pageerror', (e) => failures.push(e.message));
page.on('console', (m) => {
  if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(m.text())) failures.push(m.text());
});
await page.route('**/local-recording/latest.csv', (r) => r.fulfill({ contentType: 'text/csv', body: csv }));
const base = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12';
async function ready(url) {
  await page.goto(url);
  await page.waitForFunction(() => __flight?.phase === 'rendering' && __flight.aircraft.includes('rustler'), null, {
    timeout: 90000,
  });
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
}
async function frame(time, label) {
  const encoded = await page.evaluate(async (s) => {
    const pixels = await __flightVideoExport.renderFrame(s);
    let binary = '';
    for (let i = 0; i < pixels.length; i += 32768) binary += String.fromCharCode(...pixels.subarray(i, i + 32768));
    return btoa(binary);
  }, time);
  const png = new PNG({ width: 1920, height: 1080 });
  png.data = Buffer.from(encoded, 'base64');
  writeFileSync(`captures/rustler-propeller-${label}.png`, PNG.sync.write(png));
  return png;
}
function changed(a, b) {
  let count = 0;
  for (let py = 250; py < 850; py++)
    for (let px = 300; px < 1600; px++) {
      const at = (py * a.width + px) * 4;
      if (Math.max(...[0, 1, 2].map((c) => Math.abs(a.data[at + c] - b.data[at + c]))) > 20) count++;
    }
  return count;
}
try {
  await ready(base + `&videoExport=1&exportView=${encodeURIComponent(JSON.stringify(view))}`);
  await page.evaluate(() => __flightVideoExport.ready());
  const running = await frame(0, 'running');
  const advanced = await frame(0.017, 'advanced');
  const stopped = await frame(2, 'stopped');
  assert(changed(running, advanced) > 50, 'Capture-time rotation changes propeller pixels');
  assert(changed(running, stopped) > 200, 'Running disc differs from stopped blades');
  const repeat = await frame(0, 'scrub-back');
  assert.equal(changed(running, repeat), 0, 'Reverse seek restores propeller pixels');
  const paused = await frame(0, 'paused');
  assert.equal(changed(repeat, paused), 0, 'Paused time preserves the angle');
  csv = real;
  await ready(base);
  await page.locator('#scrub').evaluate((slider) => {
    slider.value = '2';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'captures/rustler-propeller-real.png' });
  assert.equal(await page.evaluate(() => __flight.error), null);
  assert.deepEqual(failures, []);
  const result = {
    rotating: changed(running, advanced),
    stopped: changed(running, stopped),
    scrub: changed(running, repeat),
    failures,
  };
  writeFileSync('captures/rustler-propeller.json', JSON.stringify(result, null, 2));
  console.log('PASS', JSON.stringify(result));
} finally {
  await browser.close();
}
