/**
 * Reproduces the multi-file black screen: imports several CSVs, then switches between them, screenshotting
 * each and recording console errors (a dead texture array shows as a black canvas with no JS error).
 *
 *   node scripts/test-multitrack.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const gameDir = join(process.cwd(), '..', '..', 'GTA San Andreas', 'flight_recordings');
const files = ['flight_20260920_232028_918_m520_001.csv', 'flight_20260918_021607_017_m520_003.csv', 'flight_20260918_014828_691_m520_001.csv'].map((name) => join(gameDir, name));
const url = process.argv[2] ?? 'http://127.0.0.1:4173/opensa/flight-replay.html';
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });
const profile = join(tmpdir(), `opensa-multi-${Date.now()}`);
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')].find((path) => existsSync(path));
const port = 9338;
const child = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', url], { stdio: 'ignore' });
const kill = () => { try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
process.on('exit', kill);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(4000);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes('flight-replay')) ?? browser.contexts()[0].pages()[0];
const logs = [];
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
page.on('console', (message) => logs.push(`[${message.type()}] ${message.text().split('\n')[0]}`));
await page.bringToFront().catch(() => {});

// Add three recordings through the real file picker.
await page.setInputFiles('#picker', files).catch((error) => logs.push(`[input] ${error.message}`));
await sleep(20000);
await page.click('#play').catch(() => {});
await sleep(1500);

const state = () => page.evaluate(() => ({ track: document.querySelector('.track.active .track-name')?.textContent, clock: document.getElementById('clock')?.textContent, dbg: globalThis.__flight ?? null }));

for (let index = 0; index < 3; index++) {
  await page.click(`.track[data-i="${index}"]`).catch((error) => logs.push(`[click] ${error.message}`));
  await sleep(9000);
  await page.screenshot({ path: join(outDir, `multi-${index}.png`) });
  console.log(`track ${index}`, JSON.stringify(await state()));
}

console.log('--- console ---');
console.log(logs.slice(-25).join('\n'));
await browser.close();
kill();
