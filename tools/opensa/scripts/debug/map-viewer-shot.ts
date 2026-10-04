/**
 * Drive sa-map-viewer headlessly and capture one scripted pose (plan 094). This is the A/B instrument the
 * blue-strip bisect needs: the same URL renders the same pixels, so two sources at one pose can be diffed
 * directly. `?panel=0` is added automatically unless the URL sets `panel` — the panel carries a live fps
 * line, and a pixel diff must not compare a frame counter.
 *
 *   npx tsx scripts/debug/map-viewer-shot.ts <appUrl> <outPng> [timeoutMs]
 *
 * Example (vanilla vs the salod build at one spot):
 *   npm run serve:static &  npm run dev
 *   npx tsx scripts/debug/map-viewer-shot.ts \
 *     'http://localhost:5173/sa-map-viewer.html?src=http://localhost:3001/game-src/original&at=150,-1700' a.png
 *   npx tsx scripts/debug/map-viewer-shot.ts \
 *     'http://localhost:5173/sa-map-viewer.html?src=http://localhost:3001/build/salod&at=150,-1700' b.png
 *   magick a.png b.png -compose difference -composite -colorspace Gray -format '%[fx:maxima*255]' info:
 */
import { chromium } from 'playwright';

const APP_URL = process.argv[2] ?? '';
const OUT = process.argv[3] ?? 'map-viewer.png';
const TIMEOUT_MS = Number(process.argv[4] ?? 120000);

/**
 * Add `panel=0` unless the caller asked for the panel explicitly, and `water=0` unless they asked for water:
 * the sea is the one thing in the viewer that MOVES on its own (Gerstner waves off the frame clock), so a
 * scripted shot leaves it out for the same reason wind is off — measured, two runs of a watery URL differ.
 * Pass `water=1` to shoot the sea deliberately.
 */
function captureUrl(raw: string): string {
  const url = new URL(raw);
  if (!url.searchParams.has('panel')) {
    url.searchParams.set('panel', '0');
  }
  if (!url.searchParams.has('water')) {
    url.searchParams.set('water', '0');
  }

  return url.toString();
}

void (async (): Promise<void> => {
  if (!APP_URL) {
    throw new Error('usage: map-viewer-shot.ts <appUrl> <outPng> [timeoutMs]');
  }
  const url = captureUrl(APP_URL);
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal'],
    headless: true,
  });
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  const loads: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('[sa-map-viewer]')) {
      loads.push(text);
      console.log(text);
    } else if (message.type() === 'error') {
      console.log(`console[error] ${text}`);
    }
  });
  page.on('pageerror', (error) => console.log(`pageerror ${error.message}`));

  console.log(`goto ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // The cell-load line is the "ready" signal: the map resolved AND its first cell is on the GPU.
  await page
    .waitForFunction(() => document.querySelectorAll('canvas').length > 0, null, { timeout: TIMEOUT_MS })
    .catch(() => console.log('no canvas — the source failed to load (see the console lines above)'));
  const started = Date.now();
  while (loads.length < 2 && Date.now() - started < TIMEOUT_MS) {
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1500); // let the first frames settle
  await page.screenshot({ path: OUT });
  console.log(`shot ${OUT}`);
  await browser.close();
})();
