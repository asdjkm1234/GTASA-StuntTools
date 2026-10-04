/**
 * Acceptance test for the free-camera fly-to (`apps/web/src/flight/free-camera.ts` `flyTo`/`advance`) as it is
 * wired to marker selection (pick -> heatmap focus -> `ReplayNavigation.onEndpointSelected`).
 *
 * Success is asserted from NUMBERS, never from the screenshot: the `window.__flight` probe carries
 * `flyActive`/`flyProgress`, and the camera eye/target the last frame was drawn with. The test checks that a
 * synthetic click on a projected marker starts a tween (not a teleport), that progress only advances, that
 * the flight settles inside its bound, and that the endpoint then projects onto the canvas centre. Only
 * after those assertions does it save a PNG. A wheel event afterwards proves the interactive input path
 * still drives the same camera.
 *
 *   node scripts/test-endpoint-flyto.mjs <csv1> <csv2> <csv3>
 *       Defaults to the three plan recordings. Exits 0 on success and appends one deterministic JSON line
 *       per run to .omo/evidence/task-11-...txt; a second run also compares itself against the first line.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const RECORDINGS = join(REPO_ROOT, 'GTA San Andreas', 'flight_recordings');
const EVIDENCE = join(REPO_ROOT, '.omo', 'evidence', 'task-11-flight-analysis-remediation-and-worktree-cleanup.txt');
const CAPTURES = join(process.cwd(), 'captures');
const ORIGIN = 'http://127.0.0.1:4173';
const SETTLE_TOLERANCE = 0.5;
const CENTER_TOLERANCE_PX = 3;
const MAX_FLIGHT_MS = 5000;

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
// CSV reading (independent oracle for the endpoint model, as in test-endpoint-picking.mjs)
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
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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
function cameraView(center, distanceUnits, direction = [0.06, 1.0, 0.09]) {
  const length = Math.hypot(...direction) || 1;
  const position = center.map((value, index) => value + (direction[index] / length) * distanceUnits);

  return {
    mode: 'free',
    pitch: Math.atan2(center[1] - position[1], Math.hypot(center[0] - position[0], center[2] - position[2])),
    position: position.map((value) => Number(value.toFixed(3))),
    yaw: Math.atan2(center[0] - position[0], -(center[2] - position[2])),
  };
}

// ---------------------------------------------------------------------------------------------------
// Independent projection (second implementation of mat4LookAt + mat4PerspectiveZO, not shared code)
// ---------------------------------------------------------------------------------------------------

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Where an instant `focus(endpoint)` would put the eye, read off the live camera the click was sent from. */
function expectedFlyDestination(endpoint, camera) {
  const forward = normalize(subtract(camera.target, camera.eye));
  const focusDistance = distance(camera.eye, camera.target);

  return endpoint.map((value, axis) => value - forward[axis] * focusDistance);
}

function normalize(v) {
  const length = Math.hypot(...v) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

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

  return {
    onScreen: true,
    x: (ndcX * 0.5 + 0.5) * width,
    y: (0.5 - ndcY * 0.5) * height,
  };
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
    appendFileSync(
      EVIDENCE,
      [
        'task-11 free-camera fly-to — one deterministic JSON line per run (append mode)',
        'click = synthetic MouseEvent on #canvas at the independently projected marker anchor',
        'tween state read from __flight.flyActive / __flight.flyProgress (numbers, not the screenshot)',
        '',
      ].join('\n'),
    );
  }
  appendFileSync(EVIDENCE, `${JSON.stringify(record)}\n`);
}

// ---------------------------------------------------------------------------------------------------
// Page driving
// ---------------------------------------------------------------------------------------------------

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

async function dispatchWheel(page, deltaY) {
  await page.evaluate((delta) => {
    document
      .getElementById('canvas')
      ?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: delta }));
  }, deltaY);
}

