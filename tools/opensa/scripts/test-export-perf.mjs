#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
/**
 * Todo 25/26: 30/60/120 fps export pipeline - hardware encode, sustained-realtime, cancel and determinism
 * criteria.
 *
 * The export pipeline under test is the REAL one: this harness drives `web-replay/video-export.mjs`
 * through its HTTP contract. Lanes run:
 *
 *   fast acceptance (todo 26)
 *     A 1 s clip at 30 fps - the default rate must stay a working path - asserted with the same
 *     instrumentation as the sustained rates, plus that the primary path launches NO browser at all
 *     (renderer options visible=false, executablePath=null).
 *
 *   pipeline (the sustained benchmark)
 *     60 s of deterministic RAW 1920x1080 RGBA frames - the exact frame contract the browser compositor
 *     hands the exporter - are fed to the exporter at the target rate. The exporter asks for one frame per
 *     `1/fps` (the browser lane does the analytic 25 Hz telemetry / 100 Hz camera resampling), pipes raw
 *     frames to FFmpeg QSV with the proven oneVPL chain from the G2 spike (`-init_hw_device qsv=hw
 *      -filter_hw_device hw -vf "format=nv12,hwupload=extra_hw_frames=32,format=qsv" -c:v h264_qsv
 *      -fps_mode cfr -r <fps>`), and muxes audio with `-t frames/fps`. This is what is measured for
 *     SUSTAINED throughput over the full 60 s (not a warm 10 s run) and for two-run frame determinism.
 *
 *   cancel probe (todo 26)
 *     A slow 30 fps clip is interrupted mid-run: the partial MP4 must exist with bytes before the cancel
 *     (its path is the encoder's output argument), then be deleted, the FFmpeg child reaped, and a fresh
 *     export must succeed afterwards - no stale lock, no orphan.
 *
 *   browser (a bounded sanity lane)
 *     A short clip is exported through the real headless Chrome + WebGPU compositor (`local-server.mjs`),
 *     proving the browser lane honors the target fps and hardware-encodes. The compositor's measured
 *     per-frame cost is recorded; on this host it cannot sustain realtime, which is a DOCUMENTED DEGRADED
 *     CONTRACT (task-25 measured 160.8 ms/frame at 60 fps and 149.3 ms/frame at 120 fps), never a silent
 *     downgrade.
 *
 * Assertions per rate: `ffprobe avg_frame_rate` exactly `<fps>/1`, frame count `ceil(duration*fps)`,
 * duration error <= one frame, an AAC audio stream, the encoder-init log naming the Intel adapter + a
 * oneVPL/MFX session (hardware proof, not a codec name), a rawvideo/rgba pipe whose encoder args name no
 * image format, the compositor backend reported, no PNG signature, identical frame times `frame/fps`, and
 * two runs whose selected decoded frames AND decoded audio hash equal.
 *
 * Usage (from tools/opensa):
 *   node scripts/test-export-perf.mjs
 *   node scripts/test-export-perf.mjs --fps 60,120 --seconds 60 --timeout 240 [--no-browser] [--strict-sustained]
 *   node scripts/test-export-perf.mjs --fps 61          # -> exit 2 "unsupported frame rate"
 */
import http from 'node:http';
import { createServer } from 'node:net';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createVideoExporter } from '../../../web-replay/video-export.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPENSA_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(OPENSA_ROOT, '..', '..');
const WEB_REPLAY_DIR = path.join(REPO_ROOT, 'web-replay');
const SERVER_ENTRY = path.join(WEB_REPLAY_DIR, 'local-server.mjs');
const MAP_PAK_DIR = path.join(OPENSA_ROOT, 'map-pak');
const EVIDENCE_DIR = path.join(REPO_ROOT, '.omo', 'evidence');
const EVIDENCE_JSON = path.join(EVIDENCE_DIR, 'task-26-export-perf.json');
const EVIDENCE_TASK28 = path.join(EVIDENCE_DIR, 'task-28-flight-analysis-remediation-and-worktree-cleanup.json');

const WIDTH = 1920;
const HEIGHT = 1080;
const FRAME_BYTES = WIDTH * HEIGHT * 4;
const SUPPORTED_FPS = [30, 60, 120];
const DEFAULT_FPS = [60, 120];
const DEFAULT_SECONDS = 60;
const BROWSER_LANE_SECONDS = 2;
const FAST_ACCEPTANCE_SECONDS = 1;
const FAST_ACCEPTANCE_FPS = 30;
const CANCEL_PROBE_SECONDS = 1;
const CANCEL_PROBE_FPS = 30;
const CANCEL_PROBE_FRAME_DELAY_MS = 20;
const DEFAULT_TIMEOUT_MS = 300_000;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

// Task-25 measured the real browser compositor on this host and found it cannot sustain realtime. The
// browser lane is EXPECTED to report degraded by these margins; it is recorded, never silently swallowed.
const T25_BROWSER_DEGRADED = [
  { budgetMs: 1000 / 60, fps: 60, perFrameMs: 160.8 },
  { budgetMs: 1000 / 120, fps: 120, perFrameMs: 149.3 },
];

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

// ---------------------------------------------------------------------------------------------------------
// Deterministic raw frames (the browser compositor's exact contract: tightly-packed RGBA, 1920x1080).
// ---------------------------------------------------------------------------------------------------------

