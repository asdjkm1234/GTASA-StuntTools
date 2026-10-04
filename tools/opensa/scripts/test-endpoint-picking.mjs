/**
 * Acceptance test for screen-space picking of the 3D endpoint markers
 * (`apps/web/src/flight/endpoint-picking.ts`).
 *
 * The marker layer draws engine debug lines, which are NOT pickable — so a pick must project the markers
 * itself. This test does not trust the page's projection: it parses the three real CSVs for the endpoint
 * model (the same independent oracle `test-endpoint-markers.mjs` uses), reads the LIVE camera state from
 * the `window.__flight` probe, projects the endpoints to canvas pixels with its own lookAt + perspective
 * math, cross-checks that against the page's `markerScreenPositions`, and only then dispatches a synthetic
 * click at those coordinates. Success is asserted from probe values (active track id before/after, the pick
 * result id, the active list row), never from a screenshot. A second click in empty sky must change
 * nothing — and the empty point is recomputed from the camera the first pick moved to, so a stale
 * projection cannot fake it.
 *
 *   node scripts/test-endpoint-picking.mjs <csv1> <csv2> <csv3>
 *       Defaults to the three plan recordings. Exits 0 on success and appends one deterministic JSON line
 *       per run to .omo/evidence/task-10-...txt, so two runs can be compared byte for byte.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const RECORDINGS = join(REPO_ROOT, 'GTA San Andreas', 'flight_recordings');
const EVIDENCE = join(REPO_ROOT, '.omo', 'evidence', 'task-10-flight-analysis-remediation-and-worktree-cleanup.txt');
const ORIGIN = 'http://127.0.0.1:4173';

const DEFAULT_CSVS = [
  join(RECORDINGS, 'flight_20260926_153900_322_m520_001.csv'),
  join(RECORDINGS, 'flight_20260926_044304_980_m520_050.csv'),
  join(RECORDINGS, 'flight_20260926_044255_679_m520_049.csv'),
];

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
const round = (value) => Number(value.toFixed(2));

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
// Independent projection (a second implementation of `mat4LookAt` + `mat4PerspectiveZO`, not shared code)
// ---------------------------------------------------------------------------------------------------

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalize(v) {
  const length = Math.hypot(...v) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

/** World point -> canvas CSS pixels, using the same conventions as the engine (right-handed, Y-up NDC). */
function projectToCanvas(point, camera, width, height) {
  const zAxis = normalize(subtract(camera.eye, camera.target));
  const xAxis = normalize(cross(camera.up, zAxis));
  const yAxis = cross(zAxis, xAxis);
  const relative = subtract(point, camera.eye);
  const viewX = dot(relative, xAxis);
  const viewY = dot(relative, yAxis);
  const viewZ = dot(relative, zAxis);
  const forward = -viewZ;
  if (forward <= 1e-6 || forward > camera.far) {
    return { onScreen: false, x: 0, y: 0 };
  }
  const f = 1 / Math.tan(camera.fovYRad / 2);
  const ndcX = ((f / camera.aspect) * viewX) / forward;
  const ndcY = (f * viewY) / forward;
  const x = (ndcX * 0.5 + 0.5) * width;
  const y = (0.5 - ndcY * 0.5) * height;

  return { onScreen: x >= 0 && x <= width && y >= 0 && y <= height, x, y };
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

function appendEvidence(record) {
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  if (!existsSync(EVIDENCE)) {
    writeFileSync(
      EVIDENCE,
      [
        'task-10 endpoint picking probe — one deterministic JSON line per run (append mode)',
        'click = synthetic MouseEvent on #canvas at the independently projected marker anchor',
        '',
      ].join('\n'),
    );
  }
  appendFileSync(EVIDENCE, `${JSON.stringify(record)}\n`);
}

// ---------------------------------------------------------------------------------------------------
// Page driving
// ---------------------------------------------------------------------------------------------------

/** Dispatch a real `click` on #canvas at canvas-relative coords (bypasses overlays, keeps clientX/Y real). */
async function dispatchClick(page, canvas, x, y) {
  await page.evaluate(
    ({ clientX, clientY }) => {
      const element = document.getElementById('canvas');
      if (!element) {
        throw new Error('canvas missing');
      }
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
    },
    { clientX: canvas.left + x, clientY: canvas.top + y },
  );
}

function evidenceRecord(result) {
  const { after, before, empty, quiet, target, verified } = result;

  return {
    clicked: {
      pageProjectionDeltaPx: round(verified.maxDelta),
      trackIndex: target.trackIndex,
      x: round(target.x),
      y: round(target.y),
    },
    emptyClick: {
      activeAfter: quiet.activeTrackIndex,
      activeBefore: result.moved.activeTrackIndex,
      markerActiveAfter: quiet.markerActiveTrackId,
      markerActiveBefore: result.moved.markerActiveTrackId,
      pageProjectionDeltaPx: round(result.movedVerified.maxDelta),
      pickedTrackId: quiet.markerPickedTrackId,
      visibleMarkers: result.movedVerified.rows.filter((row) => row.onScreen).length,
      x: round(empty.x),
      y: round(empty.y),
    },
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
    markerClick: {
      activeAfter: after.activeTrackIndex,
      activeBefore: before.activeTrackIndex,
      domActiveAfter: after.domActiveTrack,
      domActiveBefore: before.domActiveTrack,
      markerActiveAfter: after.markerActiveTrackId,
      markerActiveBefore: before.markerActiveTrackId,
      pickedTrackId: after.markerPickedTrackId,
    },
    markerCount: before.markerCount,
    markerTrackIds: before.markerTrackIds,
  };
}

/** Deterministic canvas point at least `margin` from every on-screen marker in the CURRENT camera state. */
function findEmptyPoint(state, endpoints) {
  const margin = Math.max(1, state.markerPickRadius) * 2.5;
  const projected = endpoints
    .map((position, trackIndex) => ({
      ...projectToCanvas(position, state.cameraState, state.canvas.width, state.canvas.height),
      trackIndex,
    }))
    .filter((point) => point.onScreen);
  for (let y = 12; y <= state.canvas.height - 12; y += 20) {
    for (let x = 12; x <= state.canvas.width - 12; x += 20) {
      const nearest = projected.reduce((min, point) => Math.min(min, Math.hypot(point.x - x, point.y - y)), Infinity);
      if (nearest >= margin) {
        return { x, y };
      }
    }
  }

  return null;
}

async function launchChrome(url) {
  const chrome = CHROME_PATHS.find((path) => existsSync(path));
  assert(chrome, 'Chrome not found (looked in Program Files and LOCALAPPDATA)');
  const profile = join(tmpdir(), `opensa-endpoint-picking-${Date.now()}`); // fresh throwaway profile
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
  const csvArgs = args.length === 0 ? DEFAULT_CSVS : args.map((path) => resolve(path));
  assert(csvArgs.length === 3, `expected three CSV paths, got ${csvArgs.length}`);
  for (const path of csvArgs) {
    assert(existsSync(path), `CSV not found: ${path}`);
  }

  await ensureServer();
  const browser = await launchChrome(`${ORIGIN}/opensa/flight-replay.html`);
  const context = browser.contexts()[0];
  try {
    const result = await runPicking(context, csvArgs);
    const record = evidenceRecord(result);
    appendEvidence(record);
    console.log('--- summary ---');
    console.log(JSON.stringify(record, null, 2));
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

async function openPage(context, view) {
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
  // `recording` points at a path that does not exist on purpose: nothing is auto-loaded, so the marker set
  // is exactly what this test sends through the picker.
  const query = new URLSearchParams({ recording: '/nonexistent-pick.csv', videoExport: '1' });
  query.set('exportView', JSON.stringify(view));
  await page.goto(`${ORIGIN}/opensa/flight-replay.html?${query}`, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__flight?.worldReady === true, undefined, { timeout: 180000 });
  await page.waitForFunction(() => globalThis.__flight?.markerCount === 0, undefined, { timeout: 60000 });

  return page;
}

async function probe(page) {
  return page.evaluate(() => {
    const flight = globalThis.__flight;
    const activeRow = document.querySelector('.track.active');
    const canvas = document.getElementById('canvas');
    const rect = canvas?.getBoundingClientRect() ?? null;

    return {
      activeTrackIndex: flight?.activeTrackIndex ?? -1,
      cameraState: flight?.cameraState ?? null,
      canvas: rect ? { height: rect.height, left: rect.left, top: rect.top, width: rect.width } : null,
      domActiveTrack: activeRow ? Number(activeRow.dataset.i) : -1,
      error: flight?.error ?? null,
      markerActiveTrackId: flight?.markerActiveTrackId ?? -1,
      markerCount: flight?.markerCount ?? -1,
      markerPickedTrackId: flight?.markerPickedTrackId ?? -99,
      markerPickRadius: flight?.markerPickRadius ?? -1,
      markerScreenPositions: flight?.markerScreenPositions ?? [],
      markerTrackIds: flight?.markerTrackIds ?? [],
      tracks: document.querySelectorAll('.track').length,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------------------------------

function report(state) {
  const screen = state.markerScreenPositions
    .map(
      (marker) => `${marker.trackIndex}:${marker.onScreen ? `${marker.x.toFixed(1)},${marker.y.toFixed(1)}` : 'off'}`,
    )
    .join(' ');

  return `markerCount=${state.markerCount} trackIds=[${state.markerTrackIds}] active=${state.markerActiveTrackId} activeTrack=${state.activeTrackIndex} domActive=${state.domActiveTrack} picked=${state.markerPickedTrackId} screen=[${screen}]`;
}

// ---------------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------------

async function runPicking(context, csvPaths) {
  const recordings = csvPaths.map((path) => parseRecording(readFileSync(path, 'utf8'), basename(path)));
  const endpoints = recordings.map((recording) => gtaToEngine(recording.endpoint));
  const { center, span } = boundsCenter(endpoints);
  const distance = Math.min(6000, Math.max(420, span * 1.05));
  const view = cameraView(center, distance, [0.06, 1.0, 0.09]);
  console.log(
    `csv: ${recordings.length} recordings -> ${endpoints.length} endpoints, engine span ${span.toFixed(0)}, camera ${JSON.stringify(view.position)}`,
  );

  const page = await openPage(context, view);
  try {
    await page.setInputFiles('#picker', csvPaths);
    await page.waitForFunction(() => globalThis.__flight?.markerCount === 3, undefined, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('.track').length === 3, undefined, { timeout: 60000 });
    await page.waitForFunction(() => (globalThis.__flight?.aircraft ?? 'none') !== 'none', undefined, {
      timeout: 120000,
    });
    await page.evaluate(() => globalThis.__flightVideoExport.ready());
    await page.evaluate(() => globalThis.__flightVideoExport.renderFrame(0));
    await sleep(300);

    const before = await probe(page);
    console.log(`  probe before:  ${report(before)}`);
    assert(before.error === null, `replay error before click: ${before.error}`);
    assert(before.markerCount === 3, `markerCount ${before.markerCount} != 3`);
    assert(before.canvas !== null, 'canvas rect missing');
    assert(before.cameraState !== null, 'probe cameraState is null — projection cannot be verified');
    assert(
      before.markerScreenPositions.length === 3,
      `markerScreenPositions ${before.markerScreenPositions.length} != 3`,
    );

    const verified = verifyProjection(before, endpoints);
    const target = verified.rows.find((row) => row.trackIndex !== before.markerActiveTrackId && row.onScreen);
    assert(
      target,
      `no visible marker other than the active one (active=${before.markerActiveTrackId}, rows=${JSON.stringify(verified.rows)})`,
    );
    console.log(
      `  projection: independent matches page within ${verified.maxDelta.toFixed(2)} px; clicking track ${target.trackIndex} at (${target.x.toFixed(1)}, ${target.y.toFixed(1)})`,
    );

    await dispatchClick(page, before.canvas, target.x, target.y);
    await waitForActive(page, target.trackIndex);
    const after = await probe(page);
    console.log(`  probe after:   ${report(after)}`);
    assert(
      after.markerPickedTrackId === target.trackIndex,
      `markerPickedTrackId ${after.markerPickedTrackId} != ${target.trackIndex}`,
    );
    assert(
      after.markerActiveTrackId === target.trackIndex,
      `markerActiveTrackId ${after.markerActiveTrackId} != ${target.trackIndex}`,
    );
    assert(
      after.activeTrackIndex === target.trackIndex,
      `activeTrackIndex ${after.activeTrackIndex} != ${target.trackIndex}`,
    );
    assert(
      after.domActiveTrack === target.trackIndex,
      `active list row ${after.domActiveTrack} != ${target.trackIndex}`,
    );
    assert(
      after.domActiveTrack !== before.domActiveTrack,
      `active list row did not change (${before.domActiveTrack} -> ${after.domActiveTrack})`,
    );

    // Empty sky: the pick moved the free camera to the endpoint, so re-apply the export view to put the
    // marker set back on screen, then recompute the projection from THAT live camera. Clicking inside the
    // picking radius of a visible marker here would move the selection — a pick that ignored the pixel
    // radius cannot pass this.
    await page.evaluate(() => globalThis.__flightVideoExport.ready());
    await page.evaluate(() => globalThis.__flightVideoExport.renderFrame(0));
    await sleep(300);
    const moved = await probe(page);
    const movedVerified = verifyProjection(moved, endpoints);
    const visible = movedVerified.rows.filter((row) => row.onScreen).length;
    assert(visible >= 2, `only ${visible} markers visible after re-applying the export view — empty-sky pick unsafe`);
    const empty = findEmptyPoint(moved, endpoints);
    assert(empty, 'no empty canvas point at least 2.5x the pick radius from every visible marker');
    console.log(`  empty sky: ${visible} markers on screen, clicking (${empty.x.toFixed(1)}, ${empty.y.toFixed(1)})`);
    await dispatchClick(page, moved.canvas, empty.x, empty.y);
    await sleep(400);
    const quiet = await probe(page);
    console.log(`  probe empty:   ${report(quiet)}`);
    assert(quiet.markerPickedTrackId === -1, `empty click picked track ${quiet.markerPickedTrackId}`);
    assert(
      quiet.markerActiveTrackId === moved.markerActiveTrackId,
      `empty click changed markerActiveTrackId ${moved.markerActiveTrackId} -> ${quiet.markerActiveTrackId}`,
    );
    assert(
      quiet.activeTrackIndex === moved.activeTrackIndex,
      `empty click changed activeTrackIndex ${moved.activeTrackIndex} -> ${quiet.activeTrackIndex}`,
    );
    assert(
      quiet.domActiveTrack === moved.domActiveTrack,
      `empty click changed the active list row ${moved.domActiveTrack} -> ${quiet.domActiveTrack}`,
    );

    return { after, before, empty, moved, movedVerified, quiet, target, verified };
  } finally {
    await page.close();
  }
}

/** Cross-check the page's own projections against this test's independent math. */
function verifyProjection(state, endpoints) {
  const page = new Map(state.markerScreenPositions.map((marker) => [marker.trackIndex, marker]));
  const rows = endpoints.map((position, trackIndex) => {
    const independent = projectToCanvas(position, state.cameraState, state.canvas.width, state.canvas.height);
    const projected = page.get(trackIndex);
    assert(projected, `probe is missing markerScreenPositions for track ${trackIndex}`);
    assert(
      projected.onScreen === independent.onScreen,
      `onScreen disagreement for track ${trackIndex}: page ${projected.onScreen} vs independent ${independent.onScreen}`,
    );
    const delta = projected.onScreen ? Math.hypot(projected.x - independent.x, projected.y - independent.y) : 0;

    return { delta, onScreen: independent.onScreen, trackIndex, x: independent.x, y: independent.y };
  });
  const maxDelta = Math.max(...rows.map((row) => row.delta));
  assert(maxDelta <= 2, `page projection disagrees with the independent one by ${maxDelta.toFixed(2)} px`);

  return { maxDelta, rows };
}

// ---------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------

async function waitForActive(page, trackIndex) {
  try {
    await page.waitForFunction((id) => globalThis.__flight?.markerActiveTrackId === id, trackIndex, { timeout: 15000 });
  } catch {
    const state = await probe(page);
    throw new Error(`markerActiveTrackId did not become ${trackIndex}; probe after click: ${report(state)}`);
  }
}

main().then(
  () => {
    console.log('PASS: endpoint marker picking verified against the debug probe');
    process.exitCode = 0;
  },
  (error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
