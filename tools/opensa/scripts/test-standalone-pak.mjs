/** Verify that both supported aircraft render using only the baked pak. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { chromium } from 'playwright';

const recording = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(recording)) throw new Error('pass a Hydra CSV path');
const original = readFileSync(recording, 'utf8');
const rustler = original.replace(/(^[^#\r\n][^,\r\n]*,)520,/gm, (_match, prefix) => `${prefix}476,`);
if (rustler === original) throw new Error('the CSV has no Hydra rows to use for the Rustler asset check');
const replayUrl = process.env.REPLAY_URL ?? 'http://127.0.0.1:4173/opensa/flight-replay.html';
const output = join(process.cwd(), 'captures');
mkdirSync(output, { recursive: true });
const profile = join(tmpdir(), `opensa-standalone-pak-${Date.now()}`);
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')]
  .find((candidate) => existsSync(candidate));
if (!chrome) throw new Error('Chrome not found');
const port = 9400 + Math.floor(Math.random() * 500);
const child = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1600,900', replayUrl], { stdio: 'ignore' });
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
    const installRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/\/(?:game-src|gta)\//.test(new URL(request.url()).pathname)) installRequests.push(request.url());
    });
    await page.waitForFunction(() => globalThis.__flight?.worldReady, null, { timeout: 60000 });
    for (const [model, csv] of [['hydra', original], ['rustler', rustler]]) {
      await page.setInputFiles('#picker', { name: `${model}-asset-check.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await page.waitForFunction((name) => globalThis.__flight?.aircraft?.includes(name), model, { timeout: 60000 });
      await page.waitForTimeout(3500);
      const shot = join(output, `standalone-pak-${model}-${basename(recording, '.csv')}.png`);
      await page.screenshot({ path: shot });
      const state = await page.evaluate(() => ({ error: globalThis.__flight?.error,
        aircraft: globalThis.__flight?.aircraft, renders: globalThis.__flight?.renders,
        cells: globalThis.__flight?.cells, worldReady: globalThis.__flight?.worldReady }));
      console.log(JSON.stringify({ model, shot, state }));
      if (state.error || !state.worldReady || state.renders < 1 || state.cells < 1) {
        throw new Error(`${model} replay failed`);
      }
    }
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    if (installRequests.length) throw new Error(`unexpected game install requests: ${installRequests.join('; ')}`);
    console.log('standalone pak: no game install requests');
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
