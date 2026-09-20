/**
 * Opens the replay in the installed Chrome (dedicated profile, WebGPU-capable) with the DevTools protocol
 * on, then repeatedly screenshots and dumps console errors + `window.__flight` so a black screen can be
 * diagnosed without guessing.
 *
 *   node scripts/capture-replay.mjs [url] [seconds]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest';
const seconds = Number(process.argv[3] ?? 25);
const projectRoot = join(process.cwd(), '..', '..');
// A FRESH throwaway profile per run: a reused/force-closed profile can lose its WebGPU adapter.
const profile = join(tmpdir(), `opensa-capture-${Date.now()}`);
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')].find((path) => existsSync(path));
if (!chrome) throw new Error('Chrome not found');

// A fresh debug port each run; the profile is reused so the GPU state stays the working one.
const port = 9333;
const child = spawn(chrome, [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  url,
], { stdio: 'ignore' });
// ALWAYS kill the Chrome THIS script started — a CDP disconnect does not close a browser.
const killChrome = () => {
  try {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch { /* already gone */ }
};
process.on('exit', killChrome);
process.on('SIGINT', () => { killChrome(); process.exit(130); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(4000);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
const page = context.pages().find((candidate) => candidate.url().includes('flight-replay')) ?? context.pages()[0];
const logs = [];
page.on('console', (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
page.on('requestfailed', (request) => logs.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText}`));
page.on('response', (response) => {
  if (response.status() >= 400) logs.push(`[http ${response.status()}] ${response.url()}`);
});
await page.bringToFront().catch(() => {});
console.log(`url: ${page.url()}`);

for (let second = 0; second <= seconds; second += 5) {
  if (second > 0) await sleep(5000);
  const shot = join(outDir, `replay-${String(second).padStart(2, '0')}s.png`);
  await page.screenshot({ path: shot }).catch((error) => logs.push(`[screenshot] ${error.message}`));
  const state = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const loading = document.getElementById('mapLoading');
    const status = document.getElementById('status');
    return {
      canvas: canvas ? `${canvas.width}x${canvas.height} css ${canvas.clientWidth}x${canvas.clientHeight}` : 'none',
      dbg: globalThis.__flight ?? null,
      loadingHidden: loading ? loading.hidden : null,
      status: status?.textContent ?? null,
    };
  }).catch((error) => ({ error: error.message }));
  console.log(`${second}s ${JSON.stringify(state)}`);
}

console.log('--- console ---');
console.log(logs.slice(-80).join('\n'));
await browser.close();
killChrome();
