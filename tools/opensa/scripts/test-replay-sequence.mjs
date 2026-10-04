/**
 * Drives the replay through a full interaction sequence (play, far, original first person, cockpit, near,
 * middle, timeline scrub, run to the end) and screenshots each step for camera/pose/streaming regressions.
 *
 *   node scripts/test-replay-sequence.mjs [url]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest';
const tag = process.argv[3] ?? 'run';
// A FRESH throwaway profile per run: a reused/force-closed profile can lose its WebGPU adapter.
const profile = join(tmpdir(), `opensa-sequence-${Date.now()}`);
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')].find((path) => existsSync(path));
const port = 9334;
const child = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', url], { stdio: 'ignore' });
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

const shot = async (name) => page.screenshot({ path: join(outDir, `${tag}-${name}.png`) }).catch((error) => logs.push(`[screenshot ${name}] ${error.message}`));
const state = async () => page.evaluate(() => ({ dbg: globalThis.__flight ?? null, clock: document.getElementById('clock')?.textContent, mode: document.getElementById('mode')?.textContent })).catch((error) => ({ error: error.message }));

await page.bringToFront().catch(() => {});
await sleep(9000);
console.log('A loaded', JSON.stringify(await state()));
await shot('seq-1-loaded');

// Actually start playback (the page opens paused).
await page.click('#play').catch(() => {});
await page.selectOption('#speed', '2').catch(() => {});
await sleep(3000);
console.log('B playing', JSON.stringify(await state()));
await shot('seq-2-playing');

for (const [label, shotName] of [
  ['C far', 'seq-3-far'],
  ['D original first person', 'seq-4-first-person'],
  ['E cockpit', 'seq-5-cockpit'],
  ['F near', 'seq-6-near'],
  ['G middle', 'seq-7-middle'],
]) {
  await page.keyboard.press('KeyV');
  await sleep(1200);
  console.log(label, JSON.stringify(await state()));
  await shot(shotName);
}

await page.evaluate(() => {
  const scrub = document.getElementById('scrub');
  scrub.value = String(Number(scrub.max) * 0.5);
  scrub.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(1200);
console.log('H scrub', JSON.stringify(await state()));
await shot('seq-8-scrub');

// Let it play to the end of the recording.
await sleep(16000);
console.log('I end', JSON.stringify(await state()));
await shot('seq-9-end');

console.log('--- console ---');
console.log(logs.slice(-40).join('\n'));
await browser.close();
killChrome();
