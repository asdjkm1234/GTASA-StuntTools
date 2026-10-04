/**
 * Baseline verification of the v8 flight effects (Hydra jet plume, engine smoke, explosion burst).
 *
 * Drives the replay in the installed Chrome over the DevTools protocol with a FRESH throwaway profile
 * (the same boilerplate as `capture-replay.mjs`) and asserts on REAL data only: pixels decoded from the
 * screenshots and events sampled from the CSV — never on console/log text. Scrubbing forward and back to
 * the same time must decode to the same pixels, because the FX driver rebuilds its particle window from
 * the recorded clock (see `apps/web/src/flight/fx.ts`).
 *
 *   node scripts/test-flight-fx.mjs [hydra.csv] [rustler.csv]
 *
 * Defaults to the two v8 recordings in `..\..\GTA San Andreas\flight_recordings`. A single argument runs
 * the Hydra scenario only; a recording with no explosion event fails fast with `no explosion event found`
 * (the negative fixture this script writes to `captures\fixture-no-events.csv`).
 *
 * The screenshots document the nozzle-derived plume only. `deriveNozzleAngle` is an approximate, INFERRED
 * sprite effect using the raw 0..5000 control value. It does not isolate the physical nozzle geometry;
 * scripts/test-hydra-nozzles.{mts,mjs} verify the stock wheel_lm/rm nozzle assemblies separately.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import pngjs from 'pngjs';

const { PNG } = pngjs;

// ---------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const RECORDINGS = join(REPO_ROOT, 'GTA San Andreas', 'flight_recordings');
const CAPTURES = join(process.cwd(), 'captures');
const EVIDENCE = join(REPO_ROOT, '.omo', 'evidence');
const ORIGIN = 'http://127.0.0.1:4173';

const HYDRA_CSV = process.argv[2] ?? join(RECORDINGS, 'flight_20260926_153900_322_m520_001.csv');
const RUSTLER_CSV = process.argv[3] ?? join(RECORDINGS, 'flight_20260926_155714_107_m476_001.csv');
const SINGLE_CSV = !process.argv[3];

const HYDRA_MODEL = 520;
const RUSTLER_MODEL = 476;
const EXPECTED_SMOKE_SAMPLES = 181; // Hydra rows with smoke_active = 1 (the documented count)
const EXPECTED_EXPLOSIONS = 1;

// Ground-hold window: the Hydra is stationary while the nozzle control sweeps 5000 -> 0, so one fixed
// camera can see both ends of the sweep.
const PLUME_T1 = 0.424; // nozzle_rotation 5000 (down)
const PLUME_T2 = 2.339; // nozzle_rotation 3018 (~54 deg) — same spot, distinct control value
// A second, pose-stable pair: the airframe orientation differs by ~1.6 deg and the position by ~1.2 units,
// so nearly every changed pixel is the nozzle sweep (3786 -> 3178 raw control) and not the airframe turning.
const PLUME_STABLE_T1 = 1.702; // nozzle_rotation 3786
const PLUME_STABLE_T2 = 2.204; // nozzle_rotation 3178
const RUSTLER_T = 19.4;

// A few hard thresholds, all measured before being frozen (printed with every run).
const PLUME_MIN_CHANGED = 1500; // pixels that differ between the two nozzle poses
const PLUME_STABLE_MIN_CHANGED = 3000; // baseline run measured ~19.6k changed pixels for this pair
const EXPLOSION_MIN_BRIGHT = 200; // pixels much brighter in the burst frame than just before it
const EXPLOSION_BRIGHT_THRESHOLD = 90; // summed-RGB increase counted as a bright pixel
const RUSTLER_MIN_VISIBLE = 0.02; // share of non-black pixels in the Rustler frame

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

// ---------------------------------------------------------------------------------------------------
// CSV reading (the same column names/clock as `apps/web/src/flight/csv.ts`)
// ---------------------------------------------------------------------------------------------------

function assertRecording(recording, { explosions, label, model, smokeSamples }) {
  // Explosion events are checked first so the negative fixture fails with its exact, expected message.
  assert(
    recording.events.length === explosions,
    recording.events.length === 0
      ? 'no explosion event found'
      : `${label}: expected ${explosions} explosion event(s), found ${recording.events.length}`,
  );
  assert(
    recording.eventLines === explosions,
    `${label}: expected ${explosions} '# event' line(s), found ${recording.eventLines}`,
  );
  assert(recording.model === model, `${label}: expected model ${model}, found ${recording.model}`);
  assert(
    recording.smokeSamples === smokeSamples,
    `${label}: expected smoke_active count ${smokeSamples}, found ${recording.smokeSamples}`,
  );
}

function parseRecording(text, name) {
  const lines = text.trim().split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith('local_timestamp,'));
  if (headerIndex < 0) {
    throw new Error(`${name}: not a FlightRecorder CSV (no local_timestamp header)`);
  }
  const header = lines[headerIndex].split(',').map((cell) => cell.trim());
  const at = new Map(header.map((cell, index) => [cell, index]));
  const cell = (cells, column) => {
    const raw = cells[at.get(column)];
    return raw === undefined || raw === '' ? NaN : Number(raw);
  };
  const eventLines = lines.filter((line) => /^# event,/.test(line));
  const events = eventLines
    .map((line) => line.split(',').map((part) => part.trim()))
    .filter(([, , kind]) => kind === 'explosion')
    .map(([, seconds, , x, y, z]) => ({ pos: [Number(x), Number(y), Number(z)], s: Number(seconds) }))
    .filter((event) => Number.isFinite(event.s) && event.pos.every(Number.isFinite));

  const rows = [];
  let baseTime = null;
  let smokeSamples = 0;
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const cells = line.split(',');
    const x = cell(cells, 'x');
    const y = cell(cells, 'y');
    const z = cell(cells, 'z');
    if (![x, y, z].every(Number.isFinite)) {
      continue;
    }
    const timeMs = Date.parse(cells[at.get('local_timestamp')]);
    if (baseTime === null && Number.isFinite(timeMs)) {
      baseTime = timeMs;
    }
    const smoke = cell(cells, 'smoke_active');
    if (Number.isFinite(smoke) && smoke > 0) {
      smokeSamples += 1;
    }
    rows.push({
      forward: [cell(cells, 'forward_x'), cell(cells, 'forward_y'), cell(cells, 'forward_z')],
      health: cell(cells, 'health'),
      model: cell(cells, 'model'),
      nozzle: cell(cells, 'nozzle_rotation'),
      pos: [x, y, z],
      right: [cell(cells, 'right_x'), cell(cells, 'right_y'), cell(cells, 'right_z')],
      s:
        baseTime === null || Number.isNaN(timeMs)
          ? rows.length
            ? rows[rows.length - 1].s + 0.04
            : 0
          : (timeMs - baseTime) / 1000,
      smoke,
      up: [cell(cells, 'up_x'), cell(cells, 'up_y'), cell(cells, 'up_z')],
    });
  }
  if (rows.length < 2) {
    throw new Error(`${name}: not enough samples`);
  }

  return { eventLines: eventLines.length, events, model: rows[0].model, name, rows, smokeSamples };
}

// ---------------------------------------------------------------------------------------------------
// Track sampling and camera maths (mirrors csv.ts `sampleTrack` and free-camera `lookAt`)
// ---------------------------------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
const normalize = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;

  return scale(v, 1 / length);
};
const gtaPosition = (p) => [p[0], p[2], -p[1]];
const gtaDirection = (v) => [v[0], v[2], -v[1]];

/** An `exportView` the page accepts: fixed eye + yaw/pitch aimed at `target` (`FreeCamera.lookAt`). */
function cameraView(position, target) {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const dz = target[2] - position[2];

  return {
    mode: 'free',
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
    position: position.map((value) => Number(value.toFixed(3))),
    yaw: Math.atan2(dx, -dz),
  };
}

