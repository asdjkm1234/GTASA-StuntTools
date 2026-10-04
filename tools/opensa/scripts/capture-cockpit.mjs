/**
 * Captures the COCKPIT view once, with a unique filename, so two orientation hypotheses can be compared
 * without a stale screenshot being mistaken for a result.
 *
 *   node scripts/capture-cockpit.mjs <tag> [url]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const tag = process.argv[2] ?? 'run';
const url = process.argv[3] ?? 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest';
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });
const profile = join(tmpdir(), `opensa-cockpit-${tag}-${Date.now()}`);
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')].find((path) => existsSync(path));
const port = 9335;
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
await page.click('#play').catch(() => {});
await page.keyboard.press('KeyV');
await sleep(3000);
const state = await page.evaluate(() => ({ mode: document.getElementById('mode')?.textContent, status: document.getElementById('status')?.textContent, dbg: globalThis.__flight ?? null }));
await page.screenshot({ path: join(outDir, `cockpit-${tag}.png`) }).catch((error) => logs.push(`[screenshot] ${error.message}`));
console.log(tag, JSON.stringify(state));
console.log(logs.slice(-10).join('\n'));
await browser.close();
kill();
