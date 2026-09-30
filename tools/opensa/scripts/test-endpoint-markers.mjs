/**
 * Acceptance test for the 3D world endpoint marker layer (`apps/web/src/flight/endpoint-markers.ts`).
 *
 * Drives the installed replay page in a FRESH throwaway Chrome profile over CDP (the same boilerplate as
 * `test-flight-fx.mjs`) and asserts from the `window.__flight` debug probe, never from a screenshot: the
 * marker count, the endpoint track-ID set and the density maximum must equal the endpoint model the CSVs
 * produce. The screenshots are evidence that the layer draws; they are not the completeness oracle.
 *
 *   node scripts/test-endpoint-markers.mjs <csv1> <csv2> <csv3>
 *       Happy path (defaults to the three plan recordings). Asserts markerCount === endpointCount ===
 *       validTrackCount and the track-ID set, runs the SAME import twice on two fresh pages and requires
 *       identical probe counts, imports a malformed CSV through the picker and requires the counts to stay
 *       exactly as they were (the app reports the bad file; no marker is hidden or dropped), then loads the
 *       committed coincident fixture (two samples at ONE coordinate) twice and asserts two coincident
 *       endpoints form one density cluster (densityMax >= 2, halos >= 1) while markerCount still equals the
 *       valid track count (2), and that the buffer was RECREATED (capacity doubled) when the endpoint count
 *       changed 1 -> 2. A malformed CLI argument is skipped and reported; the run continues on the readable
 *       recordings, so the asserted counts stay consistent with what was actually imported.
 *
 *   node scripts/test-endpoint-markers.mjs <fixture.csv>
 *       Failure path: the single argument is a zero-endpoint fixture. The script guarantees the fixture (a
 *       recorder header with no sample rows) and expects the probe to report count 0, an empty track-ID set
 *       and no page error, exiting 0.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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
const EVIDENCE_STEM = 'task-13-flight-analysis-remediation-and-worktree-cleanup';
const ORIGIN = 'http://127.0.0.1:4173';
const FIXTURES = join(process.cwd(), 'apps', 'web', 'src', 'flight', 'fixtures');

const DEFAULT_CSVS = [
  join(RECORDINGS, 'flight_20260926_153900_322_m520_001.csv'),
  join(RECORDINGS, 'flight_20260926_044304_980_m520_050.csv'),
  join(RECORDINGS, 'flight_20260926_044255_679_m520_049.csv'),
];
// Committed synthetic recording: two samples at the SAME coordinate, so one import is one endpoint and a
// second import is a true coincident pair (two tracks, two markers, one density cluster).
const COINCIDENT_FIXTURE = join(FIXTURES, 'coincident-endpoints.csv');
const COINCIDENT_TWIN = join(CAPTURES, 'fixture-coincident-endpoints-b.csv');
// Not a recorder CSV at all. The app must report it (alert) and skip it without touching the marker probe.
const MALFORMED_FIXTURE = join(CAPTURES, 'fixture-malformed.csv');
const MALFORMED_TEXT = 'this is not a FlightRecorder CSV\nno header, no samples, no tracks\n';

// A recorder-shaped header with ZERO sample rows: the parser rejects it ("not enough samples"), so it must
// contribute zero tracks and zero endpoints without a page-level error.
const ZERO_FIXTURE_TEXT = [
  '# session_start,2026-09-26T00:00:00Z',
  'local_timestamp,model,health,x,y,z,capture_elapsed_s',
  '# session_end,game_closed,2026-09-26T00:00:01Z',
  '',
].join('\n');

// Frozen after the first measured run (printed with every run): saturated-marker pixels in a canvas shot.
const RED_MIN_WIDE = 30; // three markers seen from the wide fixed camera
const RED_MIN_COINCIDENT = 200; // one close-up marker with a density halo
const RED_HUE_MIN = 50; // r - max(g, b) required for a pixel to count as marker red

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
// CSV reading (independent oracle for the endpoint model in `apps/web/src/flight/track-endpoints.ts`)
// ---------------------------------------------------------------------------------------------------

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
    return raw === undefined || raw === '' ? null : Number(raw);
  };
  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const cells = line.split(',');
    const x = cell(cells, 'x');
    const y = cell(cells, 'y');
    const z = cell(cells, 'z');
    if (x === null || y === null || z === null || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }
    rows.push({ pos: [x, y, z] });
  }
  if (rows.length < 2) {
    throw new Error(`${name}: not enough samples`);
  }

  // Every parsed row carries a finite coordinate and the parser defaults health/model to 0, so
  // `finalValidSample` is the last row for a real recording.
  return { endpoint: rows[rows.length - 1].pos, name, rows: rows.length };
}

const gtaToEngine = (p) => [p[0], p[2], -p[1]];

function boundsCenter(points) {
  const lows = [Infinity, Infinity, Infinity];
  const highs = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      lows[axis] = Math.min(lows[axis], point[axis]);
      highs[axis] = Math.max(highs[axis], point[axis]);
    }
  }
  const center = [0, 1, 2].map((axis) => (lows[axis] + highs[axis]) / 2);
  const span = Math.max(...[0, 1, 2].map((axis) => highs[axis] - lows[axis]));

  return { center, span };
}

/** A free-camera `exportView`: eye on a fixed diagonal from `center`, aimed at it. */
function cameraView(center, distance, direction = [0.55, 0.8, 0.75]) {
  const length = Math.hypot(...direction) || 1;
  const position = center.map((value, index) => value + (direction[index] / length) * distance);

  return {
    mode: 'free',
    pitch: Math.atan2(center[1] - position[1], Math.hypot(center[0] - position[0], center[2] - position[2])),
    position: position.map((value) => Number(value.toFixed(3))),
    yaw: Math.atan2(center[0] - position[0], -(center[2] - position[2])),
  };
}

