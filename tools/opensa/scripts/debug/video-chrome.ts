/**
 * Is the CHROME out of the shot? The one check no headless number can answer (096/08).
 *
 * Video mode hides the UI through the photo camera's path, and it asks for that hide from inside `boot()` —
 * before React is listening. When that hide fails, nothing in the console says so: the `[video]` reports know
 * nothing about the DOM, and the bench harness screenshots the end card, which is black. So this probe boots
 * the real app, waits until a fragment is actually on screen (the black overlay carries `is-clear`), and reads
 * the four pieces of chrome out of the DOM.
 *
 *   npx tsx scripts/debug/video-chrome.ts <appUrl> [timeoutMs] [--control] [--shot <png>]
 *
 * `--control` drops the wait for a fragment and samples as soon as the game is up — run it against a URL with
 * NO `?video=` to prove the probe can see the chrome it is looking for. Without a control, all-false is
 * equally consistent with a probe that looks for the wrong selectors.
 *
 * Exit code 1 = chrome in the frame (or, under `--control`, none of it found).
 *
 * Example (dev on :5173, `npm run serve:static` on :3001):
 *   SRC=http://localhost:3001/build/original/opensa
 *   npx tsx scripts/debug/video-chrome.ts "http://localhost:5173/?loader=http-dir&src=$SRC" 90000 --control
 *   npx tsx scripts/debug/video-chrome.ts \
 *     "http://localhost:5173/?loader=http-dir&src=$SRC&video=1&seed=47&scene=1&scenes=1" 180000
 */
import { chromium, type Page } from 'playwright';

/** What the probe reads out of the page — every field is a piece of chrome K+M hides. */
interface ChromeState {
  /** The "Click to play" pointer-lock prompt. */
  capture: boolean;
  /** The HUD clock, matched by its `HH:MM` text (it is a styled div with no class of its own). */
  clock: boolean;
  /** The shell's Fullscreen button. */
  fullscreen: boolean;
  /** null = no video overlay on the page at all (a control run); true = a fragment is on screen. */
  overlayClear: boolean | null;
  /** The dev perf readout — hidden by the loop's own flag rather than by React, so it fails separately. */
  perfHud: boolean;
}

const APP_URL = process.argv[2] ?? '';
const TIMEOUT_MS = Number(process.argv[3] ?? 180000);
const CONTROL = process.argv.includes('--control');
const shotAt = process.argv.indexOf('--shot');
const SHOT = shotAt === -1 ? undefined : process.argv[shotAt + 1];

/** The menu step the http-dir loader still goes through — the same click `bench-harness/drive.js` makes. */
async function enterGame(page: Page): Promise<void> {
  const runButton = page.getByText('RUN SAN ANDREAS', { exact: false });
  await runButton
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => console.log('run button never appeared'));
  if (await runButton.count()) {
    await runButton.first().click();
  }
  await page.waitForSelector('canvas', { timeout: 240000 });
}

/** Runs in the page. Kept self-contained — nothing from this module's scope is visible inside it. */
function readChrome(): ChromeState {
  const perf = document.getElementById('engine-hud');
  const overlay = document.querySelector('.opensa-video-overlay');

  return {
    capture: document.querySelector('.sa-capture') !== null,
    clock: [...document.querySelectorAll('div')].some((el) => /^\d{2}:\d{2}$/.test((el.textContent ?? '').trim())),
    fullscreen: document.querySelector('.sa-fullscreen-btn') !== null,
    overlayClear: overlay === null ? null : overlay.classList.contains('is-clear'),
    perfHud: perf !== null && getComputedStyle(perf).display !== 'none',
  };
}

void (async (): Promise<void> => {
  if (!APP_URL) {
    throw new Error('usage: video-chrome.ts <appUrl> [timeoutMs] [--control] [--shot <png>]');
  }
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal'],
    headless: true,
  });
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[video]') || msg.type() === 'error') {
      console.log(`console[${msg.type()}] ${text}`);
    }
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await enterGame(page);

  const deadline = Date.now() + TIMEOUT_MS;
  let state: ChromeState = await page.evaluate(readChrome);
  while (Date.now() < deadline) {
    state = await page.evaluate(readChrome);
    // A control run samples the moment the game is playable; a video run must sample INSIDE a fragment —
    // read while the overlay is still down, everything reads hidden and the probe proves nothing.
    if (CONTROL ? state.capture : state.overlayClear === true) {
      break;
    }
    await page.waitForTimeout(1000);
  }
  if (SHOT) {
    await page.screenshot({ path: SHOT });
  }
  await browser.close();

  const visible = (Object.keys(state) as (keyof ChromeState)[]).filter((key) => key !== 'overlayClear' && state[key]);
  console.log(`chrome ${JSON.stringify(state)}`);
  if (CONTROL) {
    console.log(
      visible.length === 4 ? 'control OK: all four pieces of chrome seen' : `control FAILED: saw ${visible.join(', ')}`,
    );
    process.exitCode = visible.length === 4 ? 0 : 1;

    return;
  }
  if (state.overlayClear !== true) {
    console.log('FAILED: no fragment reached before the timeout — nothing was sampled on screen');
    process.exitCode = 1;

    return;
  }
  console.log(
    visible.length === 0 ? 'OK: no chrome in the frame' : `FAILED: chrome in the frame — ${visible.join(', ')}`,
  );
  process.exitCode = visible.length === 0 ? 0 : 1;
})();
