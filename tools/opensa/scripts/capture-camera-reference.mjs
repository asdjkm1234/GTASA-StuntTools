/** Capture one CSV at game and browser viewport sizes for camera calibration. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const csv = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(csv)) throw new Error('Pass an existing CSV path');
const tag = process.argv[3] ?? 'camera-reference';
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')]
  .find((candidate) => existsSync(candidate));
if (!chrome) throw new Error('Chrome not found');
const profile = join(tmpdir(), `opensa-camera-${Date.now()}`);
const port = 20000 + Math.floor(Math.random() * 30000);
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });
const child = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1920,1080',
  'http://127.0.0.1:4173/opensa/flight-replay.html'], { stdio: 'ignore' });
const killChrome = () => {
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); }
  catch { /* already gone */ }
};
process.on('exit', killChrome);
process.on('SIGINT', () => { killChrome(); process.exit(130); });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let browser;
try {
  for (let attempt = 0; attempt < 30 && !browser; attempt += 1) {
    await sleep(1000);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
    catch { /* Chrome is still starting */ }
  }
  if (!browser) throw new Error('Chrome did not start');
  const context = browser.contexts()[0];
  const page = context.pages().find((candidate) => candidate.url().includes('flight-replay')) ?? context.pages()[0];
  await page.waitForFunction(() => globalThis.__flight?.worldReady, undefined, { timeout: 60000 });
  await page.locator('#picker').setInputFiles(csv);
  await page.waitForFunction((name) => document.getElementById('segment')?.textContent?.includes(name),
    basename(csv), { timeout: 30000 });
  await page.waitForFunction(() => globalThis.__flight?.renders > 10, undefined, { timeout: 30000 });
  const cdp = await context.newCDPSession(page);
  for (const [width, height] of [[1920, 1080], [1920, 945]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1,
      mobile: false, screenWidth: 1920, screenHeight: 1080 });
    await sleep(2500);
    const shot = join(outDir, `${tag}-${width}x${height}.png`);
    await page.screenshot({ path: shot });
    console.log(JSON.stringify({ shot, state: await page.evaluate(() => ({
      debug: globalThis.__flight,
      screen: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    })) }));
  }
} finally {
  await browser?.close().catch(() => {});
  killChrome();
}