// ---------------------------------------------------------------------------------------------------
// PNG analysis: saturated-red pixels (marker geometry), independent of the DOM
// ---------------------------------------------------------------------------------------------------

const readPng = (path) => PNG.sync.read(readFileSync(path));

function redPixels(png) {
  let red = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (r > 110 && r - Math.max(g, b) > RED_HUE_MIN) {
      red += 1;
    }
  }

  return red;
}

// ---------------------------------------------------------------------------------------------------
// Server + browser lifecycle (only self-started processes are killed)
// ---------------------------------------------------------------------------------------------------

async function serverUp() {
  try {
    const response = await fetch(`${ORIGIN}/`, { redirect: 'follow', signal: AbortSignal.timeout(2500) });

    return response.ok;
  } catch {
    return false;
  }
}

let serverChild = null;
let serverStarted = false;

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

async function addCsvs(page, paths, expectedCount) {
  await page.setInputFiles('#picker', paths);
  await page.waitForFunction((count) => globalThis.__flight?.markerCount === count, expectedCount, { timeout: 60000 });
  await page.waitForFunction((count) => document.querySelectorAll('.track').length === count, expectedCount, {
    timeout: 60000,
  });
}

// ---------------------------------------------------------------------------------------------------
// Page driving
// ---------------------------------------------------------------------------------------------------

function assertCounts(state, expected, label) {
  assert(
    state.markerCount === expected.endpointCount,
    `${label}: markerCount ${state.markerCount} != endpointCount ${expected.endpointCount}`,
  );
  assert(
    state.markerCount === expected.validTrackCount,
    `${label}: markerCount ${state.markerCount} != validTrackCount ${expected.validTrackCount}`,
  );
  assert(
    JSON.stringify(state.markerTrackIds) === JSON.stringify(expected.trackIds),
    `${label}: track-ID set [${state.markerTrackIds}] != [${expected.trackIds}]`,
  );
}

/**
 * Import one malformed CSV through the picker. The app reports it (`window.alert`, dismissed by the harness)
 * and skips it, so the probe afterwards must be EXACTLY the pre-import probe: no marker hidden or dropped.
 */