/** Engine-space right/up/forward of a sampled pose (the ONE GTA -> engine swap, `math.ts`). */
function engineBasis(pose) {
  return {
    forward: normalize(gtaDirection(pose.forward)),
    right: normalize(gtaDirection(pose.right)),
    up: normalize(gtaDirection(pose.up)),
  };
}

function sampleAt(rows, seconds) {
  if (seconds <= rows[0].s) {
    return rows[0];
  }
  const last = rows[rows.length - 1];
  if (seconds >= last.s) {
    return last;
  }
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].s <= seconds) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = rows[lo];
  const b = rows[hi];
  const t = (seconds - a.s) / Math.max(1e-6, b.s - a.s);

  return {
    forward: a.forward.map((value, index) => lerp(value, b.forward[index], t)),
    health: lerp(a.health, b.health, t),
    nozzle: lerp(a.nozzle, b.nozzle, t),
    pos: [lerp(a.pos[0], b.pos[0], t), lerp(a.pos[1], b.pos[1], t), lerp(a.pos[2], b.pos[2], t)],
    right: a.right.map((value, index) => lerp(value, b.right[index], t)),
    s: seconds,
    up: a.up.map((value, index) => lerp(value, b.up[index], t)),
  };
}

// ---------------------------------------------------------------------------------------------------
// PNG pixel comparison
// ---------------------------------------------------------------------------------------------------

