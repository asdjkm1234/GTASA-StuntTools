/**
 * Capture the five flight views on the v5 Hydra recording's backwards-flight segment.
 * Uses its own fresh Chrome profile and closes only the Chrome process started here.
 *
 *   node scripts/test-camera-modes.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const profile = join(tmpdir(), `opensa-camera-${Date.now()}`);
const outDir = join(process.cwd(), 'captures');
const file = join(process.cwd(), '..', '..', 'GTA San Andreas', 'flight_recordings', 'flight_20260918_021607_017_m520_003.csv');
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')].find(existsSync);
assert(chrome, 'Chrome not found');
assert(existsSync(file), `Recording not found: ${file}`);
mkdirSync(outDir, { recursive: true });

const port = 9400 + Math.floor(Math.random() * 500);
const extraFlags = (process.env.CAMERA_CHROME_FLAGS ?? '').split(' ').filter(Boolean);
const child = spawn(chrome, [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--window-size=1280,800',
  ...extraFlags,
  'http://127.0.0.1:4173/opensa/flight-replay.html',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let chromeOutput = '';
child.stderr.on('data', (chunk) => { chromeOutput = (chromeOutput + chunk.toString()).slice(-5000); });
child.on('exit', (code, signal) => { if (code !== 0 && signal !== 'SIGTERM') console.log('Chrome exited', code, signal, chromeOutput); });
const stop = () => {
  if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

let browser;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 });
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
assert(browser, `Chrome did not expose its debug port: ${chromeOutput}`);
try {
  const context = browser.contexts()[0];
  let page;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    page = context.pages().find((candidate) => candidate.url().includes('flight-replay'));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!page) {
    console.log('No initial tab; opening one', chromeOutput);
    page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html');
  }
  await page.bringToFront();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  console.log('Waiting for baked world');
  await page.waitForFunction(() => globalThis.__flight?.worldReady === true, null, { timeout: 90_000, polling: 500 });
  console.log('Uploading target recording');
  await page.setInputFiles('#picker', file);
  await page.waitForFunction(() => document.getElementById('segment')?.textContent?.includes('flight_20260918_021607_017_m520_003.csv'), null, { timeout: 60_000, polling: 500 });
  await page.evaluate(() => {
    const scrub = document.getElementById('scrub');
    scrub.value = '123';
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(4000);

  const capture = async (expected) => {
    const state = await page.evaluate(() => ({
      mode: globalThis.__flight.cameraMode,
      distance: globalThis.__flight.cameraDistance,
      travelDot: globalThis.__flight.cameraTravelDot,
      seatSource: globalThis.__flight.seatSource,
      error: globalThis.__flight.error,
    }));
    assert.equal(state.mode, expected);
    assert.equal(state.error, null);
    await page.screenshot({ path: join(outDir, `camera-${expected}.png`) });
    console.log(expected, JSON.stringify(state));
    return state;
  };
  const mid = await capture('chase-mid');
  assert(mid.travelDot > 0.5, 'The chase view did not face the backwards travel direction');
  await page.click('#follow');
  await page.waitForTimeout(700);
  const far = await capture('chase-far');
  await page.click('#follow');
  const first = await capture('first-person');
  await page.click('#follow');
  await capture('cockpit');
  await page.click('#follow');
  await page.waitForTimeout(700);
  const near = await capture('chase-near');
  assert(near.distance < mid.distance && mid.distance < far.distance, 'Camera distances are not near < middle < far');
  console.log('first-person anchor', first.seatSource);
  assert.equal(errors.length, 0, errors.join('\n'));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  stop();
  await Promise.race([browser.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))]);
}
