/**
 * Exercises the weather/time HUD sliders and screenshots the result, so the control is verified from pixels
 * (and not just "the handler was wired").
 *
 *   node scripts/test-hud.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest';
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });
const profile = join(tmpdir(), `opensa-hud-${Date.now()}`);
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')].find((path) => existsSync(path));
const port = 9337;
const child = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', url], { stdio: 'ignore' });
const kill = () => { try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
process.on('exit', kill);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(4000);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes('flight-replay')) ?? browser.contexts()[0].pages()[0];
const logs = [];
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') logs.push(`[console.error] ${message.text()}`); });
await page.bringToFront().catch(() => {});
await sleep(14000);
// Play into the visible part of the flight, then PAUSE so the two environment shots are the same frame.
await page.click('#play').catch(() => {});
await sleep(20000);
await page.click('#play').catch(() => {});
await sleep(800);

const read = () => page.evaluate(() => ({
  env: [...document.querySelectorAll('#readout dt')].find((d) => d.textContent.includes('环境'))?.nextElementSibling?.textContent,
  hour: document.getElementById('hourLabel')?.textContent,
  weather: document.getElementById('weatherLabel')?.textContent,
}));

await page.screenshot({ path: join(outDir, 'hud-0-recorded.png') });
console.log('recorded', JSON.stringify(await read()));

// RAINY_SF (8) at 19:30
await page.evaluate(() => {
  const w = document.getElementById('weatherSlider');
  const h = document.getElementById('hourSlider');
  w.value = '8'; w.dispatchEvent(new Event('input', { bubbles: true }));
  h.value = '19.5'; h.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(1500);
await page.screenshot({ path: join(outDir, 'hud-1-rainy-1930.png') });
console.log('rainy19_30', JSON.stringify(await read()));

// BACK TO FOLLOW
await page.evaluate(() => {
  const f = document.getElementById('followEnv');
  f.checked = true; f.dispatchEvent(new Event('change', { bubbles: true }));
});
await sleep(1200);
await page.screenshot({ path: join(outDir, 'hud-2-follow.png') });
console.log('follow', JSON.stringify(await read()));

// SETTINGS: radii / resolution / background prepare / debug axes
await page.evaluate(() => {
  const set = (id, value) => { const e = document.getElementById(id); e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); };
  const toggle = (id, checked) => { const e = document.getElementById(id); e.checked = checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
  set('hdSlider', '300'); set('lodSlider', '800'); set('scaleSlider', '0.75');
  set('budgetSlider', '30'); set('intervalSlider', '2000');
  toggle('prepareToggle', false); toggle('axesToggle', true);
});
await sleep(1500);
await page.screenshot({ path: join(outDir, 'hud-3-settings.png') });
console.log('settings', JSON.stringify(await page.evaluate(() => ({
  budget: document.getElementById('budgetLabel')?.textContent,
  hd: document.getElementById('hdLabel')?.textContent,
  interval: document.getElementById('intervalLabel')?.textContent,
  lod: document.getElementById('lodLabel')?.textContent,
  scale: document.getElementById('scaleLabel')?.textContent,
}))));

console.log(logs.slice(-10).join('\n'));
await browser.close();
kill();
