/** Capture the Hydra's centerline landing gear at extended and retracted times. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { chromium } from 'playwright';

const recording = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(recording)) throw new Error('pass a Hydra CSV path');
const hasRecordedCenterGear = readFileSync(recording, 'utf8').startsWith(
  '# gtasa_flight_recorder,version=7,sample_hz=25,camera_debug=1,center_gear_debug=1');
const times = process.argv.slice(3).map(Number);
if (times.length === 0 || times.some((time) => !Number.isFinite(time) || time < 0)) {
  throw new Error('pass one or more seek times in seconds');
}
const output = join(process.cwd(), 'captures');
mkdirSync(output, { recursive: true });
const profile = join(tmpdir(), `opensa-hydra-center-gear-${Date.now()}`);
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')]
  .find((candidate) => existsSync(candidate));
if (!chrome) throw new Error('Chrome not found');
const port = 9400 + Math.floor(Math.random() * 500);
const child = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1600,900',
  'http://127.0.0.1:4173/opensa/flight-replay.html'], { stdio: 'ignore' });
const stop = () => {
  if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
try {
  await new Promise((done) => setTimeout(done, 4000));
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes('flight-replay'));
    if (!page) throw new Error('flight replay tab not found');
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => globalThis.__flight?.worldReady, null, { timeout: 60000 });
    await page.setInputFiles('#picker', recording);
    await page.waitForFunction(() => globalThis.__flight?.aircraft?.includes('hydra'), null, { timeout: 60000 });
    for (const time of times) {
      await page.evaluate((at) => {
        const scrub = document.getElementById('scrub');
        scrub.value = String(at);
        scrub.dispatchEvent(new Event('input', { bubbles: true }));
      }, time);
      await page.waitForTimeout(3500);
      const shot = join(output, `hydra-center-gear-${basename(recording, '.csv')}-${String(time).replace('.', '_')}.png`);
      await page.screenshot({ path: shot });
      const state = await page.evaluate(() => ({ error: globalThis.__flight?.error,
        aircraft: globalThis.__flight?.aircraft, renders: globalThis.__flight?.renders,
        nodes: [...document.querySelectorAll('#readout dt')]
          .find((entry) => entry.textContent.trim() === '节点')?.nextElementSibling?.textContent }));
      console.log(JSON.stringify({ time, shot, state }));
      if (state.error || state.renders < 1) throw new Error(`replay failed at ${time}s`);
      if (hasRecordedCenterGear &&
        (!state.nodes?.includes('misc_a:R') || !state.nodes?.includes('misc_b:R'))) {
        throw new Error(`recorded center gear nodes not active at ${time}s`);
      }
    }
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
