/** Isolate the physical nozzle sweep: frozen aircraft, no sprite FX, same camera, actual GPU export. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const real = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv', 'utf8');
const lines = real.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
const header = lines[0].split(','),
  template = lines[1].split(',');
const column = (name) => header.indexOf(name);
const x = Number(template[column('x')]),
  y = Number(template[column('y')]),
  z = 100;
const rows = [0, 2500, 5000, 2500, 0].map((control, seconds) => {
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
    'health',
    'smoke_active',
    'node_status',
    'prop_node_status',
    'center_gear_status',
  ])
    set(name, 0);
  set('gear_status', 1);
  for (const axis of ['x', 'y', 'z']) {
    set(`right_${axis}`, axis === 'x' ? 1 : 0);
    set(`forward_${axis}`, axis === 'y' ? 1 : 0);
    set(`up_${axis}`, axis === 'z' ? 1 : 0);
  }
  set('nozzle_rotation', control);
  set('nozzle_rotation_previous', control);
  return row.join(',');
});
const synthetic = real.split(/\r?\n/)[0] + '\n# synthetic,frozen_pose,no_sprite_fx\n' + [lines[0], ...rows].join('\n');
const direction = [-10, -2.5, -2];
const view = {
  mode: 'free',
  position: [x + 10, z + 2.5, -y + 2.5],
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
  await page.waitForFunction(() => __flight?.phase === 'rendering' && __flight.aircraft.includes('hydra'), null, {
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
  writeFileSync(`captures/hydra-nozzles-${label}.png`, PNG.sync.write(png));
  return png;
}
function changed(a, b) {
  let count = 0;
  // Only the aircraft region: world/cloud changes cannot satisfy the nozzle assertion.
  for (let py = 330; py < 740; py++)
    for (let px = 300; px < 1600; px++) {
      const at = (py * a.width + px) * 4;
      if (Math.max(...[0, 1, 2].map((c) => Math.abs(a.data[at + c] - b.data[at + c]))) > 20) count++;
    }
  return count;
}
try {
  await ready(base + `&videoExport=1&exportView=${encodeURIComponent(JSON.stringify(view))}`);
  await page.evaluate(() => __flightVideoExport.ready());
  const forward = await frame(0, 'forward'),
    halfway = await frame(1, 'halfway'),
    down = await frame(2, 'down');
  assert(changed(forward, down) > 200, 'Physical nozzle sweep must change pixels with aircraft pose and FX frozen');
  assert(changed(forward, halfway) > 100, 'Intermediate rotation must be visible');
  const repeat = await frame(0, 'scrub-back');
  assert.equal(changed(forward, repeat), 0, 'Scrubbing back restores the nozzle geometry');
  csv = real;
  await ready(base);
  for (const time of [0.1, 6, 2]) {
    await page.locator('#scrub').evaluate((slider, s) => {
      slider.value = String(s);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `captures/hydra-nozzles-real-${time}.png` });
    assert.equal(await page.evaluate(() => __flight.error), null);
  }
  assert.deepEqual(failures, []);
  const result = {
    forwardDown: changed(forward, down),
    forwardHalfway: changed(forward, halfway),
    scrub: changed(forward, repeat),
    failures,
  };
  writeFileSync('captures/hydra-nozzles.json', JSON.stringify(result, null, 2));
  console.log('PASS', JSON.stringify(result));
} finally {
  await browser.close();
}
