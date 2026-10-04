/** Normal-output sunlight/angle regression. Run with node --import tsx; uses the actual sky sun arc.
 * The off pass only removes wear, so scenery, glass tint, exposure and camera match each on pass. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

import { sunElevationAt } from '../packages/game/src/plugins/sun-position.ts';

const tag = process.argv[2] ?? 'canopy-light';
const recording = process.argv[3] ?? '../../GTA San Andreas/flight_recordings/flight_20260928_002942_500_m520_002.csv';
const seconds = Number(process.argv[4] ?? 0);
const out = join(process.cwd(), 'captures');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 945 } });
let enabled = true;
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (/validation error|invalid shader|device.*lost|error while parsing wgsl/i.test(message.text()))
    errors.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) =>
  route.fulfill({ body: readFileSync(recording), contentType: 'text/csv' }),
);
await page.route('**/assets/flightReplay-*.js', async (route) => {
  const response = await route.fetch();
  let body = await response.text();
  const hook = 'let canopyAlpha = tintAlpha;';
  assert(body.includes(hook));
  if (!enabled) body = body.replace(hook, 'wear = vec3f(0.0); ' + hook);
  await route.fulfill({ response, body });
});

async function setup(hour, pose = { yaw: 0, pitch: 0 }) {
  await page.goto(`http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=${hour}`);
  await page.waitForFunction(
    () => globalThis.__flight?.phase === 'rendering' && globalThis.__flight?.aircraft?.includes('hydra'),
    null,
    { timeout: 90000 },
  );
  await page.locator('#scrub').evaluate((slider, time) => {
    slider.value = String(time);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
  for (let i = 0; i < 3; i++) await page.locator('#follow').click();
  await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'cockpit');
  await page.locator('#cockpitLook').click();
  await page.mouse.move(500, 450);
  await page.mouse.down();
  await page.mouse.move(500 + pose.yaw / 0.004, 450 - pose.pitch / 0.004, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  return page.evaluate(() => globalThis.__flight.cameraState);
}

function difference(a, b) {
  let sum = 0,
    signal = 0,
    max = 0,
    changed = 0;
  for (let at = 0; at < a.data.length; at += 4) {
    const delta = Math.max(...[0, 1, 2].map((c) => Math.abs(a.data[at + c] - b.data[at + c])));
    sum += delta;
    signal += Math.max(delta - 2, 0);
    max = Math.max(max, delta);
    if (delta > 4) changed++;
  }
  return {
    mean: sum / (a.width * a.height),
    signal: signal / (a.width * a.height),
    max,
    changed,
    fraction: changed / (a.width * a.height),
  };
}

try {
  const camera = await setup(12);
  const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normalize = (a) => a.map((value) => value / Math.hypot(...a));
  const forward = normalize(camera.target.map((value, axis) => value - camera.eye[axis]));
  const right = normalize(cross(forward, camera.up));
  const sun = sunElevationAt(12, 6, 20).dir;
  const pose = { yaw: Math.atan2(dot(sun, right), dot(sun, forward)), pitch: Math.asin(dot(sun, camera.up)) };
  const cases = [
    ['sun', 12, pose],
    ['sun-side', 12, { yaw: pose.yaw + 0.45, pitch: pose.pitch - 0.35 }],
    ['away', 12, { yaw: pose.yaw + 1.2, pitch: 0 }],
    ['moved-sun', 7, pose],
    ['night', 0, pose],
  ];
  const report = {};
  for (const [label, hour, view] of cases) {
    const shots = [];
    for (enabled of [true, false]) {
      const state = await setup(hour, view);
      await page.addStyleTag({ content: 'body > :not(#canvas):not(script) {display:none !important;}' });
      const bytes = await page
        .locator('#canvas')
        .screenshot({ path: join(out, `${tag}-${label}-${enabled ? 'on' : 'off'}.png`) });
      shots.push(PNG.sync.read(bytes));
      if (enabled) report[label] = { hour, pose: view, camera: state };
    }
    report[label].wear = difference(shots[0], shots[1]);
    console.log(label, report[label].wear);
  }
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  assert(report.sun.wear.max >= 12 && report.sun.wear.changed > 150, 'Sunlit grooves are not visible in normal output');
  assert(
    report.sun.wear.signal > report['moved-sun'].wear.signal * 3 && report.sun.wear.signal > 0,
    'Grooves do not respond to moving sunlight at the same eye pose',
  );
  assert(report.sun.wear.signal > report.night.wear.signal * 3, 'Daylit grooves remain too bright at night');
  assert(report.sun.wear.fraction < 0.08, 'Scratches whiten a large part of the view');
  console.log('PASS: actual sunlight, curved views, light motion and night attenuation');
} finally {
  await browser.close();
}