const readPng = (path) => PNG.sync.read(readFileSync(path));

function assertSameSize(a, b, what) {
  assert(
    a.width === b.width && a.height === b.height,
    `${what}: screenshot sizes differ (${a.width}x${a.height} vs ${b.width}x${b.height})`,
  );
}

/** Pixels where `burst` is much brighter than `pre` (summed RGB delta above `threshold`). */
function brighterPixels(pre, burst, rows, threshold) {
  assertSameSize(pre, burst, 'explosion');
  const height = Math.max(1, Math.min(rows, pre.height));
  let bright = 0;
  let maxGain = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < pre.width; x += 1) {
      const ia = (pre.width * y + x) * 4;
      const ib = (burst.width * y + x) * 4;
      const before = pre.data[ia] + pre.data[ia + 1] + pre.data[ia + 2];
      const after = burst.data[ib] + burst.data[ib + 1] + burst.data[ib + 2];
      const gain = after - before;
      if (gain > threshold) {
        bright += 1;
      }
      if (gain > maxGain) {
        maxGain = gain;
      }
    }
  }

  return { bright, maxGain, pixels: height * pre.width };
}

/**
 * Where the changed pixels are: inside the central box (which holds the fixed camera's look-at target,
 * so the airframe and its plume) versus outside it (the rest of the world). A change that is really the FX
 * is localized there; a sun/streaming change would repaint the whole frame.
 */
function changeLocation(a, b, rows) {
  assertSameSize(a, b, 'localization');
  const height = Math.max(1, Math.min(rows, a.height));
  const x0 = Math.floor(a.width * 0.3);
  const x1 = Math.floor(a.width * 0.7);
  const y0 = Math.floor(height * 0.15);
  const y1 = Math.floor(height * 0.85);
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const ia = (a.width * y + x) * 4;
      const ib = (b.width * y + x) * 4;
      const delta = Math.max(
        Math.abs(a.data[ia] - b.data[ib]),
        Math.abs(a.data[ia + 1] - b.data[ib + 1]),
        Math.abs(a.data[ia + 2] - b.data[ib + 2]),
      );
      if (delta > 2) {
        if (x >= x0 && x < x1 && y >= y0 && y < y1) {
          inside += 1;
        } else {
          outside += 1;
        }
      }
    }
  }

  return { inside, outside, total: inside + outside };
}

/** Compare the top `rows` image rows (the analysis HUD is excluded, so only the 3D view is measured). */
function comparePixels(a, b, rows, what) {
  assertSameSize(a, b, what);
  const height = Math.max(1, Math.min(rows, a.height));
  let changed = 0;
  let maxDelta = 0;
  let sumDelta = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const ia = (a.width * y + x) * 4;
      const ib = (b.width * y + x) * 4;
      const dr = Math.abs(a.data[ia] - b.data[ib]);
      const dg = Math.abs(a.data[ia + 1] - b.data[ib + 1]);
      const db = Math.abs(a.data[ia + 2] - b.data[ib + 2]);
      const delta = Math.max(dr, dg, db);
      if (delta > 2) {
        changed += 1;
      }
      if (delta > maxDelta) {
        maxDelta = delta;
      }
      sumDelta += delta;
    }
  }

  return { changed, maxDelta, meanDelta: sumDelta / (height * a.width), pixels: height * a.width };
}

