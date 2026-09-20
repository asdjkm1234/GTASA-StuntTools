/**
 * Long-run soak: plays the recording at 4x and samples state + screenshots, so a late black screen can be
 * attributed (GPU device loss vs a thrown frame error vs a stall) instead of guessed at.
 *
 *   node scripts/soak-replay.mjs [url] [seconds]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest';
const seconds = Number(process.argv[3] ?? 70);
const speed = process.argv[4] ?? '4';
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });
const profile = join(tmpdir(), `opensa-soak-${Date.now()}`);
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')].find((path) => existsSync(path));
const port = 9336;
const child = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', url], { stdio: 'ignore' });
const kill = () => { try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
process.on('exit', kill);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(4000);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes('flight-replay')) ?? browser.contexts()[0].pages()[0];
const logs = [];
page.on('console', (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
await page.bringToFront().catch(() => {});
await sleep(9000);
await page.selectOption('#speed', speed).catch(() => {});
await page.click('#play').catch(() => {});

for (let elapsed = 0; elapsed <= seconds; elapsed += 10) {
  if (elapsed > 0) await sleep(10000);
  const state = await page.evaluate(() => {
    const samples = globalThis.__flight ?? null;
    const canvas = document.getElementById('canvas');
    return { clock: document.getElementById('clock')?.textContent, dbg: samples, size: canvas ? `${canvas.width}x${canvas.height}` : null };
  }).catch((error) => ({ error: error.message }));
  await page.screenshot({ path: join(outDir, `soak-${String(elapsed).padStart(3, '0')}s.png`) }).catch(() => {});
  console.log(`${elapsed}s ${JSON.stringify(state)}`);
}
console.log('--- console ---');
console.log(logs.slice(-30).join('\n'));
await browser.close();
kill();

