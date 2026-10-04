/** Normal-output cockpit-reflection A/B. Disables only the new reflection, keeping glass and wear. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const tag = process.argv[2] ?? 'canopy-reflection';
const recording = process.argv[3] ?? '../../GTA San Andreas/flight_recordings/flight_20260930_012855_010_m520_002.csv';
const aircraft = /m476|rustler/i.test(recording) ? 'rustler' : 'hydra';
const out = join(process.cwd(), 'captures');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 945 } });
let enabled = true;
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (
    /validation error|device.*lost|invalid shader|error while parsing wgsl|Invalid CommandBuffer|usage .*doesn't include/i.test(
      message.text(),
    )
  )
    errors.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) =>
  route.fulfill({ body: readFileSync(recording), contentType: 'text/csv' }),
);
await page.route('**/assets/flightReplay-*.js', async (route) => {
  const response = await route.fetch();
  let body = await response.text();
  const hook = 'let reflection = canopyReflection(in, frontFacing);';
  assert(body.includes(hook));
  if (!enabled) body = body.replace(hook, 'let reflection = vec4f(0.0);');
  await route.fulfill({ response, body });
});

function compare(a, b) {
  let max = 0,
    total = 0,
    changed = 0;
  for (let at = 0; at < a.data.length; at += 4) {
    const delta = Math.max(...[0, 1, 2].map((c) => Math.abs(a.data[at + c] - b.data[at + c])));
    max = Math.max(max, delta);
    total += delta;
    if (delta > 4) changed++;
  }

  return { max, mean: total / (a.width * a.height), changed, fraction: changed / (a.width * a.height) };
}

try {
  const report = {};
  for (const [label, yaw, pitch, hour] of [
    ['front', 0, 0, 12],
    ['up', 0.6, 0.7, 12],
    ['side', 1.1, 0, 12],
    ['night', 0.6, 0.7, 0],
  ]) {
    const shots = [];
    for (enabled of [true, false]) {
      await page.goto(`http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=${hour}`);
      await page.waitForFunction(
        (name) => globalThis.__flight?.phase === 'rendering' && globalThis.__flight?.aircraft?.includes(name),
        aircraft,
        { timeout: 90000 },
      );
      for (let i = 0; i < 3; i++) await page.locator('#follow').click();
      await page.locator('#cockpitLook').click();
      await page.mouse.move(500, 450);
      await page.mouse.down();
      await page.mouse.move(500 + yaw / 0.004, 450 - pitch / 0.004, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(2500);
      await page.addStyleTag({ content: 'body > :not(#canvas):not(script) { display:none !important; }' });
      const pixels = PNG.sync.read(
        await page.locator('#canvas').screenshot({ path: join(out, `${tag}-${label}-${enabled ? 'on' : 'off'}.png`) }),
      );
      assert(
        pixels.data.some((value, index) => index % 4 !== 3 && value > 8),
        'Black frame',
      );
      shots.push(pixels);
    }
    report[label] = compare(...shots);
    console.log(label, report[label]);
  }
  assert.deepEqual(errors, []);
  const daylight = [report.front, report.up, report.side];
  assert(
    daylight.some((view) => view.max > 4 && view.changed > 150),
    'No visible normal-output reflection',
  );
  assert(
    daylight.every((view) => view.mean < 3 && view.max < 60),
    'Reflection obscures the clear cockpit view',
  );
  assert(
    report.night.mean < 0.2 && report.night.changed < 500,
    'Unlit furniture creates conspicuous night reflections',
  );
  writeFileSync(join(out, `${tag}-ab.json`), JSON.stringify(report, null, 2));
  console.log('PASS: faint normal-output reflection, angle response, night and GPU validation');
} finally {
  await browser.close();
}