async function assertMalformedSkipped(page, malformedPath, expected) {
  if (!existsSync(malformedPath)) {
    mkdirSync(dirname(malformedPath), { recursive: true });
    writeFileSync(malformedPath, MALFORMED_TEXT);
  }
  const reported = page.waitForEvent('dialog', { timeout: 10000 }).catch(() => null);
  await page.setInputFiles('#picker', [malformedPath]);
  const dialog = await reported;
  await sleep(750);
  const state = await probe(page);
  console.log(
    `  malformed CSV (${basename(malformedPath)}): ${dialog ? `app reported "${dialog.message()}"` : 'no dialog reported'} -> ${report(state)}`,
  );
  assertCounts(state, expected, 'malformed CSV skipped');
  assert(
    state.tracks === expected.validTrackCount,
    `malformed CSV skipped: ${state.tracks} track rows, expected ${expected.validTrackCount}`,
  );
  assert(state.error === null, `malformed CSV skipped: page error ${state.error}`);

  return state;
}

function assertSameCounts(first, second, label) {
  const a = JSON.stringify(markerSnapshot(first));
  const b = JSON.stringify(markerSnapshot(second));
  assert(a === b, `${label}: marker counts differ\n  first  ${a}\n  second ${b}`);
}

async function launchChrome(url) {
  const chrome = CHROME_PATHS.find((path) => existsSync(path));
  assert(chrome, 'Chrome not found (looked in Program Files and LOCALAPPDATA)');
  const profile = join(tmpdir(), `opensa-endpoint-markers-${Date.now()}`); // fresh throwaway profile
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

async function main() {
  const args = process.argv.slice(2);
  const singleArg = args.length === 1;
  const requested = args.length === 0 ? DEFAULT_CSVS : args.map((path) => resolve(path));

  // A malformed ARGUMENT is SKIPPED and reported; the scenarios then run with what is actually readable, so
  // markerCount === endpointCount === validTrackCount still describes the imported set exactly.
  const loaded = [];
  const rejected = [];
  if (!singleArg) {
    for (const path of requested) {
      try {
        loaded.push({ path, recording: parseRecording(readFileSync(path, 'utf8'), basename(path)) });
      } catch (error) {
        rejected.push(path);
        console.log(
          `skipped malformed CSV argument: ${path} (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    if (loaded.length < 2) {
      console.log(
        `no happy-path run: ${loaded.length} valid recording(s) after skipping ${rejected.length} malformed argument(s)`,
      );

      return 'skipped';
    }
  }

  // Every probe-level scenario also imports one malformed CSV (plus any rejected argument that still exists
  // on disk) and requires the marker counts to be untouched — "bad CSV skipped" is asserted, not assumed.
  const malformedPaths = singleArg
    ? []
    : [...new Set([MALFORMED_FIXTURE, ...rejected.filter((path) => existsSync(path))])];

  await ensureServer();
  const browser = await launchChrome(`${ORIGIN}/opensa/flight-replay.html`);
  const context = browser.contexts()[0];
  try {
    if (singleArg) {
      await runZeroEndpointFixture(context, requested[0]);
    } else {
      const three = await runThreeRecordings(context, loaded, 'run 1', malformedPaths);
      const threeRepeat = await runThreeRecordings(context, loaded, 'run 2', malformedPaths);
      assertSameCounts(three.afterMalformed, threeRepeat.afterMalformed, 'two runs');
      console.log(`two runs identical: ${JSON.stringify(markerSnapshot(three.afterMalformed))}`);
      const coincident = await runCoincidentFixture(context);
      const png = writeEvidence({ coincident, three, threeRepeat });
      console.log('--- summary ---');
      console.log(
        JSON.stringify(
          {
            coincident: {
              capacity: coincident.final.markerCapacity,
              densityMax: coincident.final.densityMax,
              halos: coincident.final.markerHalos,
              markerCount: coincident.final.markerCount,
              redPixels: coincident.red,
            },
            three: {
              densityMax: three.afterMalformed.densityMax,
              endpointCount: three.expected.endpointCount,
              markerCount: three.afterMalformed.markerCount,
              redPixels: three.red,
              trackIds: three.afterMalformed.markerTrackIds,
            },
            threeRepeat: {
              densityMax: threeRepeat.afterMalformed.densityMax,
              markerCount: threeRepeat.afterMalformed.markerCount,
              redPixels: threeRepeat.red,
              trackIds: threeRepeat.afterMalformed.markerTrackIds,
            },
          },
          null,
          2,
        ),
      );
      console.log(`evidence: ${png}`);
    }
  } finally {
    await browser.close().catch(() => {});
    killTree(chromeChild);
    chromeChild = null;
  }
  if (serverStarted) {
    killTree(serverChild);
    serverChild = null;
  }

  return 'passed';
}

/** The count-bearing probe fields, compared verbatim between repeat runs and before/after a skip. */
function markerSnapshot(state) {
  return {
    capacity: state.markerCapacity,
    count: state.markerCount,
    densityMax: state.densityMax,
    halos: state.markerHalos,
    recreates: state.markerRecreates,
    trackIds: state.markerTrackIds,
  };
}

async function openPage(browser, view) {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error(`[console.error] ${message.text()}`);
    }
  });
  page.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => {});
  });
  // `recording` points at a path that does not exist on purpose: with no auto-loaded track the imported
  // set is exactly what this test sends through the picker, so counts can be compared by equality.
  const query = new URLSearchParams({ recording: '/endpoint-markers-no-auto-load.csv', videoExport: '1' });
  if (view) {
    query.set('exportView', JSON.stringify(view));
  }
  await page.goto(`${ORIGIN}/opensa/flight-replay.html?${query}`, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__flight?.worldReady === true, undefined, { timeout: 180000 });
  await page.waitForFunction(() => globalThis.__flight?.markerCount === 0, undefined, { timeout: 60000 });

  return page;
}

async function probe(page) {
  return page.evaluate(() => {
    const flight = globalThis.__flight;

    return {
      aircraft: flight?.aircraft ?? '',
      densityMax: flight?.densityMax ?? -1,
      error: flight?.error ?? null,
      markerActiveTrackId: flight?.markerActiveTrackId ?? -1,
      markerCapacity: flight?.markerCapacity ?? -1,
      markerCount: flight?.markerCount ?? -1,
      markerHalos: flight?.markerHalos ?? -1,
      markerRecreates: flight?.markerRecreates ?? -1,
      markerTrackIds: flight?.markerTrackIds ?? [],
      phase: flight?.phase ?? '',
      renders: flight?.renders ?? 0,
      tracks: document.querySelectorAll('.track').length,
    };
  });
}

async function renderAndShoot(page, seconds, path) {
  await page.waitForFunction(() => (globalThis.__flight?.aircraft ?? 'none') !== 'none', undefined, {
    timeout: 120000,
  });
  await page.evaluate(() => globalThis.__flightVideoExport.ready());
  await page.evaluate((value) => globalThis.__flightVideoExport.renderFrame(value), seconds);
  await sleep(300);
  await page.locator('#canvas').screenshot({ path });
  const state = await probe(page);
  assert(!state.error, `replay error at s=${seconds}: ${state.error}`);
  console.log(`  shot ${basename(path)} @ ${seconds.toFixed(3)}s (phase ${state.phase}, renders ${state.renders})`);

  return path;
}

// ---------------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------------

function report(state) {
  return `markerCount=${state.markerCount} trackIds=[${state.markerTrackIds}] densityMax=${state.densityMax} halos=${state.markerHalos} capacity=${state.markerCapacity} recreates=${state.markerRecreates} active=${state.markerActiveTrackId}`;
}

async function runCoincidentFixture(browser) {
  assert(existsSync(COINCIDENT_FIXTURE), `coincident fixture missing: ${COINCIDENT_FIXTURE}`);
  copyFileSync(COINCIDENT_FIXTURE, COINCIDENT_TWIN);
  const recording = parseRecording(readFileSync(COINCIDENT_FIXTURE, 'utf8'), basename(COINCIDENT_FIXTURE));
  const endpoint = gtaToEngine(recording.endpoint);
  const expected = {
    endpointCount: 2,
    trackIds: [0, 1],
    validTrackCount: 2,
  };
  const view = cameraView(endpoint, 170, [0.5, 0.5, 0.7]);
  console.log(`coincident fixture: ${basename(COINCIDENT_FIXTURE)} endpoint (${recording.endpoint.join(', ')})`);

  const page = await openPage(browser, view);
  try {
    await addCsvs(page, [COINCIDENT_FIXTURE], 1);
    const single = await probe(page);
    console.log(`  coincident single: ${report(single)}`);
    assert(single.markerCount === 1, `coincident fixture first import: markerCount ${single.markerCount} != 1`);
    assert(single.markerCapacity > 0, 'coincident fixture first import: no buffer allocated');
    assert(single.densityMax === 1, `coincident fixture first import: densityMax ${single.densityMax} != 1`);

    // A SECOND byte-identical import must not be hidden or dropped: both markers exist, both cluster.
    await addCsvs(page, [COINCIDENT_TWIN], expected.validTrackCount);
    const pair = await probe(page);
    console.log(`  coincident pair: ${report(pair)}`);
    // markerCount === endpointCount === validTrackCount and the endpoint set, so neither point was dropped.
    assertCounts(pair, expected, 'coincident fixture');
    assert(pair.densityMax >= 2, `coincident fixture: densityMax ${pair.densityMax} < 2 (no density weighting)`);
    assert(pair.markerHalos >= 1, `coincident fixture: halos ${pair.markerHalos} < 1 (cluster halo missing)`);
    // Stale-state guard: the endpoint count changed 1 -> 2, so the GPU buffer MUST have been recreated at
    // the doubled size instead of writing through the smaller allocation.
    assert(
      pair.markerRecreates === single.markerRecreates + 1,
      `coincident fixture: recreates ${pair.markerRecreates} != ${single.markerRecreates + 1} (buffer not recreated)`,
    );
    assert(
      pair.markerCapacity === single.markerCapacity * 2,
      `coincident fixture: capacity ${pair.markerCapacity} != 2 * ${single.markerCapacity} (buffer not resized)`,
    );

    const shot = join(CAPTURES, 'endpoint-markers-coincident.png');
    await renderAndShoot(page, 0, shot);
    const final = await probe(page);
    const red = redPixels(readPng(shot));
    console.log(`  measured: red marker pixels=${red} (close-up, density halo)`);
    assert(
      red > RED_MIN_COINCIDENT,
      `coincident fixture: only ${red} marker-red pixels (need > ${RED_MIN_COINCIDENT})`,
    );
    await page.screenshot({ path: join(CAPTURES, 'endpoint-markers-coincident-full.png') });

    return { final, first: single, red, shot };
  } finally {
    await page.close();
  }
}

async function runThreeRecordings(browser, loaded, label, malformedPaths) {
  mkdirSync(CAPTURES, { recursive: true });
  const csvPaths = loaded.map((item) => item.path);
  const endpoints = loaded.map((item) => gtaToEngine(item.recording.endpoint));
  const expected = {
    endpointCount: endpoints.length,
    trackIds: endpoints.map((_, index) => index),
    validTrackCount: loaded.length,
  };
  const { center, span } = boundsCenter(endpoints);
  // Bird's-eye over the whole endpoint spread: a diagonal from far away framed only part of the 3.5 km
  // spread, so the camera sits almost straight above the centre where all three markers fit.
  const distance = Math.min(6000, Math.max(420, span * 1.05));
  const view = cameraView(center, distance, [0.06, 1.0, 0.09]);
  console.log(
    `csv (${label}): ${loaded.length} recordings -> ${expected.endpointCount} endpoints, engine span ${span.toFixed(0)}, camera ${JSON.stringify(view.position)}`,
  );

  const page = await openPage(browser, view);
  try {
    await addCsvs(page, csvPaths, expected.endpointCount);
    const state = await probe(page);
    console.log(`  probe (${label}): ${report(state)}`);
    assertCounts(state, expected, label);
    assert(
      state.markerCapacity > 0 && state.markerRecreates >= 1,
      `${label}: marker layer was never allocated (${report(state)})`,
    );
    assert(state.densityMax >= 1, `${label}: densityMax < 1 (${report(state)})`);

    const shot = join(CAPTURES, 'endpoint-markers-three-csvs.png');
    await renderAndShoot(page, 0, shot);
    const red = redPixels(readPng(shot));
    console.log(`  measured (${label}): red marker pixels=${red} (wide camera)`);
    assert(red > RED_MIN_WIDE, `${label}: only ${red} marker-red pixels in the wide shot (need > ${RED_MIN_WIDE})`);
    await page.screenshot({ path: join(CAPTURES, 'endpoint-markers-three-csvs-full.png') });

    // Malformed inputs through the picker: the app reports each and skips it, so the probe counts must not
    // move. This is where "a bad CSV is skipped, counts stay consistent" is asserted from the probe.
    for (const malformedPath of malformedPaths) {
      await assertMalformedSkipped(page, malformedPath, expected);
    }
    const afterMalformed = await probe(page);
    assertSameCounts(state, afterMalformed, `${label}: malformed CSV import`);

    return { afterMalformed, expected, red, shot, state };
  } finally {
    await page.close();
  }
}

async function runZeroEndpointFixture(browser, fixturePath) {
  if (!existsSync(fixturePath)) {
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, ZERO_FIXTURE_TEXT);
    console.log(`fixture: wrote ${fixturePath} (zero sample rows)`);
  }
  const page = await openPage(browser);
  try {
    const before = await probe(page);
    console.log(`  before import: ${report(before)}`);
    await page.setInputFiles('#picker', [fixturePath]);
    await sleep(1500);
    const state = await probe(page);
    console.log(`  after import:  ${report(state)}`);
    assert(state.markerCount === 0, `zero-endpoint fixture: markerCount ${state.markerCount} != 0`);
    assert(state.markerTrackIds.length === 0, `zero-endpoint fixture: track-IDs [${state.markerTrackIds}] != []`);
    assert(state.densityMax === 0, `zero-endpoint fixture: densityMax ${state.densityMax} != 0`);
    assert(state.markerCapacity === 0, `zero-endpoint fixture: capacity ${state.markerCapacity} != 0`);
    assert(state.tracks === 0, `zero-endpoint fixture: ${state.tracks} track rows in the list, expected 0`);
    assert(state.error === null, `zero-endpoint fixture: page error ${state.error}`);
    console.log('zero-endpoint fixture: reported count 0, no error');

    return state;
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------

function writeEvidence(summary) {
  mkdirSync(EVIDENCE, { recursive: true });
  const png = join(EVIDENCE, `${EVIDENCE_STEM}.png`);
  copyFileSync(summary.coincident.shot, png);
  const lines = [
    `task-13 endpoint marker probe counts (${new Date().toISOString()})`,
    '',
    `three recordings run 1: ${report(summary.three.state)}`,
    `  malformed CSV skipped (run 1): ${report(summary.three.afterMalformed)}`,
    `three recordings run 2: ${report(summary.threeRepeat.afterMalformed)}`,
    `  expected: endpointCount=${summary.three.expected.endpointCount} validTrackCount=${summary.three.expected.validTrackCount} trackIds=[${summary.three.expected.trackIds}]`,
    `  two runs identical: ${JSON.stringify(markerSnapshot(summary.three.afterMalformed)) === JSON.stringify(markerSnapshot(summary.threeRepeat.afterMalformed))}`,
    `  red marker pixels (wide fixed free camera): run 1 ${summary.three.red}; run 2 ${summary.threeRepeat.red}`,
    `coincident fixture single: ${report(summary.coincident.first)}`,
    `coincident fixture pair:   ${report(summary.coincident.final)}`,
    `  markerCount === valid tracks (2), densityMax >= 2, halos >= 1`,
    `  red marker pixels (close-up, density halo): ${summary.coincident.red}`,
    '',
    `head commit: ${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()}`,
    `evidence png: ${png}`,
    `captures: endpoint-markers-three-csvs.png, endpoint-markers-coincident.png`,
    '',
  ];
  writeFileSync(join(EVIDENCE, `${EVIDENCE_STEM}.txt`), lines.join('\n'));

  return png;
}

main().then(
  (status) => {
    if (status === 'skipped') {
      console.log('SKIP: no runnable scenario (malformed arguments skipped, nothing importable)');
    } else {
      console.log('PASS: endpoint markers verified against the debug probe');
    }
    process.exitCode = 0;
  },
  (error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