function evidenceRecord(result, run) {
  const previous = previousRecord();
  const record = {
    cameraCenterDeltaPx: round(result.centerDeltaPx),
    distanceAfterUnits: round(result.distanceAfter),
    distanceBeforeUnits: round(result.distanceBefore),
    flyActiveOnClick: result.clicked.flyActive,
    flyProgressOnClick: round(result.clicked.flyProgress),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
    pageCenterDeltaPx: round(result.pageCenterDeltaPx),
    pageErrors: result.pageErrors.length,
    progressMonotonic: true,
    progressSamples: result.samples.map((sample) => round(sample.progress)),
    run,
    sawMidflight: result.sawMidflight,
    settledEyeMissUnits: Number(result.eyeMiss.toFixed(4)),
    settleMs: round(result.settleElapsedMs),
    settleTargetMissUnits: Number(result.targetMiss.toFixed(4)),
    targetTrackId: result.before.markerActiveTrackId,
    targetTrackIndex: result.target.trackIndex,
    wheelEyeDeltaUnits: round(result.wheelDelta),
  };
  if (previous) {
    assert(
      previous.targetTrackIndex === record.targetTrackIndex,
      `run ${run} picked track ${record.targetTrackIndex} while run ${previous.run} picked ${previous.targetTrackIndex}`,
    );
    assert(previous.sawMidflight === record.sawMidflight, 'mid-flight observation differs between runs');
    assert(
      Math.abs(previous.settleTargetMissUnits - record.settleTargetMissUnits) <= 0.01,
      'settled target distance differs between runs',
    );
    record.consistentWithRun = previous.run;
  }

  return record;
}

