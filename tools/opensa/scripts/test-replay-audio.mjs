/**
 * Acceptance test for the live Web Audio replay renderer (todo 18, `apps/web/src/flight/audio-engine-web.ts`).
 *
 * Drives the installed replay page in a FRESH throwaway Chrome profile over CDP (the same boilerplate as
 * `test-endpoint-markers.mjs`) and asserts from the `window.__flight` probe, never from a screenshot:
 * synthesis nodes created/updated over time, one-shot lifecycle, seek/pause/speed consistency, the replay
 * camera as the Web Audio listener, the recorded-WAV comparison path, and a clean console.
 *
 *   node scripts/test-replay-audio.mjs <recording.csv>
 *       Happy path. Imports the recording plus its same-name WAV through the picker, then asserts:
 *       - 14 pak samples decoded (6 per-model engine steps x 2 models + collision + explosion), the model's
 *         engine bank selected from the manifest, zero synth nodes before play (the graph is lazy);
 *       - playing creates the graph (>= 4 nodes) and the two persistent engine-loop voices, updates rise
 *         over time, engine gain/rate are non-zero, the AudioContext is running;
 *       - the listener position equals the replay camera eye of the same frame;
 *       - pause silences the loops (gain 0, liveSources 2 = the loops, no one-shots);
 *       - a paused seek fires no event; playing across the recorded explosion fires exactly one one-shot
 *         (nodesCreated rises), which is RELEASED (releasedOneShots >= 1, liveOneShots 0) — no orphans;
 *       - speed 4 raises the applied engine rate and the probe speed; the WAV element follows the same
 *         speed while it plays (time advances), the synth stays silent; switching back resumes synth;
 *       - importing a second recording bumps the track epoch, stops old one-shots and keeps exactly the
 *         two loop voices (no stale nodes);
 *       - console error count is 0 (the deliberate auto-load 404 is the only ignored URL).
 *       It also runs the muted lane below on a second page, so the evidence file covers both.
 *
 *   node scripts/test-replay-audio.mjs <recording.csv> --expect-muted
 *       Failure path: the pak's `audio/manifest.json` request is fulfilled with 404 over CDP, so the page
 *       boots without the audio lane. Asserts state `no-samples`, 0 decoded samples, 0 created nodes /
 *       0 live sources / 0 updates THROUGH play, seek and a speed change, the on-screen `#audioStatus`
 *       message names the missing samples, the replay clock still runs, and console errors are 0 (the
 *       intentionally-404'd manifest URL is the only ignored one). Appends the same evidence file.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const RECORDINGS = join(REPO_ROOT, 'GTA San Andreas', 'flight_recordings');
const EVIDENCE = join(REPO_ROOT, '.omo', 'evidence');
const EVIDENCE_STEM = 'task-18-flight-analysis-remediation-and-worktree-cleanup';
const ORIGIN = 'http://127.0.0.1:4173';
const DEFAULT_CSV = join(RECORDINGS, 'flight_20260926_153900_322_m520_001.csv');
// A URL that 404s on purpose: with no auto-loaded track the imported set is exactly what this test sends.
const NO_AUTO_LOAD = '/replay-audio-no-auto-load.csv';
const MANIFEST_URL = '/map-pak/audio/manifest.json';
/** Chrome requests the favicon itself and the static replay server has none — not an app error. */
const FAVICON_URL = '/favicon.ico';
/** Playback rates are a live mapping, so the speed assertion compares bands, not exact equality. */
const SPEED_RATE_MIN_RATIO = 1.5;
const SPEED_RATE_MAX_RATIO = 8;

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