async function serverUp() {
  try {
    const response = await fetch(`${ORIGIN}/`, { redirect: 'follow', signal: AbortSignal.timeout(2500) });

    return response.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------
// Server + browser lifecycle
// ---------------------------------------------------------------------------------------------------

/** Share of pixels that are clearly not the black background. */
function visibleShare(png, rows) {
  const height = Math.max(1, Math.min(rows, png.height));
  let visible = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (png.width * y + x) * 4;
      if (png.data[i] + png.data[i + 1] + png.data[i + 2] > 45) {
        visible += 1;
      }
    }
  }

  return visible / (height * png.width);
}

let serverChild = null;
let serverStarted = false;

/**
 * Leave an existing server alone; only start one when 127.0.0.1:4173 refuses connections.
 * `local-server.mjs` resolves `dist/` and `../GTA San Andreas` against its own cwd, so the process is
 * launched with cwd=`web-replay` (the same layout `start-replay.cmd` uses) while the script path stays
 * repo-relative.
 */
async function ensureServer() {
  if (await serverUp()) {
    console.log(`server: already running at ${ORIGIN} (left untouched)`);

    return;
  }
  serverChild = spawn(process.execPath, ['local-server.mjs'], {
    cwd: join(REPO_ROOT, 'web-replay'),
    stdio: 'ignore',
    windowsHide: true,
  });
  serverStarted = true;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(500);
    if (await serverUp()) {
      console.log(`server: started ${ORIGIN} (pid ${serverChild.pid})`);

      return;
    }
    assert(serverChild.exitCode === null, `server: process exited early with code ${serverChild.exitCode}`);
  }
  throw new Error('server did not answer on 4173 within 30s');
}