async function launchChrome(url) {
  const chrome = CHROME_PATHS.find((path) => existsSync(path));
  assert(chrome, 'Chrome not found (looked in Program Files and LOCALAPPDATA)');
  const profile = join(tmpdir(), `opensa-endpoint-flyto-${Date.now()}`); // fresh throwaway profile
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
    const result = await runFlyTo(context, csvArgs);
    const run = runNumber();
    const record = evidenceRecord(result, run);
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
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    console.error(`[pageerror] ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error(`[console.error] ${message.text()}`);
    }
  });
  page.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => {});
  });
  const query = new URLSearchParams({ recording: '/nonexistent-flyto.csv', videoExport: '1' });
  query.set('exportView', JSON.stringify(view));
  await page.goto(`${ORIGIN}/opensa/flight-replay.html?${query}`, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__flight?.worldReady === true, undefined, { timeout: 180000 });
  await page.waitForFunction(() => globalThis.__flight?.markerCount === 0, undefined, { timeout: 60000 });

  return { page, pageErrors };
}

// ---------------------------------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------------------------------

function previousRecord() {
  if (!existsSync(EVIDENCE)) {
    return null;
  }
  const lines = readFileSync(EVIDENCE, 'utf8')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'));
  if (lines.length === 0) {
    return null;
  }

  return JSON.parse(lines[lines.length - 1]);
}

// ---------------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------------

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
      flyActive: flight?.flyActive ?? null,
      flyProgress: flight?.flyProgress ?? null,
      markerActiveTrackId: flight?.markerActiveTrackId ?? -1,
      markerCount: flight?.markerCount ?? -1,
      markerPickedTrackId: flight?.markerPickedTrackId ?? -99,
      markerScreenPositions: flight?.markerScreenPositions ?? [],
      markerTrackIds: flight?.markerTrackIds ?? [],
      now: performance.now(),
    };
  });
}

function report(state) {
  return `flyActive=${state.flyActive} flyProgress=${state.flyProgress} active=${state.markerActiveTrackId} picked=${state.markerPickedTrackId}`;
}

async function runFlyTo(context, csvPaths) {
  const recordings = csvPaths.map((path) => parseRecording(readFileSync(path, 'utf8'), basename(path)));
  const endpoints = recordings.map((recording) => gtaToEngine(recording.endpoint));
  const { center, span } = boundsCenter(endpoints);
  const view = cameraView(center, Math.min(6000, Math.max(420, span * 1.05)));
  console.log(
    `csv: ${recordings.length} recordings -> ${endpoints.length} endpoints, engine span ${span.toFixed(0)}, camera ${JSON.stringify(view.position)}`,
  );

  const { page, pageErrors } = await openPage(context, view);
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
    // Negative control: at rest nothing is flying. A page that reported `flyActive` here would be lying.
    assert(before.flyActive === false, `flyActive ${before.flyActive} before any marker selection`);
    assert(before.flyProgress === 1, `flyProgress ${before.flyProgress} before any marker selection`);

    const verified = verifyProjection(before, endpoints);
    const target = verified.rows.find((row) => row.trackIndex !== before.markerActiveTrackId && row.onScreen);
    assert(
      target,
      `no visible marker other than the active one (active=${before.markerActiveTrackId}, rows=${JSON.stringify(verified.rows)})`,
    );
    const targetEndpoint = endpoints[target.trackIndex];
    const expectedEye = expectedFlyDestination(targetEndpoint, before.cameraState);
    console.log(
      `  projection: independent matches page within ${verified.maxDelta.toFixed(2)} px; clicking track ${target.trackIndex} at (${target.x.toFixed(1)}, ${target.y.toFixed(1)})`,
    );
    console.log(`  expected focus eye ${JSON.stringify(expectedEye.map((value) => round(value)))}`);

    const distanceBefore = distance(before.cameraState.eye, targetEndpoint);
    await dispatchClick(page, before.canvas, target.x, target.y);
    const clicked = await probe(page);
    await page.waitForFunction(
      () => globalThis.__flight?.markerActiveTrackId === globalThis.__flight?.markerPickedTrackId,
      undefined,
      { timeout: 15000 },
    );
    console.log(`  probe clicked: ${report(clicked)}`);

    // The pick must have started a flight, not teleported: the camera is still away from the destination.
    assert(clicked.flyActive === true, `click did not start a fly-to (flyActive=${clicked.flyActive})`);
    assert(clicked.flyProgress < 1, `fly-to already finished when first probed (progress=${clicked.flyProgress})`);
    assert(
      clicked.markerPickedTrackId === target.trackIndex,
      `markerPickedTrackId ${clicked.markerPickedTrackId} != ${target.trackIndex}`,
    );
    assert(
      clicked.markerActiveTrackId === target.trackIndex,
      `markerActiveTrackId ${clicked.markerActiveTrackId} != ${target.trackIndex}`,
    );
    assert(
      distance(clicked.cameraState.eye, targetEndpoint) > SETTLE_TOLERANCE,
      'camera is already on the endpoint immediately after the click — that is a teleport, not a flight',
    );

    // Sample the live tween until it settles; progress is expected to be monotonic and inside [0, 1].
    const samples = [];
    let lastProgress = -1;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const sample = await probe(page);
      samples.push({ eye: sample.cameraState.eye, progress: sample.flyProgress, t: sample.now });
      assert(Number.isFinite(sample.flyProgress), `flyProgress is not finite: ${sample.flyProgress}`);
      assert(
        sample.flyProgress >= lastProgress,
        `flyProgress went backwards: ${lastProgress} -> ${sample.flyProgress}`,
      );
      assert(sample.flyProgress <= 1, `flyProgress above 1: ${sample.flyProgress}`);
      lastProgress = sample.flyProgress;
      if (sample.flyActive === false) {
        break;
      }
      await sleep(40);
    }
    const sawMidflight = samples.some((sample) => sample.progress > 0 && sample.progress < 1);

    await page.waitForFunction(() => globalThis.__flight?.flyActive === false, undefined, { timeout: 15000 });
    await sleep(120);
    const settled = await probe(page);
    console.log(`  probe settled: ${report(settled)} after ${round(settled.now - clicked.now)} ms`);

    assert(
      sawMidflight,
      `no sample caught the tween mid-flight: ${JSON.stringify(samples.map((sample) => round(sample.progress)))}`,
    );
    assert(settled.flyActive === false, `flyActive still true after settle wait`);
    assert(settled.flyProgress === 1, `flyProgress ${settled.flyProgress} after settle`);
    assert(settled.error === null, `replay error after flight: ${settled.error}`);

    // Numeric arrival: the flight ends on the exact focus pose (eye the instant focus would take, target on
    // the endpoint) — and the endpoint projects onto the canvas centre.
    const settleElapsedMs = settled.now - clicked.now;
    assert(
      settleElapsedMs <= MAX_FLIGHT_MS + 3000,
      `flight took ${settleElapsedMs.toFixed(0)} ms — beyond the hard bound`,
    );
    assert(settleElapsedMs >= 300, `flight settled in ${settleElapsedMs.toFixed(0)} ms — too fast to have eased`);
    const eyeMiss = distance(settled.cameraState.eye, expectedEye);
    assert(eyeMiss <= SETTLE_TOLERANCE, `settled eye misses the focus pose by ${eyeMiss.toFixed(3)} units`);
    const targetMiss = distance(settled.cameraState.target, targetEndpoint);
    assert(
      targetMiss <= SETTLE_TOLERANCE,
      `settled camera target misses the endpoint by ${targetMiss.toFixed(3)} units`,
    );
    const distanceAfter = distance(settled.cameraState.eye, targetEndpoint);
    assert(
      distanceAfter < distanceBefore - 1,
      `camera did not fly closer to the endpoint (${round(distanceBefore)} -> ${round(distanceAfter)})`,
    );

    const centreX = settled.canvas.width / 2;
    const centreY = settled.canvas.height / 2;
    const independent = projectToCanvas(
      targetEndpoint,
      settled.cameraState,
      settled.canvas.width,
      settled.canvas.height,
    );
    const centerDeltaPx = Math.hypot(independent.x - centreX, independent.y - centreY);
    assert(independent.onScreen, 'settled endpoint is not on screen — frameOnce did not centre it');
    assert(
      centerDeltaPx <= CENTER_TOLERANCE_PX,
      `settled endpoint is ${centerDeltaPx.toFixed(2)} px from the canvas centre (limit ${CENTER_TOLERANCE_PX})`,
    );
    const pageProjection = settled.markerScreenPositions.find((marker) => marker.trackIndex === target.trackIndex);
    assert(pageProjection?.onScreen === true, 'page marker projection is not on screen after the flight');
    const pageCenterDeltaPx = Math.hypot(pageProjection.x - centreX, pageProjection.y - centreY);
    assert(
      pageCenterDeltaPx <= CENTER_TOLERANCE_PX + 2,
      `page projection is ${pageCenterDeltaPx.toFixed(2)} px from the canvas centre`,
    );

    mkdirSync(CAPTURES, { recursive: true });
    const screenshot = join(CAPTURES, `task-11-flyto-centered-run${runNumber()}.png`);
    await page.screenshot({ path: screenshot });
    console.log(`  screenshot: ${screenshot}`);

    // The interactive input path must still drive the same camera after a flight (wheel = moveBy).
    const wheelEyeBefore = settled.cameraState.eye;
    await dispatchWheel(page, 120);
    await sleep(150);
    const afterWheel = await probe(page);
    const wheelDelta = distance(afterWheel.cameraState.eye, wheelEyeBefore);
    assert(wheelDelta > 1, `wheel input moved the camera only ${wheelDelta.toFixed(3)} units — input path broken`);
    console.log(`  wheel input moved the eye ${round(wheelDelta)} units (input path alive)`);

    return {
      afterWheel,
      before,
      centerDeltaPx,
      clicked,
      distanceAfter,
      distanceBefore,
      eyeMiss,
      pageCenterDeltaPx,
      pageErrors,
      samples,
      sawMidflight,
      settled,
      settleElapsedMs,
      target,
      targetMiss,
      wheelDelta,
    };
  } finally {
    await page.close();
  }
}

function runNumber() {
  if (!existsSync(EVIDENCE)) {
    return 1;
  }

  return (
    readFileSync(EVIDENCE, 'utf8')
      .split('\n')
      .filter((line) => line.trim().startsWith('{')).length + 1
  );
}

// ---------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------

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

main().then(
  () => {
    console.log('PASS: free-camera fly-to reached the selected marker, centred, bounded and input-alive');
    process.exitCode = 0;
  },
  (error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
