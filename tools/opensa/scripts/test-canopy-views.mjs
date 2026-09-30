/** Inspect locally baked aircraft glass, including head limits and changing light. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    baseline: { type: 'boolean' },
    time: { type: 'string', default: '152.56' },
    recording: { type: 'string' },
  },
});
const tag = positionals[0] ?? 'canopy';
const baseline = values.baseline;
const aircraft = /m476|rustler/i.test(values.recording ?? '') ? 'rustler' : 'hydra';
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 945 } });
if (values.recording)
  await page.route('**/local-recording/latest.csv', (route) =>
    route.fulfill({
      body: readFileSync(values.recording),
      contentType: 'text/csv',
    }),
  );
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
page.on('console', (message) => {
  if (
    /validation error|device.*lost|invalid shader|error while parsing wgsl|Invalid CommandBuffer|usage .*doesn't include/i.test(
      message.text(),
    )
  ) {
    failures.push(message.text());
    console.error(message.text());
  }
});
const views = [
  ['front', { mode: 'cockpit-look', cockpitLookPose: { yaw: 0, pitch: 0 } }, 12],
  ['up', { mode: 'cockpit-look', cockpitLookPose: { yaw: 0.6, pitch: 0.7 } }, 12],
  ['side', { mode: 'cockpit-look', cockpitLookPose: { yaw: 1.1, pitch: 0 } }, 12],
  [
    'rear-limit',
    {
      mode: 'cockpit-look',
      cockpitLookPose: { yaw: Math.PI, pitch: 0.2, height: 0.08, longitudinal: 0.12, lateral: 0.1 },
    },
    12,
  ],
  ['sunset', { mode: 'cockpit-look', cockpitLookPose: { yaw: 0.6, pitch: 0.3 } }, 18],
  ['night', { mode: 'cockpit-look', cockpitLookPose: { yaw: 0, pitch: 0 } }, 0],
  ['cockpit', { mode: 'cockpit' }, 12],
];
const results = [];
try {
  for (const [label, view, hour] of views) {
    const query = new URLSearchParams({ local: 'latest', weather: '10', hour: String(hour) });
    await page.goto(`http://127.0.0.1:4173/opensa/flight-replay.html?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
      timeout: 90000,
    });
    assert(!(await page.evaluate(() => globalThis.__flight?.error)));
    await page.waitForFunction((name) => globalThis.__flight?.aircraft?.includes(name), aircraft, { timeout: 60000 });
    const seconds = await page.locator('#scrub').evaluate((slider, requested) => {
      const time = Math.min(requested, Number(slider.max) - 0.1);
      slider.value = String(time);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return time;
    }, Number(values.time));
    for (let index = 0; index < 3; index += 1) await page.locator('#follow').click();
    await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'cockpit');
    if (view.mode === 'cockpit-look') {
      await page.locator('#cockpitLook').click();
      const pose = view.cockpitLookPose;
      await page.mouse.move(500, 450);
      await page.mouse.down();
      await page.mouse.move(500 + pose.yaw / 0.004, 450 - pose.pitch / 0.004, { steps: 12 });
      await page.mouse.up();
      if (pose.height) {
        await page.keyboard.down('Space');
        await page.keyboard.down('s');
        await page.keyboard.down('d');
        await page.waitForTimeout(1000);
        await page.keyboard.up('Space');
        await page.keyboard.up('s');
        await page.keyboard.up('d');
      }
    }
    await page.waitForTimeout(3500);
    const debug = await page.evaluate(() => globalThis.__flight);
    assert(debug.aircraft?.includes(aircraft));
    assert.equal(debug.cameraMode, view.mode);
    if (!baseline) assert.equal(debug.cameraState.near, 0.03);
    assert(!debug.error, debug.error);
    const screenshot = join(outDir, `${tag}-${label}.png`);
    await page.addStyleTag({ content: 'body > :not(#canvas):not(script) { display: none !important; }' });
    const pixels = PNG.sync.read(await page.locator('#canvas').screenshot({ path: screenshot }));
    assert(
      pixels.data.some((value, index) => index % 4 !== 3 && value > 8),
      'The completed frame is black',
    );
    results.push({ label, seconds, camera: debug.cameraState, screenshot });
    console.log(`${label}: near=${debug.cameraState.near}, ${screenshot}`);
  }
  assert.deepEqual(failures, []);
  writeFileSync(join(outDir, `${tag}.json`), JSON.stringify(results, null, 2));
  console.log('PASS: canopy views and GPU validation');
} finally {
  await browser.close();
}