function killTree(child) {
  if (!child) {
    return;
  }
  try {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
}

let chromeChild = null;

process.on('exit', () => {
  killTree(chromeChild);
  if (serverStarted) {
    killTree(serverChild);
  }
});

const freePort = () =>
  new Promise((done, fail) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

async function launchChrome(url) {
  const chrome = CHROME_PATHS.find((path) => existsSync(path));
  assert(chrome, 'Chrome not found (looked in Program Files and LOCALAPPDATA)');
  const profile = join(tmpdir(), `opensa-flight-fx-${Date.now()}`); // fresh throwaway profile, never reused
  const port = await freePort();
  chromeChild = spawn(
    chrome,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      url,
    ],
    { stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      // Chrome is not listening yet
    }
  }
  throw new Error('could not connect to Chrome over CDP');
}

// ---------------------------------------------------------------------------------------------------
// Scene driving
// ---------------------------------------------------------------------------------------------------

async function main() {
  mkdirSync(CAPTURES, { recursive: true });
  mkdirSync(EVIDENCE, { recursive: true });

  const hydraPath = resolve(HYDRA_CSV);
  const rustlerPath = resolve(RUSTLER_CSV);
  const hydraText = readFileSync(hydraPath, 'utf8');
  const hydra = parseRecording(hydraText, basename(hydraPath));
  assertRecording(hydra, {
    explosions: EXPECTED_EXPLOSIONS,
    label: basename(hydraPath),
    model: HYDRA_MODEL,
    smokeSamples: EXPECTED_SMOKE_SAMPLES,
  });
  console.log(
    `csv: ${basename(hydraPath)} model ${hydra.model}, smoke_active=${hydra.smokeSamples}, explosions=${hydra.events.length}`,
  );

  // The negative fixture is a copy of the Hydra recording with its `# event` lines removed.
  if (hydra.eventLines > 0) {
    const fixture = join(CAPTURES, 'fixture-no-events.csv');
    writeFileSync(
      fixture,
      hydraText
        .split(/\r?\n/)
        .filter((line) => !line.startsWith('# event,'))
        .join('\n'),
    );
    console.log(`fixture: wrote ${fixture} (no '# event' lines)`);
  }

  const rustler = SINGLE_CSV ? null : parseRecording(readFileSync(rustlerPath, 'utf8'), basename(rustlerPath));
  if (rustler) {
    assertRecording(rustler, { explosions: 0, label: basename(rustlerPath), model: RUSTLER_MODEL, smokeSamples: 0 });
    console.log(`csv: ${basename(rustlerPath)} model ${rustler.model}, smoke_active=0, explosions=0`);
  }

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  writeFileSync(join(EVIDENCE, 'baseline-commit.txt'), `${head}\n`);
  console.log(`baseline commit: ${head} -> .omo/evidence/baseline-commit.txt`);

  await ensureServer();
  const browser = await launchChrome(`${ORIGIN}/opensa/flight-replay.html`);
  const context = browser.contexts()[0];
  const hydraCsvName = basename(hydraPath);
  // `addFiles` selects the LAST added track, so the target of a scene is listed last.
  const hydraScenePaths = rustler ? [rustlerPath, hydraPath] : [hydraPath];
  const rustlerScenePaths = rustler ? [hydraPath, rustlerPath] : [];

  try {
    const plume = await runPlumeScene(context, hydra, hydraScenePaths, hydraCsvName);
    const explosion = await runExplosionScene(context, hydra, hydraScenePaths, hydraCsvName);
    const rustlerResult = rustler
      ? await runRustlerScene(context, rustler, rustlerScenePaths, basename(rustlerPath))
      : null;
    console.log('--- summary ---');
    console.log(
      JSON.stringify(
        {
          explosion: {
            brightPixels: explosion.burst.bright,
            maxGain: explosion.burst.maxGain,
            scrubChangedPixels: explosion.determinism.changed,
          },
          explosions: hydra.events.length,
          plume: {
            changedPixels: plume.delta.changed,
            nozzlePair: [sampleAt(hydra.rows, PLUME_T1).nozzle, sampleAt(hydra.rows, PLUME_T2).nozzle],
            poseStableChangedPixels: plume.stableDelta.changed,
            scrubChangedPixels: plume.determinism.changed,
          },
          rustler: rustlerResult
            ? {
                scrubChangedPixels: rustlerResult.determinism.changed,
                visibleShare: Number(rustlerResult.visible.toFixed(4)),
              }
            : 'skipped (single CSV)',
          smokeSamples: hydra.smokeSamples,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close().catch(() => {});
    killTree(chromeChild);
    chromeChild = null;
  }
  if (serverStarted) {
    killTree(serverChild);
    serverChild = null;
  }
}

/**
 * Open one video-export page (fixed free camera), load every CSV and make `targetName` active.
 * `csvPaths` must list the target LAST: `addFiles` selects the last added track, so nothing can race the
 * selection back afterwards.
 */
async function openScene(context, view, csvPaths, targetName, aircraftNeedle) {
  assert(basename(csvPaths[csvPaths.length - 1]) === targetName, `scene: target ${targetName} must be the last CSV`);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error(`[console.error] ${message.text()}`);
    }
  });
  page.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => {});
  });
  const query = new URLSearchParams({ exportView: JSON.stringify(view), videoExport: '1' });
  await page.goto(`${ORIGIN}/opensa/flight-replay.html?${query}`, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__flight?.worldReady === true, undefined, { timeout: 180000 });
  // Let the automatic `local=latest` load finish before adding ours, or its async aircraft load can land
  // after ours and show the wrong model.
  await page
    .waitForFunction(
      () => {
        const flight = globalThis.__flight;
        const hasTrack = document.querySelectorAll('.track').length > 0;
        return !hasTrack || (flight?.phase === 'rendering' && flight.aircraft !== 'none');
      },
      undefined,
      { timeout: 120000 },
    )
    .catch(() => {});
  await page.setInputFiles('#picker', csvPaths);
  const names = csvPaths.map((path) => basename(path));
  await page.waitForFunction(
    (wanted) =>
      wanted.every((name) => [...document.querySelectorAll('.track-name')].some((node) => node.textContent === name)),
    names,
    { timeout: 60000 },
  );
  await page
    .waitForFunction(
      (name) => {
        const active = document.querySelector('.track.active .track-name');
        return active?.textContent === name;
      },
      targetName,
      { timeout: 60000 },
    )
    .catch(async () => {
      await page.evaluate((name) => {
        const node = [...document.querySelectorAll('.track')]
          .filter((item) => item.querySelector('.track-name')?.textContent === name)
          .at(-1);
        if (!node) {
          throw new Error(`track ${name} not selectable`);
        }
        node.click();
      }, targetName);
      await page.waitForFunction(
        (name) => {
          const active = document.querySelector('.track.active .track-name');
          return active?.textContent === name;
        },
        targetName,
        { timeout: 60000 },
      );
    });
  await page.waitForFunction(
    (needle) => (globalThis.__flight?.aircraft ?? '').toLowerCase().includes(needle),
    aircraftNeedle,
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () => globalThis.__flight?.phase === 'rendering' && (globalThis.__flight?.renders ?? 0) > 0,
    undefined,
    { timeout: 120000 },
  );
  // `ready()` is what applies the fixed free camera and waits for the aircraft + streamed cells.
  await page.evaluate(() => globalThis.__flightVideoExport.ready());
  const state = await page.evaluate(() => ({
    active: document.querySelector('.track.active .track-name')?.textContent ?? null,
    aircraft: globalThis.__flight?.aircraft ?? '',
  }));
  assert(state.active === targetName, `scene: active track is '${state.active}', expected '${targetName}'`);
  assert(
    state.aircraft.toLowerCase().includes(aircraftNeedle),
    `scene: loaded aircraft is '${state.aircraft}', expected ${aircraftNeedle}`,
  );
  const hudTop = null; // No overlay hides scene particles.
  const viewport = await page.evaluate(() => ({ dpr: window.devicePixelRatio || 1, height: window.innerHeight }));
  const rows = Math.max(1, Math.floor(((hudTop ?? viewport.height - 300) - 8) * viewport.dpr));
  console.log(`  scene ready: hudTop=${hudTop === null ? 'none' : hudTop.toFixed(0)} comparisonRows=${rows}px`);

  return { page, rows };
}

