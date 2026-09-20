/**
 * Reproduces the black screen while DRAGGING the timeline into regions the background pump has not prepared
 * yet, capturing console errors so the cause (dead texture array vs GPU device loss) is evidence, not guess.
 *
 *   node scripts/test-scrub.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const gameDir = join(process.cwd(), '..', '..', 'GTA San Andreas', 'flight_recordings');
const file = join(gameDir, process.argv[2] ?? 'flight_20260918_021607_017_m520_003.csv');
const url = 'http://127.0.0.1:4173/opensa/flight-replay.html';
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });
const profile = join(tmpdir(), `opensa-scrub-${Date.now()}`);
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')].find((path) => existsSync(path));
const port = 9339;
const child = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', url], { stdio: 'ignore' });
const kill = () => { try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
process.on('exit', kill);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(4000);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes('flight-replay')) ?? browser.contexts()[0].pages()[0];
const logs = [];
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') logs.push(`[${message.type()}] ${message.text().split('\n')[0]}`); });
page.on('dialog', (dialog) => { logs.push(`[dialog] ${dialog.message()}`); dialog.dismiss().catch(() => {}); });
await page.bringToFront().catch(() => {});

const started = Date.now();
await page.setInputFiles('#picker', [file]).catch((error) => logs.push(`[input] ${error.message}`));
// Wait for the first rendered frame with a plane.
for (let i = 0; i < 90; i++) {
  await sleep(500);
  const ok = await page.evaluate(() => globalThis.__flight?.phase === 'rendering' && globalThis.__flight?.aircraft?.includes('hydra')).catch(() => false);
  if (ok) { console.log(`first render after ${((Date.now() - started) / 1000).toFixed(1)}s`); break; }
}
await sleep(1500);
await page.click('#play').catch(() => {});
await sleep(2000);
await page.click('#play').catch(() => {}); // pause
await sleep(500);

for (const fraction of [0, 0.25, 0.5, 0.75, 0.95]) {
  await page.evaluate((value) => {
    const scrub = document.getElementById('scrub');
    scrub.value = String(Number(scrub.max) * value);
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
  }, fraction);
  await sleep(3500);
  await page.screenshot({ path: join(outDir, `scrub-${String(fraction).replace('.', '_')}.png`) });
  const state = await page.evaluate(() => ({ clock: document.getElementById('clock')?.textContent, dbg: globalThis.__flight ?? null }));
  console.log(`scrub ${fraction}`, JSON.stringify({ clock: state.clock, error: state.dbg?.error, phase: state.dbg?.phase, prepare: state.dbg?.status }));
}

console.log('--- console ---');
console.log(logs.slice(-25).join('\n'));
await browser.close();
kill();
