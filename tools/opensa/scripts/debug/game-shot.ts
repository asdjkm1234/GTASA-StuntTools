/**
 * Drive the GAME host headlessly and capture one standing pose (plan 104/04). The sibling of
 * `map-viewer-shot.ts`, for the questions that only the real load path can answer — a look A/B of a data
 * change (weather, timecyc, lighting) with the ped on the ground and the world streamed around him.
 *
 *   npx tsx scripts/debug/game-shot.ts '<query>' <outPng> [settleMs] [srcUrl]
 *
 * `query` is the host's own knobs, without the leading `?` — `weather` `hour` `spawn` `look` `scale`
 * `draw` `cargen` `parked` `cleo` … The loader and `src` are supplied for you (`?loader=http-dir`).
 *
 *   npm run serve:static &  npm run dev
 *   npx tsx scripts/debug/game-shot.ts 'weather=9&hour=12&spawn=-1960,505,36&look=-2400,520,30' fog.png
 *
 * THREE things this script exists to get right, each of which cost a round when done by hand:
 *
 * - **A guessed spawn `z` drops the player into the void** — `?spawn` does not wait for collision the way
 *   `?spawncar` does, and a z over unstreamed ground reads `grounded 0` at z ≈ −3900 with an empty frame.
 *   Read a real surface height out of `dump-cell.ts <x> <y> build/<game>/opensa/pak` FIRST. This script
 *   prints the HUD, so `grounded` and the live position are in the log next to the picture.
 * - **`weather` and the player's CITY have to be chosen together.** The zone system rewrites a weather that
 *   has no variant for the region the player is in (`weatherForCity`), so a `FOGGY_SF` forced in Los Santos
 *   is `SUNNY_LA` before the first frame. Stand in SF for the SF weathers.
 * - **Aim is not sight.** `look` points the camera at a world point; whether anything is VISIBLE along that
 *   bearing is a separate question, and two clean 600 u bearings in LS gave a fence and a rooftop wall.
 *
 * The boot lines it echoes are the ones that say what the run actually read — `[timecyc]` names the timecyc
 * file that won, which is the only way to know which table a capture photographed.
 */
import { chromium } from 'playwright';

const QUERY = process.argv[2] ?? '';
const OUT = process.argv[3] ?? 'game-shot.png';
const SETTLE_MS = Number(process.argv[4] ?? 20000);
const SRC = process.argv[5] ?? 'http://localhost:3001/build/original/opensa';
const APP = 'http://localhost:5173/';

void (async (): Promise<void> => {
  if (!QUERY) {
    throw new Error("usage: game-shot.ts '<query>' <outPng> [settleMs] [srcUrl]");
  }
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal'],
    headless: true,
  });
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { height: 900, width: 1440 } });
  const boot: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('[timecyc]') || text.startsWith('[vehicles]') || message.type() === 'error') {
      boot.push(`${message.type()}: ${text}`);
    }
  });
  page.on('pageerror', (error) => boot.push(`pageerror: ${error.message}`));

  const url = `${APP}?loader=http-dir&src=${encodeURIComponent(SRC)}&${QUERY}`;
  console.log(`goto ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const run = page.getByText('RUN SAN ANDREAS', { exact: false });
  await run
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => console.log('run button never appeared'));
  if (await run.count()) {
    await run.first().click();
  }
  const ok = page.getByText('OK', { exact: true });
  await ok
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(async () => ok.first().click())
    .catch(() => undefined); // no disclaimer on the http-dir loader
  await page.waitForSelector('canvas', { timeout: 240000 });
  await page.waitForTimeout(SETTLE_MS);

  const hud = await page.evaluate(() => document.getElementById('engine-hud')?.textContent ?? '(no hud)');
  // The capture overlay eats the frame's bottom-right corner and carries a live fps line.
  await page.addStyleTag({ content: '.sa-capture{display:none !important}' }).catch(() => undefined);
  await page.screenshot({ path: OUT });

  console.log(`hud ${hud.replace(/\s+/g, ' ').trim().slice(0, 400)}`);
  for (const line of boot.slice(0, 20)) {
    console.log(line);
  }
  console.log(`shot ${OUT}`);
  await browser.close();
})();