// ---------------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------------

async function renderAndShoot(page, seconds, path) {
  await page.evaluate((value) => globalThis.__flightVideoExport.renderFrame(value), seconds);
  await page.screenshot({ path });
  const state = await page.evaluate(() => ({
    error: globalThis.__flight?.error ?? null,
    phase: globalThis.__flight?.phase,
    renders: globalThis.__flight?.renders ?? 0,
  }));
  assert(!state.error, `replay error at s=${seconds}: ${state.error}`);
  console.log(`  shot ${basename(path)} @ ${seconds.toFixed(3)}s (phase ${state.phase}, renders ${state.renders})`);

  return path;
}

async function runExplosionScene(context, hydra, csvPaths, hydraCsvName) {
  const event = hydra.events[0];
  const pre = event.s - 0.5;
  const post = event.s + 1;
  const crash = gtaPosition(event.pos);
  const before = engineBasis(sampleAt(hydra.rows, event.s - 0.2));
  const view = cameraView(
    add(crash, add(scale(before.right, 30), add(scale(before.up, 9), scale(before.forward, -10)))),
    add(crash, [0, 2, 0]),
  );

  console.log(
    `explosion scene: event s=${event.s.toFixed(6)} at ${JSON.stringify(event.pos)}, fixed camera ${JSON.stringify(view.position)}`,
  );
  const { page, rows } = await openScene(context, view, csvPaths, hydraCsvName, 'hydra');
  const shotPre = await renderAndShoot(page, pre, join(CAPTURES, 'fx-hydra-explosion-pre.png'));
  const shotEvent = await renderAndShoot(page, event.s, join(CAPTURES, 'fx-hydra-explosion-event.png'));
  const shotPost = await renderAndShoot(page, post, join(CAPTURES, 'fx-hydra-explosion-post.png'));
  // Forward past the burst, then BACK to it: identical pixels prove the particle window is clock-derived.
  await renderAndShoot(page, post, join(CAPTURES, 'fx-hydra-explosion-post-scrub.png'));
  const shotEventAgain = await renderAndShoot(page, event.s, join(CAPTURES, 'fx-hydra-explosion-event-again.png'));
  await page.close();

  const burst = brighterPixels(readPng(shotPre), readPng(shotEvent), rows, EXPLOSION_BRIGHT_THRESHOLD);
  const lingering = brighterPixels(readPng(shotPre), readPng(shotPost), rows, EXPLOSION_BRIGHT_THRESHOLD);
  const determinism = comparePixels(readPng(shotEvent), readPng(shotEventAgain), rows, 'explosion scrub');
  console.log(
    `  measured: burst bright=${burst.bright}/${burst.pixels} (max gain ${burst.maxGain}), post bright=${lingering.bright}, scrub changed=${determinism.changed} (max ${determinism.maxDelta})`,
  );
  assert(
    burst.bright > EXPLOSION_MIN_BRIGHT,
    `explosion burst not visible: only ${burst.bright} pixels brightened (need > ${EXPLOSION_MIN_BRIGHT})`,
  );
  assert(burst.maxGain > 255, `explosion burst too weak: max summed-RGB gain ${burst.maxGain}`);
  assert(
    determinism.changed === 0,
    `scrub determinism broken: ${determinism.changed} pixels differ at the event time (max delta ${determinism.maxDelta})`,
  );

  return { burst, determinism, lingering };
}

