/** Render a fixed exterior close-up of a locally baked canopy from the completed export surface. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 911 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (/validation error|invalid shader|device.*lost|error while parsing wgsl/i.test(message.text()))
    errors.push(message.text());
});
const recording = process.argv[3];
const aircraft = /m476|rustler/i.test(recording ?? '') ? 'rustler' : 'hydra';
if (recording)
  await page.route('**/local-recording/latest.csv', (route) =>
    route.fulfill({
      body: readFileSync(recording),
      contentType: 'text/csv',
    }),
  );

try {
  await page.goto(`${origin}/opensa/flight-replay.html?local=latest`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (name) => globalThis.__flight?.worldReady && globalThis.__flight?.aircraft?.includes(name),
    aircraft,
    {
      timeout: 90000,
    },
  );
  for (let index = 0; index < 3; index += 1) await page.locator('#follow').click();
  await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'cockpit');
  const cockpit = await page.evaluate(() => globalThis.__flight.cameraState);
  assert(cockpit);
  const forward = cockpit.target.map((value, axis) => (value - cockpit.eye[axis]) / 85);
  const up = cockpit.up;
  const right = [
    up[1] * forward[2] - up[2] * forward[1],
    up[2] * forward[0] - up[0] * forward[2],
    up[0] * forward[1] - up[1] * forward[0],
  ];
  const position = cockpit.eye.map((value, axis) => value + right[axis] * 5 + up[axis] * 1.5 - forward[axis]);
  const target = cockpit.eye.map((value, axis) => value + forward[axis]);
  const direction = target.map((value, axis) => value - position[axis]);
  const yaw = Math.atan2(direction[0], -direction[2]);
  const pitch = Math.atan2(direction[1], Math.hypot(direction[0], direction[2]));
  const query = new URLSearchParams({
    local: 'latest',
    weather: '10',
    hour: '12',
    axes: '0',
    exportView: JSON.stringify({ mode: 'free', pitch, position, yaw }),
    videoExport: '1',
  });
  await page.goto(`${origin}/opensa/flight-replay.html?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__flightVideoExport, null, { timeout: 60000 });
  const ready = await page.evaluate(() => globalThis.__flightVideoExport.ready());
  await page.evaluate(async () => {
    // Each update schedules only two new cells. Warm the static view without a single bulk GPU load.
    for (let frame = 0; frame < 24; frame += 1) await globalThis.__flightVideoExport.renderFrame(0);
  });
  // Export draws into its own GPU texture; the visible canvas still contains the old boot frame.
  const png = await page.evaluate(async ({ width, height }) => {
    const pixels = await globalThis.__flightVideoExport.renderFrame(0);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  }, ready.compositor);
  assert.equal(await page.evaluate(() => globalThis.__flight?.cameraMode), 'free');
  assert.deepEqual(errors, []);
  const outDir = join(process.cwd(), 'captures');
  mkdirSync(outDir, { recursive: true });
  const screenshot = join(outDir, process.argv[2] ?? 'hydra-glass-no-reflection.png');
  writeFileSync(screenshot, Buffer.from(png, 'base64'));
  console.log(`PASS: exterior canopy screenshot ${screenshot}`);
} finally {
  await browser.close();
}
