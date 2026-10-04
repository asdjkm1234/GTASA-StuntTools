/** Screenshot the recorded bridge passes and report the replay camera distance. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { chromium } from 'playwright';

const recording = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(recording)) throw new Error('pass a camera-debug CSV path');
const url = 'http://127.0.0.1:4173/opensa/flight-replay.html';
const output = join(process.cwd(), 'captures');
mkdirSync(output, { recursive: true });
const profile = join(tmpdir(), `opensa-camera-collision-${Date.now()}`);
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')]
  .find((candidate) => existsSync(candidate));
if (!chrome) throw new Error('Chrome not found');
const port = 9345;
const child = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1600,900', url], { stdio: 'ignore' });
const stop = () => {
  if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
try {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  await sleep(4000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes('flight-replay'));
    if (!page) throw new Error('flight replay tab not found');
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => globalThis.__flight?.worldReady, null, { timeout: 60000 });
    await page.setInputFiles('#picker', recording);
    await page.waitForFunction(() => globalThis.__flight?.worldReady &&
      globalThis.__flight?.aircraft?.includes('hydra'), null, { timeout: 60000 });
    for (const at of [5, 18.82, 32.11, 41.5]) {
      await page.evaluate((time) => {
        const scrub = document.getElementById('scrub');
        scrub.value = String(time);
        scrub.dispatchEvent(new Event('input', { bubbles: true }));
      }, at);
      await sleep(3500);
      const shot = join(output, `camera-collision-${String(at).replace('.', '_')}.png`);
      await page.screenshot({ path: shot });
      const result = await page.evaluate(() => ({
        distance: globalThis.__flight?.cameraDistance,
        error: globalThis.__flight?.error,
        mode: globalThis.__flight?.cameraMode,
        cells: globalThis.__flight?.cells,
      }));
      console.log(`${basename(recording)} t=${at}: ${JSON.stringify(result)} shot=${shot}`);
      if (result.error) throw new Error(`replay error at ${at}: ${result.error}`);
      if (basename(recording) === 'flight_20260925_170435_271_m520_001.csv') {
        const expected = { 5: 20.56, 18.82: 14.29, 32.11: 10.30, 41.5: 5.50 }[at];
        if (!Number.isFinite(result.distance) || Math.abs(result.distance - expected) > 4) {
          throw new Error(`camera at ${at}s is ${result.distance}m; GTA trace is ${expected}m`);
        }
      }
    }
    if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ')}`);
    console.log(`page errors: ${JSON.stringify(errors)}`);
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
