/** Check that the published cockpit view sits above the pilot seat, and save a screenshot. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest';
const recording = process.argv[3];
const tag = process.argv[4] ?? 'pilot-seat';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 911 } });
const mode = () => page.evaluate(() => globalThis.__flight?.cameraMode);
const eye = () => page.evaluate(() => globalThis.__flight?.cameraState?.eye);

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__flight?.worldReady && globalThis.__flight?.cameraState, null, {
    timeout: 90000,
  });
  if (recording) {
    await page.locator('#picker').setInputFiles(recording);
    const expectedAircraft = /m476|rustler/i.test(recording) ? 'rustler' : 'hydra';
    await page.waitForFunction((name) => globalThis.__flight?.aircraft?.includes(name), expectedAircraft, {
      timeout: 60000,
    });
  }
  for (const expected of ['chase-far', 'first-person']) {
    await page.locator('#follow').click();
    await page.waitForFunction((value) => globalThis.__flight?.cameraMode === value, expected);
  }
  const firstPersonEye = await eye();
  const firstPersonState = await page.evaluate(() => globalThis.__flight?.cameraState);
  await page.locator('#follow').click();
  await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'cockpit');
  const cockpitEye = await eye();
  const seatSource = await page.evaluate(() => globalThis.__flight?.seatSource);
  assert.equal(await mode(), 'cockpit');
  assert.equal(seatSource, 'ped_frontseat');
  assert(firstPersonEye && cockpitEye && firstPersonState);
  const forward = firstPersonState.target.map((value, axis) => (value - firstPersonEye[axis]) / 85);
  const hydra = await page.evaluate(() => globalThis.__flight?.aircraft?.includes('hydra'));
  const eyeDown = hydra ? 0.07 : 0;
  assert(Math.hypot(...firstPersonEye.map((value, axis) =>
    value - forward[axis] * 0.2 - firstPersonState.up[axis] * eyeDown - cockpitEye[axis])) < 0.01,
    `Cockpit eye is not at the pilot seat: ${JSON.stringify({ firstPersonEye, cockpitEye })}`);
  assert.equal(await page.evaluate(() => globalThis.__flight?.cameraState?.near), 0.03);

  await page.waitForTimeout(8000);
  const outDir = join(process.cwd(), 'captures');
  mkdirSync(outDir, { recursive: true });
  const screenshot = join(outDir, `cockpit-${tag}.png`);
  await page.screenshot({ path: screenshot });
  await page.addStyleTag({ content: 'body > :not(#canvas):not(script) { display: none !important; }' });
  await page.locator('#canvas').screenshot({ path: join(outDir, `cockpit-${tag}-canvas.png`) });
  console.log(`PASS: cockpit eye sits aft with ${eyeDown} downward offset; screenshot ${screenshot}`);
} finally {
  await browser.close();
}