async function launchChrome(url) {
  const chrome = CHROME_PATHS.find((path) => existsSync(path));
  assert(chrome, 'Chrome not found (looked in Program Files and LOCALAPPDATA)');
  const profile = join(tmpdir(), `opensa-replay-audio-${Date.now()}`); // fresh throwaway profile
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
// Page driving + probe
// ---------------------------------------------------------------------------------------------------

function metrics(label, state) {
  return `${label}: ${JSON.stringify(summary(state))}`;
}

async function openPage(browser, options = {}) {
  const page = await browser.newPage();
  const ignoredUrls = [FAVICON_URL, NO_AUTO_LOAD, ...(options.muted ? [MANIFEST_URL] : [])];
  const tracker = watchErrors(page, ignoredUrls);
  if (options.muted) {
    await page.route('**/map-pak/audio/manifest.json', (route) =>
      route.fulfill({ body: '{}', contentType: 'application/json', status: 404 }),
    );
  }
  await page.goto(`${ORIGIN}/opensa/flight-replay.html?${new URLSearchParams({ recording: NO_AUTO_LOAD })}`, {
    timeout: 60000,
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => globalThis.__flight?.worldReady === true, undefined, { timeout: 180000 });

  return { page, tracker };
}

async function probe(page) {
  return page.evaluate(() => {
    const flight = globalThis.__flight;

    return {
      audioSourceMode: flight?.audioSourceMode ?? '',
      audioStatus: document.getElementById('audioStatus')?.textContent ?? null,
      audioWavActive: flight?.audioWavActive ?? null,
      audioWavHasAudio: flight?.audioWavHasAudio ?? null,
      audioWavMuted: flight?.audioWavMuted ?? null,
      audioWavRate: flight?.audioWavRate ?? -1,
      audioWavTime: flight?.audioWavTime ?? -1,
      audioWebContext: flight?.audioWebContext ?? '',
      audioWebEngineBank: flight?.audioWebEngineBank ?? '',
      audioWebEngineGain: flight?.audioWebEngineGain ?? -1,
      audioWebEngineRate: flight?.audioWebEngineRate ?? -1,
      audioWebListenerPos: flight?.audioWebListenerPos ?? null,
      audioWebLiveOneShots: flight?.audioWebLiveOneShots ?? -1,
      audioWebLiveSources: flight?.audioWebLiveSources ?? -1,
      audioWebMessage: flight?.audioWebMessage ?? '',
      audioWebMuted: flight?.audioWebMuted ?? null,
      audioWebNodesCreated: flight?.audioWebNodesCreated ?? -1,
      audioWebOneShotsStarted: flight?.audioWebOneShotsStarted ?? -1,
      audioWebPlaying: flight?.audioWebPlaying ?? null,
      audioWebReleasedOneShots: flight?.audioWebReleasedOneShots ?? -1,
      audioWebReverbZone: flight?.audioWebReverbZone ?? '',
      audioWebSamples: flight?.audioWebSamples ?? -1,
      audioWebSpeed: flight?.audioWebSpeed ?? -1,
      audioWebState: flight?.audioWebState ?? '',
      audioWebTimelineEvents: flight?.audioWebTimelineEvents ?? -1,
      audioWebTrackEpoch: flight?.audioWebTrackEpoch ?? -1,
      audioWebUpdates: flight?.audioWebUpdates ?? -1,
      cameraEye: flight?.cameraState?.eye ?? null,
      phase: flight?.phase ?? '',
      renders: flight?.renders ?? 0,
      scrub: Number(document.getElementById('scrub')?.value ?? -1),
      tracks: document.querySelectorAll('.track').length,
    };
  });
}

/** The probe fields that carry the audio state, printed verbatim in every log line and in the evidence. */
function summary(state) {
  return {
    context: state.audioWebContext,
    engineBank: state.audioWebEngineBank,
    engineGain: state.audioWebEngineGain,
    engineRate: Number(state.audioWebEngineRate.toFixed(4)),
    liveOneShots: state.audioWebLiveOneShots,
    liveSources: state.audioWebLiveSources,
    nodes: state.audioWebNodesCreated,
    oneShots: state.audioWebOneShotsStarted,
    released: state.audioWebReleasedOneShots,
    reverbZone: state.audioWebReverbZone,
    samples: state.audioWebSamples,
    speed: state.audioWebSpeed,
    state: state.audioWebState,
    timelineEvents: state.audioWebTimelineEvents,
    trackEpoch: state.audioWebTrackEpoch,
    updates: state.audioWebUpdates,
    wavActive: state.audioWavActive,
    wavRate: state.audioWavRate,
    wavTime: Number(state.audioWavTime.toFixed(3)),
  };
}

/**
 * Console errors are collected per page. The two deliberately-404'd URLs are the ONLY ignored locations:
 * the auto-load recording (both lanes) and the aborted audio manifest (muted lane). Everything else fails
 * the run.
 */
function watchErrors(page, ignoredUrls) {
  const errors = [];
  const ignored = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const url = message.location()?.url ?? '';
    const line = `console.error ${url || '(no url)'}: ${message.text()}`;
    if (ignoredUrls.some((fragment) => url.includes(fragment))) {
      ignored.push(line);
    } else {
      errors.push(line);
    }
  });
  page.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => {});
  });

  return { errors, ignored };
}