const FRAME_POOL = [];
/** A valid 25 Hz FlightRecorder CSV for the browser lane (Hydra 520, one banked circle). */
function buildFixtureCsv(seconds) {
  const header = [
    'local_timestamp',
    'capture_elapsed_s',
    'model',
    'health',
    'x',
    'y',
    'z',
    'heading_deg',
    'right_x',
    'right_y',
    'right_z',
    'up_x',
    'up_y',
    'up_z',
    'forward_x',
    'forward_y',
    'forward_z',
    'vx',
    'vy',
    'vz',
    'steer',
    'throttle',
    'brake',
    'landing_gear_status',
    'game_hour',
    'game_minute',
    'game_second',
    'weather_new',
    'weather_old',
    'weather_forced',
    'node_status',
    'smoke_active',
  ];
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  const f = (value) => value.toFixed(6);
  const radius = 400;
  const omega = (2 * Math.PI) / seconds;
  const lines = ['# gtasa_flight_recorder,version=9,sample_hz=25', header.join(',')];
  for (let index = 0; index <= Math.round(seconds * 25); index += 1) {
    const t = index / 25;
    const theta = omega * t;
    const x = 1500 + radius * Math.sin(theta);
    const y = -1600 - radius * Math.cos(theta);
    const z = 220 + 15 * Math.sin(theta * 2);
    const vx = radius * omega * Math.cos(theta);
    const vy = radius * omega * Math.sin(theta);
    const vz = 30 * omega * Math.cos(theta * 2);
    const speed = Math.hypot(vx, vy, vz) || 1;
    const fx = vx / speed;
    const fy = vy / speed;
    const fz = vz / speed;
    const rlen = Math.hypot(fy, -fx) || 1;
    const rx = fy / rlen;
    const ry = -fx / rlen;
    const ux0 = ry * fz;
    const uy0 = -rx * fz;
    const uz0 = rx * fy - ry * fx;
    const cosB = Math.cos(-0.5);
    const sinB = Math.sin(-0.5);
    const values = {
      brake: '0',
      capture_elapsed_s: f(t),
      forward_x: f(fx),
      forward_y: f(fy),
      forward_z: f(fz),
      game_hour: '12',
      game_minute: '0',
      game_second: '0',
      heading_deg: f(((Math.atan2(fx, fy) * 180) / Math.PI + 360) % 360),
      health: '1000',
      landing_gear_status: '0',
      local_timestamp: new Date(base + Math.round(t * 1000)).toISOString(),
      model: '520',
      node_status: '0',
      right_x: f(rx * cosB - ux0 * sinB),
      right_y: f(ry * cosB - uy0 * sinB),
      right_z: f(-uz0 * sinB),
      smoke_active: '0',
      steer: '0',
      throttle: '0.6',
      up_x: f(ux0 * cosB + rx * sinB),
      up_y: f(uy0 * cosB + ry * sinB),
      up_z: f(uz0 * cosB),
      vx: f(vx),
      vy: f(vy),
      vz: f(vz),
      weather_forced: '0',
      weather_new: '0',
      weather_old: '0',
      x: f(x),
      y: f(y),
      z: f(z),
    };
    lines.push(header.map((column) => values[column]).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function buildFramePool(count = 8) {
  for (let index = 0; index < count; index += 1) {
    const buffer = Buffer.allocUnsafe(FRAME_BYTES);
    const pixels = new Uint32Array(buffer.buffer, buffer.byteOffset, FRAME_BYTES / 4);
    for (let y = 0; y < HEIGHT; y += 1) {
      const r = (y + index * 11) & 0xff;
      const g = (y * 3 + index * 7) & 0xff;
      const b = ((y >> 2) + index * 13) & 0xff;
      pixels.fill(((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0, y * WIDTH, (y + 1) * WIDTH);
    }
    const blockX = Math.floor((index / count) * (WIDTH - 240));
    const block = index % 2 === 0 ? 0xff000000 : 0xffffffff;
    for (let y = 240; y < 480; y += 1) {
      pixels.fill(block >>> 0, y * WIDTH + blockX, y * WIDTH + blockX + 240);
    }
    FRAME_POOL.push(buffer);
  }
}

function buildWav(seconds, sampleRate = 8000) {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / sampleRate)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function frameAtTime(seconds, fps) {
  const index = Math.round(seconds * fps);
  return FRAME_POOL[((index % FRAME_POOL.length) + FRAME_POOL.length) % FRAME_POOL.length];
}

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

function killTree(child) {
  if (!child || child.pid === undefined || child.exitCode !== null) return;
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/**
 * Hardware proof for the browser lane. On the raw fallback it is the oneVPL/MFX encoder-init log; on the
 * in-page path it is the WebCodecs result: a `prefer-hardware` config the browser accepted, a named adapter,
 * and (when the browser reports it) the `powerEfficient` media capability. The exact proof is recorded, never
 * assumed — a codec name alone is never accepted.
 */
function browserHardwareOk(job) {
  const evidence = job.encoderInitEvidence ?? {};
  const qsvLog = Boolean(evidence.deviceLine && evidence.mfxLine);
  const webcodecs =
    evidence.platform === 'webcodecs' &&
    job.videoEncode?.supported === true &&
    job.videoEncode?.hardwareAcceleration === 'prefer-hardware' &&
    typeof evidence.adapter === 'string' &&
    evidence.adapter.length > 0;
  return job.hardwareEncoder === true && (qsvLog || webcodecs);
}

function evaluateRun({ fps, job, probe, rendererOptions, seconds, times }) {
  const expectedFrames = Math.ceil(seconds * fps);
  const expectedTimes = Array.from({ length: expectedFrames }, (_, index) => index / fps);
  const chain = (job.encoderArgs ?? []).includes('-vf') ? job.encoderArgs[job.encoderArgs.indexOf('-vf') + 1] : null;
  const durationError = probe.durationSeconds === null ? null : Math.abs(probe.durationSeconds - seconds);
  const encoderArgs = job.encoderArgs ?? [];
  return {
    adapterReportedOk:
      typeof job.encoderInitEvidence?.adapter === 'string' && job.encoderInitEvidence.adapter.length > 0,
    audioOk: probe.audioCodec === 'aac',
    // Backend/encoder reporting is asserted from live values, never assumed from the request.
    backendReportedOk: typeof job.compositor?.backend === 'string' && job.compositor.backend.length > 0,
    chain,
    chainOk:
      encoderArgs.includes('h264_qsv') &&
      /hwupload=extra_hw_frames=32/.test(chain ?? '') &&
      /format=qsv/.test(chain ?? ''),
    compositorHiddenOk: job.compositor?.visible === false,
    durationError,
    durationOk: durationError !== null && durationError <= 1 / fps + 1e-6,
    expectedFrames,
    frameMatch: probe.frameCount === expectedFrames,
    hardwareOk:
      job.hardwareEncoder === true &&
      Boolean(job.encoderInitEvidence?.deviceLine) &&
      Boolean(job.encoderInitEvidence?.mfxLine),
    pipeFramesOk: job.frameStream?.frames === expectedFrames,
    pngOk: job.frameStream?.pngSignatureSeen === false,
    rateMatch: probe.avgFrameRate === `${fps}/1` && probe.rFrameRate === `${fps}/1`,
    // The encoder was told rawvideo/rgba and no image-format argument, matching the live frame-stream counters.
    rawPipeOk:
      job.frameStream?.inputFormat === 'rawvideo' &&
      job.frameStream?.pixelFormat === 'rgba' &&
      encoderArgs.includes('rawvideo') &&
      encoderArgs.includes('rgba') &&
      !encoderArgs.some((argument) => /png/i.test(argument)),
    // The primary path must launch NO browser: the renderer factory is asked for an invisible (headless)
    // renderer and receives a null executable path, so no browser process can exist on this lane at all.
    rendererHiddenOk: rendererOptions?.visible === false && rendererOptions?.executablePath === null,
    timesMatch: times.length === expectedFrames && times.every((value, index) => value === expectedTimes[index]),
  };
}

function ffprobeJson(args) {
  const result = runCapture(FFPROBE, args, 120_000);
  if (result.status !== 0) throw new Error(`ffprobe exited ${result.status}: ${(result.stderr ?? '').trim()}`);
  return JSON.parse(result.stdout);
}

/** Decode the muxed audio to RAW PCM and hash it: audio determinism is proven on samples, not on a codec name. */
function hashAudioStream(file) {
  const result = spawnSync(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-'],
    { maxBuffer: 256 * 1024 * 1024, timeout: 180_000, windowsHide: true },
  );
  if (result.error) throw new Error(`audio extraction failed: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`audio extraction failed: ${(result.stderr ?? Buffer.alloc(0)).toString().trim()}`);
  if (result.stdout.length === 0) throw new Error('audio extraction returned no samples');
  return { bytes: result.stdout.length, hash: sha256(result.stdout) };
}

/** Decode only the selected frame indices and hash their concatenated RAW RGBA bytes. */
function hashSelectedFrames(file, picks) {
  const unique = [...new Set(picks)].sort((a, b) => a - b);
  const expr = unique.map((index) => `eq(n\\,${index})`).join('+');
  const result = spawnSync(
    FFMPEG,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-vf',
      `select='${expr}'`,
      '-fps_mode',
      'passthrough',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-',
    ],
    { maxBuffer: 256 * 1024 * 1024, timeout: 180_000, windowsHide: true },
  );
  if (result.error) throw new Error(`frame extraction failed: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`frame extraction failed: ${(result.stderr ?? Buffer.alloc(0)).toString().trim()}`);
  if (result.stdout.length !== unique.length * FRAME_BYTES) {
    throw new Error(`frame extraction returned ${result.stdout.length} bytes, expected ${unique.length * FRAME_BYTES}`);
  }
  return sha256(result.stdout);
}

function probeVideo(videoPath) {
  const video = ffprobeJson([
    '-v',
    'error',
    '-count_frames',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    videoPath,
  ]);
  const audio = ffprobeJson([
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'json',
    videoPath,
  ]);
  const stream = video.streams?.[0] ?? {};
  return {
    audioCodec: audio.streams?.[0]?.codec_name ?? null,
    avgFrameRate: stream.avg_frame_rate ?? null,
    codec: stream.codec_name ?? null,
    durationSeconds: video.format?.duration !== undefined ? Number(video.format.duration) : null,
    frameCount: stream.nb_read_frames !== undefined ? Number(stream.nb_read_frames) : null,
    height: stream.height ?? null,
    rFrameRate: stream.r_frame_rate ?? null,
    width: stream.width ?? null,
  };
}

/**
 * Two identical full-clip runs at one rate through the REAL headless browser + WebGPU compositor, with
 * selected-frame and decoded-audio hashes and the wall-clock/per-frame cost of the production lane. This is
 * the todo-28 sustained criterion: the browser lane itself must beat realtime, not the synthetic pipeline.
 */
async function runBrowserBenchmarkRate(handle, { csv, fps, seconds, timeoutMs }) {
  const expectedFrames = Math.ceil(seconds * fps);
  const picks = [...new Set([0, 1, expectedFrames - 1, Math.floor(expectedFrames / 2)])];
  const runs = [];
  const hashes = [];
  const audioHashes = [];
  for (let run = 1; run <= 2; run += 1) {
    const id = await startExport(handle.origin, { csv, filename: 'flight_perf.csv', fps, pakBase: '/map-pak' });
    const job = await waitForExport(handle.origin, id, timeoutMs);
    if (job.state !== 'ready')
      throw new Error(`browser benchmark ${fps} fps run ${run} ended '${job.state}': ${job.message}`);
    const output = path.join(tmpdir(), 'GTASA-StuntTools-video-exports', `${id}.mp4`);
    const probe = probeVideo(output);
    const hash = hashSelectedFrames(output, picks);
    const audioHash = hashAudioStream(output);
    hashes.push(hash);
    audioHashes.push(audioHash.hash);
    const renderMs = job.readyAt !== null && job.renderStartedAt !== null ? job.readyAt - job.renderStartedAt : null;
    const wallMs = job.readyAt !== null && job.createdAt !== null ? job.readyAt - job.createdAt : null;
    const perFrameMs = renderMs !== null ? renderMs / expectedFrames : null;
    const durationError = probe.durationSeconds === null ? null : Math.abs(probe.durationSeconds - seconds);
    const record = {
      adapter: job.encoderInitEvidence?.adapter ?? null,
      audioBytes: audioHash.bytes,
      audioCodec: probe.audioCodec,
      audioHash: audioHash.hash,
      avgFrameRate: probe.avgFrameRate,
      budgetMs: 1000 / fps,
      checks: {
        audio: probe.audioCodec === 'aac',
        // Exact cadence: the copy-mux must pin an INPUT `-r` before `-i`, otherwise FFmpeg derives a
        // non-integer tick from the H.264 VUI and avg_frame_rate drifts off 60/1 (measured 1024000/17067).
        cadence:
          Array.isArray(job.encoderArgs) &&
          job.encoderArgs.indexOf('-r') !== -1 &&
          job.encoderArgs.indexOf('-i') !== -1 &&
          job.encoderArgs.indexOf('-r') < job.encoderArgs.indexOf('-i'),
        chunks: (job.frameStream?.chunks ?? 0) > 0,
        copyMux:
          Array.isArray(job.encoderArgs) && job.encoderArgs.includes('copy') && !job.encoderArgs.includes('h264_qsv'),
        duration: durationError !== null && durationError <= 1 / fps + 1e-6,
        encodedInput: job.frameStream?.inputFormat === 'h264',
        frameCount: probe.frameCount === expectedFrames,
        hardware: browserHardwareOk(job),
        inPage: job.videoEncode?.mode === 'in-page-hardware',
        noFallback: job.videoEncode?.fallback !== true,
        noPng: job.frameStream?.pngSignatureSeen === false,
        rate: probe.avgFrameRate === `${fps}/1` && probe.rFrameRate === `${fps}/1`,
      },
      compositor: job.compositor ?? null,
      durationError,
      durationSeconds: probe.durationSeconds,
      encoderArgs: job.encoderArgs ?? null,
      encoderInitEvidence: job.encoderInitEvidence ?? null,
      frameCount: probe.frameCount,
      frameStream: job.frameStream ?? null,
      hardwareEncoder: job.hardwareEncoder,
      id,
      perFrameMs,
      renderMs,
      rFrameRate: probe.rFrameRate,
      run,
      selectedFrameHash: hash,
      selectedFramePicks: picks,
      sustained: perFrameMs !== null && perFrameMs < 1000 / fps,
      videoEncode: job.videoEncode ?? null,
      wallMs,
    };
    runs.push(record);
    rmSync(output, { force: true });
    const failed = Object.entries(record.checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    console.log(
      `[browser ${fps}fps run${run}] wall=${wallMs}ms render=${renderMs}ms perFrame=${perFrameMs?.toFixed(2)}ms ` +
        `avg=${probe.avgFrameRate} frames=${probe.frameCount}/${expectedFrames} hw=${job.hardwareEncoder} ` +
        `mode=${job.videoEncode?.mode ?? 'n/a'} fallback=${job.videoEncode?.fallback ?? 'n/a'} adapter="${record.adapter ?? 'n/a'}" ` +
        `hash=${hash.slice(0, 16)} audioHash=${audioHash.hash.slice(0, 16)} failed=${failed.length ? failed.join(',') : 'none'}`,
    );
  }
  const hashMatch = hashes[0] === hashes[1];
  const audioHashMatch = audioHashes[0] === audioHashes[1];
  const first = runs[0];
  return {
    adapter: first.adapter,
    audioCodec: first.audioCodec,
    audioHashes,
    audioHashMatch,
    avgFrameRate: first.avgFrameRate,
    budgetMs: 1000 / fps,
    clipSeconds: seconds,
    compositor: first.compositor,
    durationSeconds: first.durationSeconds,
    encoderArgs: first.encoderArgs,
    encoderInitEvidence: first.encoderInitEvidence,
    expectedFrames,
    fps,
    frameCount: first.frameCount,
    hardwareEncoder: first.hardwareEncoder,
    hashMatch,
    perFrameMs: first.perFrameMs,
    renderMs: first.renderMs,
    runs,
    selectedFrameHashes: hashes,
    selectedFramePicks: picks,
    sustained: first.sustained,
    videoEncode: first.videoEncode,
    wallMs: first.wallMs,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Pipeline lane: the real exporter driven in-process with a deterministic raw-frame source.
// ---------------------------------------------------------------------------------------------------------

function runCapture(command, args, timeoutMs) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${command} failed: ${result.error.message}`);
  return result;
}

async function startBrowserLane({ recordingsDir }) {
  const chrome = CHROME_PATHS.find((candidate) => candidate && existsSync(candidate)) ?? null;
  if (!chrome) return { skipped: 'Chrome or Edge was not found' };
  if (!existsSync(path.join(MAP_PAK_DIR, 'index.json'))) return { skipped: 'map pak is missing (run bake-map.mts)' };
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: WEB_REPLAY_DIR,
    env: { ...process.env, NO_OPEN: '1', PORT: String(port), RECORDINGS_ROOT: recordingsDir },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  child.stdout.on('data', (chunk) => {
    log = (log + chunk.toString()).slice(-4000);
  });
  child.stderr.on('data', (chunk) => {
    log = (log + chunk.toString()).slice(-4000);
  });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`local server exited (${child.exitCode}): ${log}`);
    try {
      const response = await fetch(`${origin}/opensa/flight-replay.html`);
      if (response.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`local server did not become ready: ${log}`);
    await sleep(250);
  }
  return { child, chrome, origin };
}

async function startExport(origin, body) {
  const response = await fetch(`${origin}/video-export`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: origin },
    method: 'POST',
  });
  const text = await response.text();
  if (response.status !== 202) throw new Error(`export start failed: ${response.status} ${text}`);
  return JSON.parse(text).id;
}

async function startPipelineLane({ outputRoot, recordingsRoot }) {
  const state = { audioWav: null, duration: 0, fps: 60, frameDelayMs: 0, rendererOptions: null, times: [] };
  const rendererFactory = async (options) => {
    state.times = [];
    state.rendererOptions = options;
    const { audioWav, duration, fps } = state;
    return {
      audioWav,
      async close() {},
      compositor: {
        backend: 'deterministic-raw-frames',
        height: HEIGHT,
        pixelFormat: 'rgba',
        visible: false,
        width: WIDTH,
      },
      duration,
      async frameAt(seconds) {
        if (state.frameDelayMs > 0) await sleep(state.frameDelayMs);
        state.times.push(seconds);
        return frameAtTime(seconds, fps);
      },
    };
  };
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const exporter = createVideoExporter({
    chromiumPath: null,
    ffmpegExecutable: FFMPEG,
    opensaRoot: OPENSA_ROOT,
    origin,
    outputRoot,
    recordingsRoot,
    rendererFactory,
  });
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, origin).pathname;
      if (await exporter.handle(req, res, pathname)) return;
      res.writeHead(404);
      res.end();
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { close: () => new Promise((resolve) => server.close(resolve)), origin, server, state };
}

async function waitForExport(origin, id, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const job = await (await fetch(`${origin}/video-export/${id}`)).json();
    if (['cancelled', 'failed', 'ready'].includes(job.state)) return job;
    if (Date.now() - started > timeoutMs) {
      await fetch(`${origin}/video-export/${id}/cancel`, { headers: { Origin: origin }, method: 'POST' }).catch(
        () => {},
      );
      throw new Error(
        `export ${id} exceeded ${timeoutMs}ms (state ${job.state}, frame ${job.frame}/${job.totalFrames})`,
      );
    }
    await sleep(200);
  }
}

/** Wait until a file exists with bytes; returns its size (0 when it never appeared before the deadline). */
async function waitForPartialOutput(file, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const bytes = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    if (bytes > 0 || Date.now() - started > timeoutMs) return bytes;
    await sleep(25);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Browser lane: the real headless Chrome + WebGPU compositor through the repo's local server.
// ---------------------------------------------------------------------------------------------------------

async function waitForState(origin, id, wanted, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const job = await (await fetch(`${origin}/video-export/${id}`)).json();
    if (job.state === wanted || ['cancelled', 'failed', 'ready'].includes(job.state)) return job;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `export ${id} did not reach '${wanted}' within ${timeoutMs}ms (state ${job.state}, frame ${job.frame}/${job.totalFrames})`,
      );
    }
    await sleep(25);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Todo-26 probes: fast 30 fps acceptance and cancel/reap on the primary (no-browser) path.
// ---------------------------------------------------------------------------------------------------------

const PROBE_CSV = '# probe fixture\nlocal_timestamp,\n2026-01-01T00:00:00.000,\n';

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status !== 0) {
    console.error('ffmpeg is required on PATH (or FFMPEG_PATH)');
    process.exit(1);
  }
  if (spawnSync(FFPROBE, ['-version'], { stdio: 'ignore' }).status !== 0) {
    console.error('ffprobe is required on PATH (or FFPROBE_PATH)');
    process.exit(1);
  }

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  buildFramePool();
  const tempDir = path.join(tmpdir(), `stunt-export-perf-${Date.now()}`);
  const recordingsDir = path.join(tempDir, 'recordings');
  const outputRoot = path.join(tempDir, 'exports');
  mkdirSync(recordingsDir, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path.join(recordingsDir, 'flight_perf.wav'), buildWav(opts.seconds));

  const clipMs = opts.seconds * 1000;
  const failures = [];
  const degradedContract = [];
  const notes = [
    'Pipeline lane feeds deterministic RAW RGBA 1920x1080 frames (the compositor contract) through the real web-replay/video-export.mjs; the exporter requests one frame per 1/fps and QSV-encodes with the G2 oneVPL chain.',
    'Hardware proof is the encoder-INIT log (Intel adapter line + oneVPL/MFX session), parsed from FFmpeg verbose stderr - never a codec name.',
    'Selected-frame hashes are over the concatenated RAW RGBA bytes of decoded output frames at fixed indices.',
    'Decoded-audio determinism: the AAC stream of each run is decoded to s16le PCM and hashed; two runs at the same rate must hash equal.',
    'Primary path (no browser): the pipeline renderer factory receives visible=false and executablePath=null, so no browser process exists on the timed lane; the real headless browser lane is a separate bounded sanity lane and never the sustained criterion.',
    'Cancel probe: the partial MP4 is observed on disk (bytes > 0 and equal to the encoder output argument) BEFORE cancel, then must be deleted with encoderExited=true, and a fresh 30 fps export must succeed afterwards.',
    'Browser lane is EXPECTED to be degraded on this host as documented by task-25 (compositor 160.8 ms/frame at 60 fps vs a 16.7 ms budget; 149.3 ms/frame at 120 fps vs an 8.3 ms budget). Recorded in degradedContract, never hidden; the pipeline lane carries the sustained criterion.',
  ];

  const rates = [];
  let browserLane = null;
  let fastAcceptance = null;
  let cancelProbe = null;
  if (opts.lane !== 'browser') {
    console.log(
      `pipeline lane: ${opts.seconds}s fixture at ${opts.fps.join('/')} fps, 2 runs each (raw frames -> FFmpeg QSV)`,
    );
    const lane = await startPipelineLane({ outputRoot, recordingsRoot: recordingsDir });
    try {
      if (opts.lane === 'all') {
        // Todo-26: the default 30 fps path and the cancel/reap contract, on the primary no-browser lane.
        fastAcceptance = await runFastAcceptanceProbe(lane, { outputRoot });
        const failedAcceptance = Object.entries(fastAcceptance.checks)
          .filter(([, ok]) => !ok)
          .map(([name]) => name);
        console.log(
          `[fast ${fastAcceptance.fps}fps] state=${fastAcceptance.state} avg=${fastAcceptance.avgFrameRate} ` +
            `frames=${fastAcceptance.frameCount}/${fastAcceptance.expectedFrames} audio=${fastAcceptance.audioCodec} ` +
            `pngSignatureSeen=${fastAcceptance.pngSignatureSeen} backend="${fastAcceptance.compositor?.backend ?? 'n/a'}" ` +
            `rendererVisible=${fastAcceptance.rendererVisible} rendererExecutable=${fastAcceptance.rendererExecutablePath === null ? 'null' : fastAcceptance.rendererExecutablePath} ` +
            `hw=${fastAcceptance.hardwareEncoder} adapter="${fastAcceptance.adapter ?? 'n/a'}"`,
        );
        if (failedAcceptance.length) {
          failures.push(
            `fast ${fastAcceptance.fps} fps acceptance: failed ${failedAcceptance.join(', ')} ` +
              `(state=${fastAcceptance.state}, avg=${fastAcceptance.avgFrameRate}, frames=${fastAcceptance.frameCount}/${fastAcceptance.expectedFrames}, message=${fastAcceptance.message})`,
          );
        }

        cancelProbe = await runCancelProbe(lane, { outputRoot });
        const failedCancel = Object.entries(cancelProbe.checks)
          .filter(([, ok]) => !ok)
          .map(([name]) => name);
        console.log(
          `[cancel probe] state=${cancelProbe.state} frame=${cancelProbe.frame}/${cancelProbe.totalFrames} ` +
            `partialBytes=${cancelProbe.partialBytesBeforeCancel} outputArgTied=${cancelProbe.outputArgMatchesPartial} ` +
            `encoderExited=${cancelProbe.encoderExited} outputDeleted=${cancelProbe.outputDeleted} rerun=${cancelProbe.rerunState}`,
        );
        if (failedCancel.length) {
          failures.push(
            `cancel probe: failed ${failedCancel.join(', ')} (state=${cancelProbe.state}, partialBytes=${cancelProbe.partialBytesBeforeCancel}, ` +
              `outputArgTied=${cancelProbe.outputArgMatchesPartial}, encoderExited=${cancelProbe.encoderExited}, outputDeleted=${cancelProbe.outputDeleted}, rerun=${cancelProbe.rerunState})`,
          );
        }
      }

      for (const fps of opts.fps) {
        const expectedFrames = Math.ceil(opts.seconds * fps);
        const picks = [...new Set([0, 1, expectedFrames - 1, Math.floor(expectedFrames / 2)])];
        const runs = [];
        const hashes = [];
        const audioHashes = [];
        for (let run = 1; run <= 2; run += 1) {
          lane.state.duration = opts.seconds;
          lane.state.fps = fps;
          lane.state.frameDelayMs = 0;
          lane.state.audioWav = buildWav(opts.seconds);
          const id = await startExport(lane.origin, {
            csv: '# pipeline fixture\nlocal_timestamp,\n2026-01-01T00:00:00.000,\n',
            filename: 'flight_perf.csv',
            fps,
            pakBase: '/map-pak',
          });
          const job = await waitForExport(lane.origin, id, opts.timeoutMs);
          if (job.state !== 'ready') throw new Error(`${fps} fps run ${run} ended '${job.state}': ${job.message}`);
          const output = path.join(outputRoot, `${id}.mp4`);
          const probe = probeVideo(output);
          const hash = hashSelectedFrames(output, picks);
          const audioHash = hashAudioStream(output);
          const times = lane.state.times.slice();
          const rendererOptions = lane.state.rendererOptions;
          hashes.push(hash);
          audioHashes.push(audioHash.hash);
          const evaluation = evaluateRun({ fps, job, picks, probe, rendererOptions, seconds: opts.seconds, times });
          const record = {
            adapter: job.encoderInitEvidence?.adapter ?? null,
            audioBytes: audioHash.bytes,
            audioHash: audioHash.hash,
            chain: evaluation.chain,
            checks: {
              adapter: evaluation.adapterReportedOk,
              audio: evaluation.audioOk,
              backend: evaluation.backendReportedOk,
              chain: evaluation.chainOk,
              compositorHidden: evaluation.compositorHiddenOk,
              duration: evaluation.durationOk,
              frameCount: evaluation.frameMatch,
              frameTimes: evaluation.timesMatch,
              hardware: evaluation.hardwareOk,
              noPng: evaluation.pngOk,
              pipeFrames: evaluation.pipeFramesOk,
              rate: evaluation.rateMatch,
              rawPipe: evaluation.rawPipeOk,
              rendererHidden: evaluation.rendererHiddenOk,
            },
            compositor: job.compositor ?? null,
            encoderArgs: job.encoderArgs,
            encoderInitEvidence: job.encoderInitEvidence,
            ffprobe: probe,
            frameStreamFrames: job.frameStream?.frames ?? null,
            hardwareEncoder: job.hardwareEncoder,
            id,
            pngSignatureSeen: job.frameStream?.pngSignatureSeen ?? null,
            rendererOptions: {
              executablePath: rendererOptions?.executablePath ?? null,
              visible: rendererOptions?.visible ?? null,
            },
            renderMs: job.readyAt !== null && job.renderStartedAt !== null ? job.readyAt - job.renderStartedAt : null,
            requestedFrameTimesMatch: evaluation.timesMatch,
            run,
            selectedFrameHash: hash,
            selectedFramePicks: picks,
            wallMs: job.readyAt !== null && job.createdAt !== null ? job.readyAt - job.createdAt : null,
          };
          runs.push(record);
          console.log(
            `[pipeline ${fps}fps run${run}] wall=${record.wallMs}ms render=${record.renderMs}ms ` +
              `avg_frame_rate=${probe.avgFrameRate} frames=${probe.frameCount}/${expectedFrames} durErr=${evaluation.durationError}s ` +
              `hw=${job.hardwareEncoder} adapter="${record.adapter ?? 'n/a'}" audio=${probe.audioCodec} noPng=${evaluation.pngOk} chain=${evaluation.chainOk} ` +
              `backend="${job.compositor?.backend ?? 'n/a'}" visible=${job.compositor?.visible} ` +
              `audioHash=${audioHash.hash.slice(0, 16)} hash=${hash.slice(0, 16)}`,
          );
          const failed = Object.entries(record.checks)
            .filter(([, ok]) => !ok)
            .map(([name]) => name);
          if (failed.length)
            failures.push(
              `${fps} fps run ${run}: failed ${failed.join(', ')} (avg=${probe.avgFrameRate}, frames=${probe.frameCount}/${expectedFrames}, durErr=${evaluation.durationError}, audio=${probe.audioCodec})`,
            );
          rmSync(output, { force: true });
        }
        const hashMatch = hashes[0] === hashes[1];
        if (!hashMatch)
          failures.push(`${fps} fps: two runs produced different selected-frame hashes (${hashes[0]} vs ${hashes[1]})`);
        const audioHashMatch = audioHashes[0] === audioHashes[1];
        if (!audioHashMatch)
          failures.push(
            `${fps} fps: two runs produced different decoded-audio hashes (${audioHashes[0]} vs ${audioHashes[1]})`,
          );
        const first = runs[0];
        const sustained = first.wallMs !== null && first.wallMs < clipMs;
        if (!sustained) {
          degradedContract.push({
            clipMs,
            fps,
            lane: 'pipeline',
            reason: 'wall-clock not below the clip duration over the full clip',
            renderMs: first.renderMs,
            wallMs: first.wallMs,
          });
          console.log(
            `DEGRADED: pipeline ${fps} fps - wall=${first.wallMs}ms >= clip=${clipMs}ms. Documented, not silently downgraded.`,
          );
        } else {
          console.log(
            `[pipeline ${fps}fps] SUSTAINED wall=${first.wallMs}ms < clip=${clipMs}ms; hashMatch=${hashMatch} audioHashMatch=${audioHashMatch}`,
          );
        }
        rates.push({
          adapter: first.adapter,
          audioCodec: first.ffprobe.audioCodec,
          audioHashes,
          audioHashMatch,
          avgFrameRate: first.ffprobe.avgFrameRate,
          clipSeconds: opts.seconds,
          compositorBackend: first.compositor?.backend ?? null,
          compositorVisible: first.compositor?.visible ?? null,
          durationSeconds: first.ffprobe.durationSeconds,
          expectedFrames,
          fps,
          frameCount: first.ffprobe.frameCount,
          hardwareEncoder: first.hardwareEncoder,
          hashMatch,
          rendererExecutablePath: first.rendererOptions.executablePath,
          rendererVisible: first.rendererOptions.visible,
          runs,
          selectedFrameHashes: hashes,
          selectedFramePicks: picks,
          sustained,
        });
      }
    } finally {
      await lane.close().catch(() => {});
    }
  }

  // Bounded browser lane: prove the real headless compositor honors the target rate, and record its cost.
  if (opts.browser && opts.lane === 'all') {
    const csv = buildFixtureCsv(BROWSER_LANE_SECONDS);
    writeFileSync(path.join(recordingsDir, 'flight_perf.csv'), csv);
    writeFileSync(path.join(recordingsDir, 'flight_perf.wav'), buildWav(BROWSER_LANE_SECONDS));
    let browserHandle = null;
    try {
      browserHandle = await startBrowserLane({ recordingsDir });
      if (browserHandle.skipped) {
        browserLane = { skipped: browserHandle.skipped };
        notes.push(`browser lane skipped: ${browserHandle.skipped}`);
        console.log(`browser lane skipped: ${browserHandle.skipped}`);
      } else {
        browserLane = { rates: [] };
        for (const fps of opts.fps) {
          const expectedFrames = Math.ceil(BROWSER_LANE_SECONDS * fps);
          const id = await startExport(browserHandle.origin, {
            csv,
            filename: 'flight_perf.csv',
            fps,
            pakBase: '/map-pak',
          });
          const job = await waitForExport(browserHandle.origin, id, opts.timeoutMs);
          if (job.state !== 'ready') throw new Error(`browser lane ${fps} fps ended '${job.state}': ${job.message}`);
          const output = path.join(tmpdir(), 'GTASA-StuntTools-video-exports', `${id}.mp4`);
          const probe = probeVideo(output);
          const perFrameMs =
            job.renderStartedAt !== null && job.readyAt !== null
              ? (job.readyAt - job.renderStartedAt) / expectedFrames
              : null;
          const entry = {
            adapter: job.encoderInitEvidence?.adapter ?? null,
            avgFrameRate: probe.avgFrameRate,
            budgetMs: 1000 / fps,
            checks: {
              frameCount: probe.frameCount === expectedFrames,
              hardware: job.hardwareEncoder === true,
              rate: probe.avgFrameRate === `${fps}/1`,
            },
            expectedFrames,
            fps,
            frameCount: probe.frameCount,
            hardwareEncoder: job.hardwareEncoder,
            perFrameMs,
            sustained: perFrameMs !== null && perFrameMs < 1000 / fps,
          };
          browserLane.rates.push(entry);
          rmSync(output, { force: true });
          console.log(
            `[browser ${fps}fps] avg_frame_rate=${probe.avgFrameRate} frames=${probe.frameCount}/${expectedFrames} hw=${job.hardwareEncoder} adapter="${entry.adapter ?? 'n/a'}" perFrame=${perFrameMs?.toFixed(1)}ms`,
          );
          const failed = Object.entries(entry.checks)
            .filter(([, ok]) => !ok)
            .map(([name]) => name);
          if (failed.length)
            failures.push(
              `browser lane ${fps} fps: failed ${failed.join(', ')} (avg=${probe.avgFrameRate}, frames=${probe.frameCount}/${expectedFrames})`,
            );
          if (!entry.sustained) {
            degradedContract.push({
              budgetMs: 1000 / fps,
              fps,
              lane: 'browser',
              perFrameMs,
              reason: `compositor per-frame cost ${perFrameMs?.toFixed(1)}ms exceeds the ${(1000 / fps).toFixed(1)}ms budget; a full-clip browser export cannot sustain realtime`,
            });
            console.log(
              `DEGRADED: browser ${fps} fps - ${perFrameMs?.toFixed(1)}ms/frame > ${(1000 / fps).toFixed(1)}ms/frame budget. Documented, not silently downgraded.`,
            );
          }
        }
      }
    } catch (error) {
      browserLane = { error: error instanceof Error ? error.message : String(error) };
      notes.push(`browser lane error: ${browserLane.error}`);
      console.log(`browser lane error (recorded): ${browserLane.error}`);
    } finally {
      if (browserHandle) killTree(browserHandle.child);
    }
  }

  // Todo-28 browser benchmark: the PRODUCTION (real page) lane over the full clip, 2 runs per rate. The
  // in-page WebCodecs hardware encoder hands Node only encoded chunks, so this lane must now beat realtime.
  if (opts.lane === 'browser') {
    const csv = buildFixtureCsv(opts.seconds);
    writeFileSync(path.join(recordingsDir, 'flight_perf.csv'), csv);
    writeFileSync(path.join(recordingsDir, 'flight_perf.wav'), buildWav(opts.seconds));
    let browserHandle = null;
    try {
      browserHandle = await startBrowserLane({ recordingsDir });
      if (browserHandle.skipped) {
        browserLane = { lane: 'browser', skipped: browserHandle.skipped };
        notes.push(`browser lane skipped: ${browserHandle.skipped}`);
        failures.push(`browser benchmark skipped: ${browserHandle.skipped}`);
        console.log(`browser lane skipped: ${browserHandle.skipped}`);
      } else {
        browserLane = { lane: 'browser', rates: [], seconds: opts.seconds };
        for (const fps of opts.fps) {
          const rate = await runBrowserBenchmarkRate(browserHandle, {
            csv,
            fps,
            seconds: opts.seconds,
            timeoutMs: opts.timeoutMs,
          });
          browserLane.rates.push(rate);
          const failed = Object.entries(rate.runs[0].checks)
            .filter(([, ok]) => !ok)
            .map(([name]) => name);
          if (failed.length) {
            failures.push(
              `browser benchmark ${fps} fps: failed ${failed.join(', ')} (avg=${rate.avgFrameRate}, frames=${rate.frameCount}/${rate.expectedFrames}, ` +
                `mode=${rate.videoEncode?.mode}, fallback=${rate.videoEncode?.fallback}, reason=${rate.videoEncode?.fallbackReason ?? 'none'})`,
            );
          }
          if (!rate.hashMatch)
            failures.push(
              `browser benchmark ${fps} fps: two runs produced different selected-frame hashes (${rate.selectedFrameHashes[0]} vs ${rate.selectedFrameHashes[1]})`,
            );
          if (!rate.audioHashMatch)
            failures.push(`browser benchmark ${fps} fps: two runs produced different decoded-audio hashes`);
          if (!rate.sustained) {
            degradedContract.push({
              budgetMs: 1000 / fps,
              fps,
              lane: 'browser',
              perFrameMs: rate.perFrameMs,
              reason: `production browser lane ${rate.perFrameMs?.toFixed(2)}ms/frame exceeds the ${(1000 / fps).toFixed(2)}ms budget; the in-page encode must beat realtime`,
            });
            failures.push(
              `browser benchmark ${fps} fps: NOT sustained (${rate.perFrameMs?.toFixed(2)}ms/frame vs ${(1000 / fps).toFixed(2)}ms budget, wall=${rate.wallMs}ms, clip=${opts.seconds * 1000}ms)`,
            );
            console.log(
              `DEGRADED: browser ${fps} fps - ${rate.perFrameMs?.toFixed(2)}ms/frame > ${(1000 / fps).toFixed(2)}ms/frame budget. Recorded, not silently downgraded.`,
            );
          } else {
            console.log(
              `[browser ${fps}fps] SUSTAINED render=${rate.renderMs}ms < clip=${opts.seconds * 1000}ms; hashMatch=${rate.hashMatch} audioHashMatch=${rate.audioHashMatch} hash=${rate.selectedFrameHashes[0].slice(0, 16)}`,
            );
          }
        }
      }
    } catch (error) {
      browserLane = { error: error instanceof Error ? error.message : String(error), lane: 'browser' };
      notes.push(`browser lane error: ${browserLane.error}`);
      failures.push(`browser benchmark error: ${browserLane.error}`);
      console.log(`browser lane error (recorded): ${browserLane.error}`);
    } finally {
      if (browserHandle) killTree(browserHandle.child);
    }
  }

  if (opts.strictSustained && degradedContract.length > 0) {
    failures.push(
      `--strict-sustained: ${degradedContract.map((entry) => `${entry.lane}/${entry.fps}fps`).join(', ')} did not sustain`,
    );
  }

  const evidencePath = opts.evidence ?? (opts.lane === 'browser' ? EVIDENCE_TASK28 : EVIDENCE_JSON);
  const sustainedSummary =
    opts.lane === 'browser'
      ? (browserLane?.rates ?? []).map((rate) => ({
          fps: rate.fps,
          lane: 'browser',
          perFrameMs: rate.perFrameMs,
          renderMs: rate.renderMs,
          sustained: rate.sustained,
          wallMs: rate.wallMs,
        }))
      : rates.map((rate) => ({
          fps: rate.fps,
          lane: 'pipeline',
          sustained: rate.sustained,
          wallMs: rate.runs[0]?.wallMs ?? null,
        }));
  const artifact = {
    browserLane,
    cancelProbe,
    command: `node scripts/test-export-perf.mjs --fps ${opts.fps.join(',')} --seconds ${opts.seconds} --lane ${opts.lane}`,
    degradedContract,
    degradedContractBaseline: {
      contract:
        opts.lane === 'browser'
          ? 'task-28 removes the per-frame raw CDP transfer by encoding in-page (WebCodecs hardware H.264); the production browser lane must now beat realtime. task-25 recorded the pre-fix browser lane as degraded (160.8 ms/frame at 60 fps, 149.3 ms/frame at 120 fps).'
          : 'the real browser compositor cannot sustain realtime on this host; the pipeline lane carries the sustained criterion, the browser lane is recorded as degraded, never silently downgraded',
      rates: T25_BROWSER_DEGRADED,
      source: 'task-25 (.omo/evidence/task-25-flight-analysis-remediation-and-worktree-cleanup.json)',
    },
    fastAcceptance,
    ffmpeg: runCapture(FFMPEG, ['-version'], 20_000).stdout.split(/\r?\n/)[0] ?? null,
    ffprobe: runCapture(FFPROBE, ['-version'], 20_000).stdout.split(/\r?\n/)[0] ?? null,
    fixture: {
      audio: 'synthesized 220 Hz WAV, -t frames/fps',
      height: HEIGHT,
      lane: opts.lane === 'browser' ? 'browser-in-page-encode' : 'pipeline',
      pixelFormat: opts.lane === 'browser' ? 'webcodecs-h264-annexb' : 'rgba',
      seconds: opts.seconds,
      uniqueFrames: FRAME_POOL.length,
      width: WIDTH,
    },
    generatedAt: new Date().toISOString(),
    host: {
      chrome: CHROME_PATHS.find((candidate) => candidate && existsSync(candidate)) ?? null,
      cpu: os.cpus()?.[0]?.model ?? null,
      cpuCount: os.cpus()?.length ?? null,
      node: process.version,
      platform: process.platform,
      release: os.release(),
    },
    notes,
    rates,
    supportedFps: SUPPORTED_FPS,
    sustainedSummary,
    task: opts.lane === 'browser' ? 'task-28' : 'task-26',
    title:
      opts.lane === 'browser'
        ? 'Production browser-backed export beats realtime via in-page WebCodecs hardware encode (no per-frame raw CDP transfer)'
        : '30/60/120 fps export acceptance: hardware encode, no-browser primary path, cancel/reap, audio determinism',
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
  };
  writeFileSync(evidencePath, `${JSON.stringify(artifact, null, 2)}\n`);
  if (!opts.keep) rmSync(tempDir, { force: true, recursive: true });

  console.log(`evidence: ${evidencePath}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exit(1);
  }
  if (opts.lane === 'browser') {
    console.log(
      `PASS(browser): ${(browserLane?.rates ?? []).map((rate) => `${rate.fps}fps avg=${rate.avgFrameRate} frames=${rate.frameCount} sustained=${rate.sustained} perFrame=${rate.perFrameMs?.toFixed(2)}ms hashMatch=${rate.hashMatch} audioHashMatch=${rate.audioHashMatch} mode=${rate.videoEncode?.mode}`).join(' | ')}`,
    );
  } else {
    console.log(
      `PASS: ${rates.map((rate) => `${rate.fps}fps avg=${rate.avgFrameRate} frames=${rate.frameCount} sustained=${rate.sustained} hashMatch=${rate.hashMatch} audioHashMatch=${rate.audioHashMatch}`).join(' | ')}`,
    );
  }
  if (degradedContract.length > 0)
    console.log(
      `documented degraded contract: ${degradedContract.map((entry) => `${entry.lane}/${entry.fps}`).join(', ')}`,
    );
}

function parseArgs(argv) {
  const opts = {
    browser: true,
    evidence: null,
    fps: [...DEFAULT_FPS],
    help: false,
    keep: false,
    lane: 'all',
    seconds: DEFAULT_SECONDS,
    strictSustained: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  const takeValue = (arg, index) => {
    const eq = arg.indexOf('=');
    if (eq !== -1) return { next: index, value: arg.slice(eq + 1) };
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    return { next: index + 1, value };
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '--keep') {
      opts.keep = true;
      continue;
    }
    if (arg === '--no-browser') {
      opts.browser = false;
      continue;
    }
    if (arg === '--strict-sustained') {
      opts.strictSustained = true;
      continue;
    }
    if (arg === '--lane' || arg.startsWith('--lane=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      if (!['all', 'browser', 'pipeline'].includes(value))
        throw new Error(`unknown lane: ${value} (expected all, browser or pipeline)`);
      opts.lane = value;
      continue;
    }
    if (arg === '--evidence' || arg.startsWith('--evidence=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      opts.evidence = path.resolve(value);
      continue;
    }
    if (arg === '--fps' || arg.startsWith('--fps=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      const rates = value.split(',').map((part) => Number(part.trim()));
      if (!rates.length || rates.some((rate) => !Number.isInteger(rate)))
        throw new Error(`invalid --fps value: ${value}`);
      for (const rate of rates) {
        // Coercion is not silent: an unsupported rate fails loudly by name.
        if (!SUPPORTED_FPS.includes(rate)) throw new Error(`unsupported frame rate: ${rate}`);
      }
      opts.fps = rates;
      continue;
    }
    if (arg === '--seconds' || arg.startsWith('--seconds=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`invalid --seconds value: ${value}`);
      opts.seconds = seconds;
      continue;
    }
    if (arg === '--timeout' || arg.startsWith('--timeout=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`invalid --timeout value: ${value}`);
      opts.timeoutMs = Math.round(seconds * 1000);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

// ---------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------

function printHelp() {
  console.log(`Todo 25/26 export performance / determinism harness. Always runs a 1 s 30 fps fast acceptance probe and a cancel/reap probe first.

Usage: node scripts/test-export-perf.mjs [options]

  --fps=60,120        rates to benchmark (supported: ${SUPPORTED_FPS.join(', ')}; default 60,120)
  --seconds=60        pipeline fixture clip length in seconds (default 60)
  --timeout=300       per-export wall-clock bound in seconds, then cancel + fail (default 300)
  --lane=all          all: fast acceptance + cancel + pipeline + bounded browser sanity (default)
                      browser: ONLY the real browser lane, full --seconds clip, 2 runs, sustained required
                      pipeline: ONLY the synthetic raw-frame pipeline lane
  --evidence=PATH     write the JSON evidence to PATH (default: task-26 for all/pipeline, task-28 for browser)
  --no-browser        skip the bounded real-browser sanity lane
  --strict-sustained  a rate above the clip duration becomes a non-zero exit instead of a documented degradation
  --keep              keep the temp outputs (default: delete)
  --help              show this text

Exit codes: 0 = assertions held (degradations are recorded loudly); 1 = an assertion failed; 2 = bad arguments.`);
}

/**
 * Interrupt a slow 30 fps export mid-run. The partial MP4 must have been on disk with bytes and be the
 * encoder's output argument; cancel must delete it, reap the FFmpeg child, and leave a fresh export working
 * (no stale lock, no orphaned process).
 */
async function runCancelProbe(lane, { outputRoot }) {
  const fps = CANCEL_PROBE_FPS;
  const seconds = CANCEL_PROBE_SECONDS;
  const expectedFrames = Math.ceil(seconds * fps);
  lane.state.duration = seconds;
  lane.state.fps = fps;
  lane.state.frameDelayMs = CANCEL_PROBE_FRAME_DELAY_MS;
  lane.state.audioWav = buildWav(seconds);
  const id = await startExport(lane.origin, {
    csv: PROBE_CSV,
    filename: 'flight_cancel_probe.csv',
    fps,
    pakBase: '/map-pak',
  });
  const rendering = await waitForState(lane.origin, id, 'rendering', 30_000);
  const partialPath = path.join(outputRoot, `${id}.mp4`);
  const partialBytes = await waitForPartialOutput(partialPath, 10_000);
  const encoderArgs =
    (await (await fetch(`${lane.origin}/video-export/${id}`)).json()).encoderArgs ?? rendering.encoderArgs ?? null;
  const outputArgMatch =
    Array.isArray(encoderArgs) &&
    encoderArgs.length > 0 &&
    path.resolve(encoderArgs[encoderArgs.length - 1]) === path.resolve(partialPath);

  const cancel = await fetch(`${lane.origin}/video-export/${id}/cancel`, {
    headers: { Origin: lane.origin },
    method: 'POST',
  });
  const cancelled = await waitForExport(lane.origin, id, 30_000);
  const outputDeleted = !existsSync(partialPath);

  // Re-run after the interruption: the lock must be released and a fresh 30 fps export must succeed.
  lane.state.frameDelayMs = 0;
  const rerunId = await startExport(lane.origin, {
    csv: PROBE_CSV,
    filename: 'flight_after_cancel_probe.csv',
    fps,
    pakBase: '/map-pak',
  });
  const rerun = await waitForExport(lane.origin, rerunId, 60_000);
  const rerunOutput = path.join(outputRoot, `${rerunId}.mp4`);
  if (existsSync(rerunOutput)) rmSync(rerunOutput, { force: true });

  return {
    cancelStatus: cancel.status,
    checks: {
      cancelAccepted: cancel.status === 200,
      cancelled: cancelled.state === 'cancelled',
      encoderReaped: cancelled.encoderExited === true,
      outputArgTied: outputArgMatch,
      outputDeleted,
      partialExisted: partialBytes > 0,
      rerunReady: rerun.state === 'ready',
    },
    encoderExited: cancelled.encoderExited === true,
    expectedFrames,
    fps,
    frame: cancelled.frame ?? null,
    id,
    message: cancelled.message ?? null,
    outputArgMatchesPartial: outputArgMatch,
    outputDeleted,
    partialBytesBeforeCancel: partialBytes,
    rerunId,
    rerunState: rerun.state,
    seconds,
    state: cancelled.state,
    totalFrames: cancelled.totalFrames ?? null,
  };
}

/**
 * A 1 s clip at the default 30 fps, asserted with the same instrumentation as the sustained rates: rate,
 * frame count, duration, audio, hardware evidence, raw/PNG-free pipe, headless renderer and backend/encoder
 * reporting. This is the acceptance test that the 30 fps path still works; it is not the 60 s benchmark.
 */
async function runFastAcceptanceProbe(lane, { outputRoot }) {
  const fps = FAST_ACCEPTANCE_FPS;
  const seconds = FAST_ACCEPTANCE_SECONDS;
  const expectedFrames = Math.ceil(seconds * fps);
  lane.state.duration = seconds;
  lane.state.fps = fps;
  lane.state.frameDelayMs = 0;
  lane.state.audioWav = buildWav(seconds);
  const id = await startExport(lane.origin, {
    csv: PROBE_CSV,
    filename: 'flight_accept30.csv',
    fps,
    pakBase: '/map-pak',
  });
  const job = await waitForExport(lane.origin, id, 60_000);
  const output = path.join(outputRoot, `${id}.mp4`);
  const probe =
    job.state === 'ready' && existsSync(output)
      ? probeVideo(output)
      : { audioCodec: null, avgFrameRate: null, durationSeconds: null, frameCount: null, rFrameRate: null };
  const evaluation = evaluateRun({
    fps,
    job,
    picks: [0, expectedFrames - 1],
    probe,
    rendererOptions: lane.state.rendererOptions,
    seconds,
    times: lane.state.times.slice(),
  });
  if (existsSync(output)) rmSync(output, { force: true });
  return {
    adapter: job.encoderInitEvidence?.adapter ?? null,
    audioCodec: probe.audioCodec,
    avgFrameRate: probe.avgFrameRate,
    checks: {
      adapter: evaluation.adapterReportedOk,
      audio: evaluation.audioOk,
      backend: evaluation.backendReportedOk,
      chain: evaluation.chainOk,
      compositorHidden: evaluation.compositorHiddenOk,
      duration: evaluation.durationOk,
      frameCount: evaluation.frameMatch,
      frameTimes: evaluation.timesMatch,
      hardware: evaluation.hardwareOk,
      noPng: evaluation.pngOk,
      pipeFrames: evaluation.pipeFramesOk,
      rate: evaluation.rateMatch,
      rawPipe: evaluation.rawPipeOk,
      ready: job.state === 'ready',
      rendererHidden: evaluation.rendererHiddenOk,
    },
    compositor: job.compositor ?? null,
    durationSeconds: probe.durationSeconds,
    encoderArgs: job.encoderArgs ?? null,
    expectedFrames,
    fps,
    frameCount: probe.frameCount,
    hardwareEncoder: job.hardwareEncoder ?? null,
    id,
    inputFormat: job.frameStream?.inputFormat ?? null,
    message: job.message ?? null,
    pixelFormat: job.frameStream?.pixelFormat ?? null,
    pngSignatureSeen: job.frameStream?.pngSignatureSeen ?? null,
    rendererExecutablePath: lane.state.rendererOptions?.executablePath ?? null,
    rendererVisible: lane.state.rendererOptions?.visible ?? null,
    seconds,
    state: job.state,
  };
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
});