async function runPlumeScene(context, hydra, csvPaths, hydraCsvName) {
  const t1 = sampleAt(hydra.rows, PLUME_T1);
  const t2 = sampleAt(hydra.rows, PLUME_T2);
  const stable1 = sampleAt(hydra.rows, PLUME_STABLE_T1);
  const stable2 = sampleAt(hydra.rows, PLUME_STABLE_T2);
  assert(t1.nozzle !== null && t2.nozzle !== null, 'plume: nozzle_rotation missing on the Hydra recording');
  assert(
    Math.abs(t1.nozzle - t2.nozzle) > 500,
    `plume: expected distinct nozzle_rotation, got ${t1.nozzle} and ${t2.nozzle}`,
  );
  assert(t1.health > 0 && t2.health > 0, 'plume: the jet plume only spawns while health > 0');
  assert(
    Math.abs(stable1.nozzle - stable2.nozzle) > 300,
    `plume: stable pair nozzle delta too small (${stable1.nozzle} -> ${stable2.nozzle})`,
  );

  const centre = [
    lerp(gtaPosition(t1.pos)[0], gtaPosition(t2.pos)[0], 0.5),
    lerp(gtaPosition(t1.pos)[1], gtaPosition(t2.pos)[1], 0.5),
    lerp(gtaPosition(t1.pos)[2], gtaPosition(t2.pos)[2], 0.5),
  ];
  const basis = engineBasis(sampleAt(hydra.rows, (PLUME_T1 + PLUME_T2) / 2));
  const view = cameraView(
    add(centre, add(scale(basis.right, 24), add(scale(basis.up, 6), scale(basis.forward, 2)))),
    add(centre, add(scale(basis.forward, -5), scale(basis.up, -1.5))),
  );

  console.log(
    `plume scene: nozzle ${t1.nozzle} -> ${t2.nozzle}, pose-stable pair ${stable1.nozzle} -> ${stable2.nozzle}, fixed camera ${JSON.stringify(view.position)}`,
  );
  const { page, rows } = await openScene(context, view, csvPaths, hydraCsvName, 'hydra');
  const shotT1 = await renderAndShoot(page, PLUME_T1, join(CAPTURES, 'fx-hydra-plume-nozzle5000.png'));
  const shotT2 = await renderAndShoot(page, PLUME_T2, join(CAPTURES, 'fx-hydra-plume-nozzle3018.png'));
  const shotStable1 = await renderAndShoot(
    page,
    PLUME_STABLE_T1,
    join(CAPTURES, 'fx-hydra-plume-stable-nozzle3786.png'),
  );
  const shotStable2 = await renderAndShoot(
    page,
    PLUME_STABLE_T2,
    join(CAPTURES, 'fx-hydra-plume-stable-nozzle3178.png'),
  );
  // Scrub BACK to the first pose, then FORWARD again to the second: the same time must render the same.
  await renderAndShoot(page, PLUME_T1, join(CAPTURES, 'fx-hydra-plume-backward.png'));
  const shotT2Again = await renderAndShoot(page, PLUME_T2, join(CAPTURES, 'fx-hydra-plume-nozzle3018-again.png'));
  await page.close();

  const delta = comparePixels(readPng(shotT1), readPng(shotT2), rows, 'plume delta');
  const stableDelta = comparePixels(readPng(shotStable1), readPng(shotStable2), rows, 'plume stable delta');
  const stableLocation = changeLocation(readPng(shotStable1), readPng(shotStable2), rows);
  const determinism = comparePixels(readPng(shotT2), readPng(shotT2Again), rows, 'plume scrub');
  console.log(
    `  measured: plume delta changed=${delta.changed}/${delta.pixels} (max ${delta.maxDelta}), pose-stable delta changed=${stableDelta.changed} (max ${stableDelta.maxDelta}, outside ${stableLocation.outside}), scrub changed=${determinism.changed} (max ${determinism.maxDelta})`,
  );
  assert(
    delta.changed > PLUME_MIN_CHANGED,
    `plume delta too small: ${delta.changed} changed pixels (need > ${PLUME_MIN_CHANGED})`,
  );
  assert(
    stableDelta.changed > PLUME_STABLE_MIN_CHANGED,
    `pose-stable plume delta too small: ${stableDelta.changed} changed pixels (need > ${PLUME_STABLE_MIN_CHANGED})`,
  );
  assert(
    stableLocation.outside / Math.max(1, stableLocation.total) < 0.15,
    `pose-stable plume delta is not localized: ${stableLocation.outside}/${stableLocation.total} changed pixels are outside the central view`,
  );
  assert(
    determinism.changed === 0,
    `scrub determinism broken: ${determinism.changed} pixels differ at the same time (max delta ${determinism.maxDelta})`,
  );

  return { delta, determinism, stableDelta };
}