const listenerDelta = (state) => {
  if (!Array.isArray(state.cameraEye) || !Array.isArray(state.audioWebListenerPos)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.hypot(
    state.cameraEye[0] - state.audioWebListenerPos[0],
    state.cameraEye[1] - state.audioWebListenerPos[1],
    state.cameraEye[2] - state.audioWebListenerPos[2],
  );
};

async function addFiles(page, paths, expectedTracks) {
  await page.setInputFiles('#picker', paths);
  await page.waitForFunction((count) => document.querySelectorAll('.track').length === count, expectedTracks, {
    timeout: 60000,
  });
}

function appendEvidence(section) {
  mkdirSync(EVIDENCE, { recursive: true });
  const path = join(EVIDENCE, `${EVIDENCE_STEM}.txt`);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = [
    '',
    `standalone --expect-muted re-verification (${new Date().toISOString()})`,
    ...formatLane('muted lane', section),
    '',
  ];
  writeFileSync(path, `${existing}${lines.join('\n')}`);
  console.log(`evidence (appended): ${path}`);

  return path;
}

// ---------------------------------------------------------------------------------------------------
// Happy lane
// ---------------------------------------------------------------------------------------------------

function formatLane(name, lane) {
  const lines = [`${name}:`];
  for (const [key, value] of Object.entries(lane)) {
    if (key === 'ignoredConsoleErrors') {
      continue;
    }
    lines.push(`  ${key}: ${JSON.stringify(value)}`);
  }
  lines.push(`  ignored console errors (intended 404s): ${JSON.stringify(lane.ignoredConsoleErrors)}`);

  return lines;
}

// ---------------------------------------------------------------------------------------------------
// Muted lane (no audio manifest)
// ---------------------------------------------------------------------------------------------------

function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const expectMuted = args.includes('--expect-muted');
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const csvPath = resolve(positional[0] ?? DEFAULT_CSV);
  const wavPath = csvPath.replace(/\.csv$/i, '.wav');
  assert(existsSync(csvPath), `recording not found: ${csvPath}`);
  if (!expectMuted) {
    assert(existsSync(wavPath), `sibling WAV not found: ${wavPath} (the comparison path needs it)`);
  }

  await ensureServer();
  const browser = await launchChrome(`${ORIGIN}/opensa/flight-replay.html`);
  try {
    if (expectMuted) {
      const muted = await runMutedLane(browser, csvPath);
      appendEvidence(muted);
    } else {
      const happy = await runHappyLane(browser, csvPath, wavPath);
      const muted = await runMutedLane(browser, csvPath);
      writeEvidence(happy, muted);
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

async function runHappyLane(browser, csvPath, wavPath) {
  const { page, tracker } = await openPage(browser);
  try {
    console.log(`happy lane: importing ${csvPath} + ${wavPath}`);
    assert((await probe(page)).tracks === 0, 'happy lane: a track was auto-loaded');
    await addFiles(page, [csvPath, wavPath], 1);
    await page.waitForFunction(() => globalThis.__flight?.audioWebState === 'ready', undefined, { timeout: 30000 });
    await page.waitForFunction(() => globalThis.__flight?.audioWavHasAudio === true, undefined, { timeout: 30000 });

    const initial = await probe(page);
    console.log(metrics('  initial (silent before play)', initial));
    // The v2 pak bakes 6 engine rate-steps per model (2 voices x 3 steps) + collision + explosion = 14.
    assert(initial.audioWebSamples === 14, `initial: decoded samples ${initial.audioWebSamples} != 14`);
    // Per-model engine bank: a Hydra (520) recording must select the jet bank, never the prop bank.
    const modelMatch = /_m(\d+)_\d+\.csv$/i.exec(csvPath);
    const model = modelMatch ? Number(modelMatch[1]) : 0;
    const expectedBank = model === 520 ? 'SND_BANK_GENRL_VEHICLE_GEN' : model === 476 ? 'SND_BANK_GENRL_FASTPROP' : '';
    if (expectedBank) {
      assert(
        initial.audioWebEngineBank === expectedBank,
        `initial: model ${model} engine bank ${initial.audioWebEngineBank} != ${expectedBank}`,
      );
    }
    assert(initial.audioWebNodesCreated === 0, `initial: ${initial.audioWebNodesCreated} nodes created before play`);
    assert(initial.audioWebLiveSources === 0, `initial: ${initial.audioWebLiveSources} live sources before play`);
    assert(initial.audioWebTimelineEvents === 1, `initial: timeline events ${initial.audioWebTimelineEvents} != 1`);
    assert(initial.audioSourceMode === 'synth', `initial: audio source mode ${initial.audioSourceMode} != synth`);
    assert(
      listenerDelta(initial) < 1e-6,
      `initial: listener is not the replay camera (delta ${listenerDelta(initial)})`,
    );
    assert(initial.audioStatus?.includes('就绪'), `initial: status "${initial.audioStatus}" does not report readiness`);

    // Play: graph + two persistent engine loops, updated every frame.
    await page.click('#play');
    await sleep(1800);
    const playing1 = await probe(page);
    console.log(metrics('  playing t+1.8s', playing1));
    assert(playing1.audioWebPlaying === true, 'playing: probe does not report the synth as playing');
    assert(playing1.audioWebContext === 'running', `playing: AudioContext ${playing1.audioWebContext} != running`);
    assert(
      playing1.audioWebNodesCreated >= 10,
      `playing: only ${playing1.audioWebNodesCreated} nodes created (need graph + 2 loops)`,
    );
    assert(
      playing1.audioWebLiveSources === 2,
      `playing: live sources ${playing1.audioWebLiveSources} != 2 engine loops`,
    );
    assert(
      playing1.audioWebLiveOneShots === 0,
      `playing: ${playing1.audioWebLiveOneShots} one-shots before the recorded event`,
    );
    assert(playing1.audioWebEngineGain > 0, `playing: engine gain ${playing1.audioWebEngineGain} is silent`);
    assert(playing1.audioWebEngineRate > 0, `playing: engine rate ${playing1.audioWebEngineRate} is zero`);
    assert(
      listenerDelta(playing1) < 1e-6,
      `playing: listener is not the replay camera (delta ${listenerDelta(playing1)})`,
    );
    assert(playing1.scrub > 1, `playing: replay clock did not advance (scrub ${playing1.scrub})`);
    await sleep(1600);
    const playing2 = await probe(page);
    console.log(metrics('  playing t+3.4s', playing2));
    assert(
      playing2.audioWebUpdates > playing1.audioWebUpdates,
      `playing: updates did not rise (${playing1.audioWebUpdates} -> ${playing2.audioWebUpdates})`,
    );

    // Speed: the applied engine rate rises with the replay speed; the WAV element follows the same value.
    const rate1 = playing2.audioWebEngineRate;
    await page.selectOption('#speed', '4');
    await sleep(900);
    const speed4 = await probe(page);
    console.log(metrics('  speed 4x', speed4));
    assert(speed4.audioWebSpeed === 4, `speed: probe speed ${speed4.audioWebSpeed} != 4`);
    assert(
      speed4.audioWebEngineRate >= rate1 * SPEED_RATE_MIN_RATIO &&
        speed4.audioWebEngineRate <= rate1 * SPEED_RATE_MAX_RATIO,
      `speed: applied rate ${speed4.audioWebEngineRate} not in [${SPEED_RATE_MIN_RATIO}x, ${SPEED_RATE_MAX_RATIO}x] of ${rate1}`,
    );

    // WAV comparison path: the recorded element plays, advances in real time and follows the speed.
    await page.selectOption('#audioSource', 'wav');
    await sleep(700);
    const wav1 = await probe(page);
    console.log(metrics('  wav selected', wav1));
    assert(wav1.audioWavActive === true, 'wav: the recorded element is not playing');
    assert(wav1.audioWavRate === 4, `wav: playbackRate ${wav1.audioWavRate} != 4`);
    assert(wav1.audioWebEngineGain === 0, `wav: synth engine gain ${wav1.audioWebEngineGain} != 0 while WAV plays`);
    await sleep(900);
    const wav2 = await probe(page);
    console.log(metrics('  wav advancing', wav2));
    assert(
      wav2.audioWavTime > wav1.audioWavTime,
      `wav: element time did not advance (${wav1.audioWavTime} -> ${wav2.audioWavTime})`,
    );

    // Back to synthesis: engine gain returns, the WAV parks again.
    await page.selectOption('#speed', '1');
    await page.selectOption('#audioSource', 'synth');
    await sleep(600);
    const synth2 = await probe(page);
    console.log(metrics('  back to synth', synth2));
    assert(synth2.audioWavActive === false, 'synth: the WAV element still plays after switching back');
    assert(
      synth2.audioWebEngineGain > 0,
      `synth: engine gain ${synth2.audioWebEngineGain} is silent after switching back`,
    );

    // Pause: loops parked at gain 0 (they are the only live sources), one-shots none, clock stops.
    await page.click('#play');
    await page.waitForFunction(() => globalThis.__flight?.audioWebPlaying === false, undefined, { timeout: 5000 });
    await sleep(400);
    const paused = await probe(page);
    console.log(metrics('  paused', paused));
    assert(paused.audioWebEngineGain === 0, `paused: engine gain ${paused.audioWebEngineGain} != 0`);
    assert(paused.audioWebLiveSources === 2, `paused: live sources ${paused.audioWebLiveSources} != 2 loops`);
    assert(paused.audioWavActive === false, 'paused: the parked WAV element is playing in synth mode');

    // Paused seek: no event may fire from a scrub.
    await setScrub(page, 0);
    await sleep(300);
    const seek0 = await probe(page);
    console.log(metrics('  paused seek to 0', seek0));
    assert(
      seek0.audioWebOneShotsStarted === paused.audioWebOneShotsStarted,
      `seek: a paused seek fired an event (${paused.audioWebOneShotsStarted} -> ${seek0.audioWebOneShotsStarted})`,
    );
    assert(seek0.audioWebLiveSources === 2, `seek: live sources ${seek0.audioWebLiveSources} != 2 loops`);
    assert(seek0.scrub === 0, `seek: replay clock ${seek0.scrub} != 0`);

    // Play across the recorded explosion: one one-shot starts, then releases with no orphan left.
    await setScrub(page, 19.2);
    await page.click('#play');
    await page.waitForFunction(() => globalThis.__flight?.audioWebOneShotsStarted >= 1, undefined, { timeout: 10000 });
    const burst = await probe(page);
    console.log(metrics('  explosion crossed', burst));
    assert(
      burst.audioWebOneShotsStarted === 1,
      `explosion: ${burst.audioWebOneShotsStarted} one-shots started, expected 1`,
    );
    assert(burst.audioWebLiveOneShots >= 1, 'explosion: the one-shot is not live right after it starts');
    assert(
      burst.audioWebNodesCreated >= synth2.audioWebNodesCreated + 3,
      `explosion: nodesCreated did not rise (${synth2.audioWebNodesCreated} -> ${burst.audioWebNodesCreated})`,
    );
    await page.waitForFunction(
      () => globalThis.__flight?.audioWebLiveOneShots === 0 && globalThis.__flight?.audioWebReleasedOneShots >= 1,
      undefined,
      { timeout: 10000 },
    );
    const settled = await probe(page);
    console.log(metrics('  one-shot settled (no orphans)', settled));
    assert(settled.audioWebLiveSources === 2, `settled: live sources ${settled.audioWebLiveSources} != 2 loops`);

    // Track switch: epoch rises, old one-shots are stopped, exactly the two loops remain (no stale state).
    await addFiles(page, [csvPath], 2);
    await sleep(600);
    const switched = await probe(page);
    console.log(metrics('  after track switch', switched));
    assert(
      switched.audioWebTrackEpoch === synth2.audioWebTrackEpoch + 1,
      `switch: track epoch ${switched.audioWebTrackEpoch} != ${synth2.audioWebTrackEpoch + 1}`,
    );
    assert(
      switched.audioWebLiveOneShots === 0,
      `switch: ${switched.audioWebLiveOneShots} one-shots survived the switch`,
    );
    assert(switched.audioWebLiveSources === 2, `switch: live sources ${switched.audioWebLiveSources} != 2 loops`);
    assert(
      switched.audioWebReleasedOneShots >= synth2.audioWebReleasedOneShots,
      'switch: released counter went backwards',
    );
    assert(
      listenerDelta(switched) < 1e-6,
      `switch: listener is not the replay camera (delta ${listenerDelta(switched)})`,
    );

    assert(tracker.errors.length === 0, `happy lane: console errors\n${tracker.errors.join('\n')}`);
    const result = {
      burst: summary(burst),
      consoleErrors: tracker.errors.length,
      ignoredConsoleErrors: tracker.ignored,
      initial: summary(initial),
      paused: summary(paused),
      playing1: summary(playing1),
      playing2: summary(playing2),
      seek0: summary(seek0),
      settled: summary(settled),
      speed4: summary(speed4),
      switched: summary(switched),
      synth2: summary(synth2),
      wav1: summary(wav1),
      wav2: summary(wav2),
    };
    console.log(
      `happy lane PASS: nodes ${initial.audioWebNodesCreated} -> ${settled.audioWebNodesCreated}, updates ${settled.audioWebUpdates}, released ${settled.audioWebReleasedOneShots}, console errors ${tracker.errors.length}`,
    );

    return result;
  } finally {
    await page.close();
  }
}

async function runMutedLane(browser, csvPath) {
  const { page, tracker } = await openPage(browser, { muted: true });
  try {
    console.log(`muted lane: importing ${csvPath} with ${MANIFEST_URL} fulfilled as 404`);
    await addFiles(page, [csvPath], 1);
    await page.waitForFunction(() => globalThis.__flight?.audioWebState === 'no-samples', undefined, {
      timeout: 30000,
    });
    const imported = await probe(page);
    console.log(metrics('  no-samples after import', imported));
    assert(imported.audioWebSamples === 0, `muted: decoded samples ${imported.audioWebSamples} != 0`);
    assert(imported.audioWebNodesCreated === 0, `muted: ${imported.audioWebNodesCreated} nodes created`);
    assert(imported.audioWebLiveSources === 0, `muted: ${imported.audioWebLiveSources} live sources`);
    assert(imported.audioWebState === 'no-samples', `muted: state ${imported.audioWebState} != no-samples`);
    assert(
      imported.audioWebMessage.includes('无样本'),
      `muted: message "${imported.audioWebMessage}" does not name the missing samples`,
    );
    assert(
      (imported.audioStatus ?? '').includes('无样本'),
      `muted: on-screen status "${imported.audioStatus}" does not name the missing samples`,
    );
    assert(imported.audioSourceMode === 'synth', `muted: source mode ${imported.audioSourceMode} != synth`);
    assert(imported.audioWavHasAudio === false, 'muted: a WAV was attached but none was imported');

    // Play, seek and a speed change must all stay silent and allocate nothing.
    await page.click('#play');
    await sleep(1600);
    const playing = await probe(page);
    console.log(metrics('  playing (must stay silent)', playing));
    assert(playing.scrub > 1, `muted: the replay clock did not advance (scrub ${playing.scrub})`);
    assert(playing.audioWebPlaying === false, 'muted: the synth reports playing without samples');
    assert(playing.audioWebEngineGain === 0 && playing.audioWebEngineRate === 0, 'muted: engine params are not silent');
    assert(playing.audioWebNodesCreated === 0, `muted: ${playing.audioWebNodesCreated} nodes created while playing`);
    assert(playing.audioWebLiveSources === 0, `muted: ${playing.audioWebLiveSources} live sources while playing`);
    assert(playing.audioWebUpdates === 0, `muted: ${playing.audioWebUpdates} updates without a graph`);
    assert(playing.audioWavActive === false, 'muted: the WAV element is active without a WAV');

    await page.selectOption('#speed', '4');
    await setScrub(page, 19.4);
    await sleep(800);
    await page.click('#play');
    await sleep(500);
    const after = await probe(page);
    console.log(metrics('  after speed + seek + pause', after));
    assert(after.audioWebNodesCreated === 0, `muted: ${after.audioWebNodesCreated} nodes created after seek/speed`);
    assert(after.audioWebLiveSources === 0, `muted: ${after.audioWebLiveSources} live sources after seek/speed`);
    assert(after.audioWebLiveOneShots === 0, `muted: ${after.audioWebLiveOneShots} one-shots without samples`);
    assert(after.audioWebUpdates === 0, `muted: ${after.audioWebUpdates} updates without a graph`);
    assert(after.audioWebState === 'no-samples', `muted: state ${after.audioWebState} != no-samples`);

    assert(tracker.errors.length === 0, `muted lane: console errors\n${tracker.errors.join('\n')}`);
    const result = {
      after: summary(after),
      audioStatus: imported.audioStatus,
      consoleErrors: tracker.errors.length,
      ignoredConsoleErrors: tracker.ignored,
      imported: summary(imported),
      message: imported.audioWebMessage,
      playing: summary(playing),
    };
    console.log(
      `muted lane PASS: 0 nodes, 0 live sources, status names the missing samples, console errors ${tracker.errors.length}`,
    );

    return result;
  } finally {
    await page.close();
  }
}

async function setScrub(page, seconds) {
  await page.evaluate((value) => {
    const scrub = document.getElementById('scrub');
    scrub.value = String(value);
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
}

function worktreeStatus() {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

    return status.length > 0 ? status.split('\n') : ['(clean)'];
  } catch {
    return ['(git status failed)'];
  }
}

// ---------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------

function writeEvidence(happy, muted) {
  mkdirSync(EVIDENCE, { recursive: true });
  const path = join(EVIDENCE, `${EVIDENCE_STEM}.txt`);
  const lines = [
    `task-18 live Web Audio replay renderer - probe evidence (${new Date().toISOString()})`,
    '',
    `head commit: ${headCommit()}`,
    'worktree changed files (porcelain):',
    ...worktreeStatus().map((line) => `  ${line}`),
    '',
    ...formatLane('happy lane', happy),
    '',
    ...formatLane('muted lane (audio manifest 404)', muted),
    '',
    'probe fields: nodes = created audio nodes; updates = frames that wrote node params; liveSources = loops +',
    'unreleased one-shots; released = one-shots whose nodes were disconnected; listener = replay camera eye.',
    'These are measured from the running page, not inferred.',
    '',
  ];
  writeFileSync(path, lines.join('\n'));
  console.log(`evidence: ${path}`);

  return path;
}

main().then(
  () => {
    console.log('PASS: live Web Audio replay renderer verified against the debug probe');
    process.exitCode = 0;
  },
  (error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
