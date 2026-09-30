/** Verify the published replay's free-camera keys and save a screenshot. Chrome is started only for this run. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const eye = () => page.evaluate(() => globalThis.__flight?.cameraState?.eye);
const waitForSpeed = (label) => page.waitForFunction(
  (expected) => document.querySelector('#freeView')?.textContent === `退出自由视角（${expected}）`,
  label,
);

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__flight?.cameraState && document.querySelector('#freeView'), null, {
    timeout: 60000,
  });
  await page.locator('#freeView').click();
  await waitForSpeed('中速');
  await page.evaluate(() => document.activeElement?.blur());

  const before = await eye();
  await page.keyboard.down('w');
  await page.waitForTimeout(180);
  await page.keyboard.up('w');
  const after = await eye();
  if (!before || !after || Math.abs(after[1] - before[1]) > 1e-5 || Math.hypot(after[0] - before[0], after[2] - before[2]) < 0.1) {
    throw new Error(`W must move horizontally: ${JSON.stringify({ before, after })}`);
  }

  await page.keyboard.down('Control');
  await waitForSpeed('快速');
  await page.keyboard.up('Control');
  await page.keyboard.down('Control');
  await waitForSpeed('极慢');
  await page.keyboard.up('Control');

  const beforeFineMove = await eye();
  await page.keyboard.down('w');
  await page.waitForTimeout(180);
  await page.keyboard.up('w');
  const afterFineMove = await eye();
  const fineDistance = Math.hypot(...afterFineMove.map((value, axis) => value - beforeFineMove[axis]));
  if (fineDistance < 0.01 || fineDistance > 0.3) throw new Error(`Ultra-slow movement is ${fineDistance}`);

  const beforeUp = await eye();
  await page.keyboard.down('Space');
  await page.waitForTimeout(180);
  await page.keyboard.up('Space');
  const afterUp = await eye();
  if (!beforeUp || !afterUp || afterUp[1] <= beforeUp[1]) throw new Error('Space did not ascend');

  const beforeDown = await eye();
  await page.keyboard.down('Shift');
  await page.waitForTimeout(180);
  await page.keyboard.up('Shift');
  const afterDown = await eye();
  if (!beforeDown || !afterDown || afterDown[1] >= beforeDown[1]) throw new Error('Shift did not descend');

  const outDir = join(process.cwd(), 'captures');
  mkdirSync(outDir, { recursive: true });
  const screenshot = join(outDir, 'free-camera-controls.png');
  await page.screenshot({ path: screenshot });
  console.log(`PASS: free-camera movement and speed controls; screenshot ${screenshot}`);
} finally {
  await browser.close();
}