// ---------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------

async function runRustlerScene(context, rustler, csvPaths, rustlerCsvName) {
  assert(rustler.events.length === 0, `rustler: expected no explosion events, found ${rustler.events.length}`);
  assert(rustler.smokeSamples === 0, `rustler: expected no smoke_active samples, found ${rustler.smokeSamples}`);
  assert(
    rustler.rows.every((row) => row.nozzle < 0),
    'rustler: nozzle_rotation should be absent (-1)',
  );

  const pose = sampleAt(rustler.rows, RUSTLER_T);
  const centre = gtaPosition(pose.pos);
  const basis = engineBasis(pose);
  const view = cameraView(
    add(centre, add(scale(basis.right, 20), add(scale(basis.up, 6), scale(basis.forward, -4)))),
    centre,
  );

  console.log(`rustler scene: fixed camera ${JSON.stringify(view.position)} at s=${RUSTLER_T}`);
  const { page, rows } = await openScene(context, view, csvPaths, rustlerCsvName, 'rustler');
  const shot = await renderAndShoot(page, RUSTLER_T, join(CAPTURES, 'fx-rustler-view.png'));
  const shotAgain = await renderAndShoot(page, RUSTLER_T, join(CAPTURES, 'fx-rustler-view-again.png'));
  const model = await page.evaluate(() => globalThis.__flight?.aircraft ?? '');
  await page.close();

  const visible = visibleShare(readPng(shot), rows);
  const determinism = comparePixels(readPng(shot), readPng(shotAgain), rows, 'rustler scrub');
  console.log(
    `  measured: aircraft='${model}', visible share=${(visible * 100).toFixed(1)}%, scrub changed=${determinism.changed}`,
  );
  assert(model.toLowerCase().includes('rustler'), `rustler: expected the rustler model, page reports '${model}'`);
  assert(
    visible > RUSTLER_MIN_VISIBLE,
    `rustler frame looks empty: only ${(visible * 100).toFixed(2)}% non-black pixels`,
  );
  assert(determinism.changed === 0, `rustler scrub determinism broken: ${determinism.changed} pixels differ`);

  return { determinism, visible };
}

main().then(
  () => {
    console.log('PASS: baseline flight FX verified');
    process.exitCode = 0;
  },
  (error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
