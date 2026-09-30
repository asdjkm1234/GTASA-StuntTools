/** Inspect the pilot eye forward, sideways and backward in the published replay. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';

const recording = process.argv[2];
const tag = process.argv[3] ?? 'hydra';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 911 } });
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });

try {
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' &&
    document.querySelector('.track.active .track-name')?.textContent === '最新本地记录.csv', null, { timeout: 90000 });
  if (recording) {
    const name = basename(recording);
    await page.locator('#picker').setInputFiles(recording);
    await page.waitForFunction((wanted) => [...document.querySelectorAll('.track-name')]
      .some((node) => node.textContent === wanted), name);
    await page.evaluate((wanted) => [...document.querySelectorAll('.track')]
      .find((node) => node.querySelector('.track-name')?.textContent === wanted)?.click(), name);
    await page.waitForFunction((wanted) => document.querySelector('.track.active .track-name')?.textContent === wanted,
      name);
    await page.waitForFunction((model) => globalThis.__flight?.aircraft?.includes(model),
      /m476|rustler/i.test(name) ? 'rustler' : 'hydra', { timeout: 60000 });
  }
  for (const mode of ['chase-far', 'first-person', 'cockpit']) {
    await page.locator('#follow').click();
    await page.waitForFunction((wanted) => globalThis.__flight?.cameraMode === wanted, mode);
  }
  await page.waitForTimeout(5000);
  await page.locator('#cockpitLook').click();
  await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'cockpit-look');
  const eye = await page.evaluate(() => globalThis.__flight.cameraState.eye);
  const frontDirection = await page.evaluate(() => {
    const { eye, target } = globalThis.__flight.cameraState;
    const delta = target.map((value, axis) => value - eye[axis]);
    const length = Math.hypot(...delta);
    return delta.map((value) => value / length);
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.cameraState.near), 0.03);
  await page.locator('#canvas').screenshot({ path: join(outDir, `cockpit-look-${tag}-front.png`) });
  await page.keyboard.down('w');
  await page.waitForTimeout(350);
  await page.keyboard.up('w');
  const forwardEye = await page.evaluate(() => globalThis.__flight.cameraState.eye);
  const frontMove = forwardEye.reduce((sum, value, axis) => sum + (value - eye[axis]) * frontDirection[axis], 0);
  assert(frontMove > 0.03, `W moved opposite the forward view: ${frontMove}`);
  await page.keyboard.down('s');
  await page.waitForTimeout(350);
  await page.keyboard.up('s');
  const backwardEye = await page.evaluate(() => globalThis.__flight.cameraState.eye);
  const backMove = backwardEye.reduce((sum, value, axis) => sum + (value - forwardEye[axis]) * frontDirection[axis], 0);
  assert(backMove < -0.03, `S moved opposite the backward view: ${backMove}`);
  await page.locator('#cockpitLook').click();
  await page.locator('#cockpitLook').click();
  await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'cockpit-look');
  await page.waitForTimeout(200);
  const resetEye = await page.evaluate(() => globalThis.__flight.cameraState.eye);

  await page.mouse.move(500, 445);
  await page.mouse.down();
  await page.mouse.move(900, 445, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.locator('#canvas').screenshot({ path: join(outDir, `cockpit-look-${tag}-side.png`) });

  await page.mouse.move(500, 445);
  await page.mouse.down();
  await page.mouse.move(885, 445, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const rearEye = await page.evaluate(() => globalThis.__flight.cameraState.eye);
  const displacement = Math.hypot(...rearEye.map((value, axis) => value - resetEye[axis]));
  assert(displacement > 0.3 && displacement < 0.7,
    `Rearward look did not advance the pilot eye within the cockpit: ${displacement}`);
  await page.locator('#canvas').screenshot({ path: join(outDir, `cockpit-look-${tag}-back.png`) });
  const rearDirection = await page.evaluate(() => {
    const { eye, target } = globalThis.__flight.cameraState;
    const delta = target.map((value, axis) => value - eye[axis]);
    const length = Math.hypot(...delta);
    return delta.map((value) => value / length);
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(350);
  await page.keyboard.up('w');
  const rearForwardEye = await page.evaluate(() => globalThis.__flight.cameraState.eye);
  const rearMove = rearForwardEye.reduce((sum, value, axis) => sum + (value - rearEye[axis]) * rearDirection[axis], 0);
  assert(rearMove > 0.03, `W moved opposite the rearward view: ${rearMove}`);
  console.log(`PASS: ${tag} forward/side/back, auto lean ${displacement.toFixed(3)}m, near 0.03`);
} finally {
  await browser.close();
}
