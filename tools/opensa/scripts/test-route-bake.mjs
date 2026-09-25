/** Click the HUD route-bake button, reload into its new pak, and capture the result. */
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';

const recording = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(recording)) throw new Error('Pass a FlightRecorder CSV');
const url = process.env.REPLAY_URL ?? 'http://127.0.0.1:4173/opensa/flight-replay.html';
const output = join(process.cwd(), 'captures');
mkdirSync(output, { recursive: true });
const profile = join(tmpdir(), `opensa-route-bake-${Date.now()}`);
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')]
  .find((candidate) => existsSync(candidate));
if (!chrome) throw new Error('Chrome not found');
const browser = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: false,
  viewport: { width: 1600, height: 900 }, args: ['--no-first-run', '--no-default-browser-check'] });
try {
    const page = browser.pages()[0] ?? await browser.newPage();
    await page.goto(url);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => globalThis.__flight?.worldReady, null, { timeout: 90000 });
    await page.setInputFiles('#picker', recording);
    await page.waitForFunction(() => globalThis.__flight?.aircraft?.includes('hydra'), null, { timeout: 30000 });
    await page.click('#bakeRoute');
    await page.waitForURL(/\/flight-replay\.html\?[^#]*pak=%2Froute-pak%2F/, { timeout: 180000 });
    await page.waitForFunction(() => globalThis.__flight?.worldReady && globalThis.__flight?.renders > 0,
      null, { timeout: 90000 });
    await page.waitForTimeout(2000);
    const id = new URL(page.url()).searchParams.get('pak')?.split('/').pop();
    const index = await (await page.request.get(new URL(`/route-pak/${id}/index.json`, page.url()).href)).json();
    const shot = join(output, `route-bake-${id}.png`);
    await page.screenshot({ path: shot });
    const state = await page.evaluate(() => ({ aircraft: globalThis.__flight?.aircraft,
      error: globalThis.__flight?.error, renders: globalThis.__flight?.renders,
      status: document.getElementById('status')?.textContent }));
    console.log(JSON.stringify({ id, shot, cells: index.cells.length,
      radius: index.renderRadius, state }));
    if (errors.length || state.error || !index.renderRadius || index.cells.length < 1) {
      throw new Error(`Route replay failed: ${errors.join('; ')} ${state.error ?? ''}`);
    }
} finally {
  await browser.close();
}
