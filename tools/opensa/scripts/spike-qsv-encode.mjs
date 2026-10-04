#!/usr/bin/env node
/**
 * Feasibility gate G2 spike: can this host hardware-encode raw 1080p frames at 60 and 120 fps with Intel QSV?
 *
 * It feeds synthetic raw yuv420p frames over a pipe to FFmpeg using the required chain
 * (`-init_hw_device qsv=hw -filter_hw_device hw -vf "format=nv12,hwupload=extra_hw_frames=64,format=qsv"
 *  -c:v h264_qsv -fps_mode cfr -r <fps>`), then verifies the result with ffprobe and proves hardware
 * encoding from the encoder-init log (a codec name is NOT proof). Per rate it tries the required
 * chain first; if that chain fails on the host (a known oneVPL/Arc quirk makes `hwupload` reject
 * `extra_hw_frames=64`), it retries the same hardware chain with a smaller upload pool and records
 * both the failure stderr and the substituted args in the artifact. It never uses libx264 for the
 * GO path: the software fallback is only a NO-GO timing.
 *
 * Artifact: .omo/evidence/gate-G2-flight-analysis-remediation-and-worktree-cleanup.json
 * Usage: node scripts/spike-qsv-encode.mjs [--fps=60,120] [--seconds=10] [--device=hw]
 *                                          [--timeout=120] [--keep] [--help]
 *   --device=bogus forces the encoder-init failure path (verdict NO-GO, exit 0).
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const ARTIFACT_PATH = path.join(
  REPO_ROOT,
  '.omo',
  'evidence',
  'gate-G2-flight-analysis-remediation-and-worktree-cleanup.json',
);
const TEMP_DIR = path.join(os.tmpdir(), 'gtasa-g2-qsv-spike');

const WIDTH = 1920;
const HEIGHT = 1080;
const PIX_FMT = 'yuv420p';
const FRAME_BYTES = Math.round(WIDTH * HEIGHT * 1.5);
const UNIQUE_FRAMES = 8;
const DEFAULT_FPS = [60, 120];
const DEFAULT_SECONDS = 10;
const DEFAULT_DEVICE = 'hw';
const DEFAULT_TIMEOUT_MS = 120_000;
const REQUIRED_EXTRA_HW_FRAMES = 64;
const FALLBACK_EXTRA_HW_FRAMES = 32;
const MAX_STDERR = 512 * 1024;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function appendCapped(target, chunk) {
  const next = target + chunk.toString('utf8');
  return next.length > MAX_STDERR ? next.slice(-MAX_STDERR) : next;
}

function buildArtifact({
  durationMs,
  ffmpegInfo,
  ffprobeInfo,
  notes,
  opts,
  rates,
  softwareFallback,
  startedAt,
  tempInfo,
}) {
  const passes = rates.filter((rate) => rate.passed).map((rate) => rate.fps);
  const allPass = rates.length > 0 && rates.every((rate) => rate.passed);
  let qsvVerdict;
  if (allPass) qsvVerdict = 'GO';
  else if (passes.length > 0) qsvVerdict = 'PARTIAL';
  else qsvVerdict = 'NO-GO';
  return {
    cleanup: tempInfo,
    durationMs: Math.round(durationMs),
    ffmpeg: ffmpegInfo,
    ffprobe: ffprobeInfo,
    frames: {
      frameBytes: FRAME_BYTES,
      height: HEIGHT,
      pixFmt: PIX_FMT,
      synthetic: true,
      uniqueFrames: UNIQUE_FRAMES,
      width: WIDTH,
    },
    gate: 'G2',
    generatedAt: new Date().toISOString(),
    host: {
      cpu: os.cpus()?.[0]?.model ?? null,
      cpuCount: os.cpus()?.length ?? null,
      node: process.version,
      platform: process.platform,
      release: os.release(),
      totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    },
    notes,
    options: { device: opts.device, rates: opts.fps, seconds: opts.seconds, timeoutMs: opts.timeoutMs },
    predicate: {
      go: '1080p60 AND 1080p120 both hardware-encoded',
      noGo: 'no hardware encoder initializes (exact stderr plus software-fallback timing recorded)',
      partial: '1080p60 hardware-encoded, 1080p120 not',
      ratesPassed: passes,
      required:
        'h264_qsv initializes a hardware device (encoder-init log) and encodes 1080p at the sampled rates with exact ffprobe avg_frame_rate and frame counts',
    },
    qsvVerdict,
    rates,
    requiredCommand: {
      args: buildEncodeArgs({
        device: opts.device,
        extraHwFrames: REQUIRED_EXTRA_HW_FRAMES,
        fps: opts.fps[0],
        outPath: '<temp>',
        totalFrames: Math.round(opts.fps[0] * opts.seconds),
      }),
      filter: `format=nv12,hwupload=extra_hw_frames=${REQUIRED_EXTRA_HW_FRAMES},format=qsv`,
      note: 'required filter chain; per-rate attempts array shows the exact args actually run',
    },
    softwareFallback,
    startedAt,
    verdict: `QSV=${qsvVerdict}`,
  };
}

function buildEncodeArgs({ device, extraHwFrames, fps, outPath, totalFrames }) {
  const filter =
    extraHwFrames === null
      ? 'format=nv12,hwupload,format=qsv'
      : `format=nv12,hwupload=extra_hw_frames=${extraHwFrames},format=qsv`;
  return [
    '-hide_banner',
    '-loglevel',
    'verbose',
    '-init_hw_device',
    `qsv=${device}`,
    '-filter_hw_device',
    'hw',
    '-f',
    'rawvideo',
    '-pix_fmt',
    PIX_FMT,
    '-s',
    `${WIDTH}x${HEIGHT}`,
    '-framerate',
    String(fps),
    '-i',
    'pipe:0',
    '-vf',
    filter,
    '-c:v',
    'h264_qsv',
    '-fps_mode',
    'cfr',
    '-r',
    String(fps),
    '-frames:v',
    String(totalFrames),
    '-y',
    outPath,
  ];
}

function buildSoftwareArgs({ fps, outPath, totalFrames }) {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    PIX_FMT,
    '-s',
    `${WIDTH}x${HEIGHT}`,
    '-framerate',
    String(fps),
    '-i',
    'pipe:0',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-fps_mode',
    'cfr',
    '-r',
    String(fps),
    '-frames:v',
    String(totalFrames),
    '-y',
    outPath,
  ];
}

function buildSyntheticFrames() {
  const ySize = WIDTH * HEIGHT;
  const uvSize = (WIDTH * HEIGHT) / 4;
  const frames = [];
  for (let index = 0; index < UNIQUE_FRAMES; index++) {
    const buffer = Buffer.allocUnsafe(FRAME_BYTES);
    const luma = buffer.subarray(0, ySize);
    for (let row = 0; row < HEIGHT; row++) {
      luma.fill((row + index * 11) & 0xff, row * WIDTH, (row + 1) * WIDTH);
    }
    const blockX = Math.floor((index / UNIQUE_FRAMES) * (WIDTH - 240));
    for (let row = 240; row < 480; row++) {
      luma.fill(index % 2 === 0 ? 235 : 16, row * WIDTH + blockX, row * WIDTH + blockX + 240);
    }
    buffer.fill(96, ySize, ySize + uvSize);
    buffer.fill(160, ySize + uvSize, FRAME_BYTES);
    frames.push(buffer);
  }
  return frames;
}

/** Runs ffmpeg while piping the synthetic raw frames into stdin; resolves on process close. */
function encodeRawFrames({ args, frames, timeoutMs, totalFrames }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve({
        code: null,
        feedMs: 0,
        framesWritten: 0,
        spawnError: String(error),
        stderr: String(error),
        timedOut: false,
        wallMs: 0,
      });
      return;
    }
    const started = performance.now();
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let framesWritten = 0;
    let feedMs = 0;
    const timer = setTimeout(() => {
      timedOut = true;
      killChild(child);
    }, timeoutMs);
    const finish = (code, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, feedMs, framesWritten, spawnError, stderr, timedOut, wallMs: performance.now() - started });
    };
    child.stderr.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk);
    });
    child.stdin.on('error', () => {
      /* child exited early; handled by close */
    });
    child.once('error', (error) => finish(null, String(error)));
    child.once('close', (code) => finish(code, null));
    (async () => {
      const closed = once(child, 'close');
      const feedStarted = performance.now();
      try {
        for (let i = 0; i < totalFrames; i++) {
          if (child.exitCode !== null || child.signalCode !== null) break;
          if (!child.stdin.write(frames[i % frames.length])) {
            await Promise.race([once(child.stdin, 'drain'), closed]);
          }
          framesWritten++;
        }
        child.stdin.end();
      } catch {
        try {
          child.stdin.destroy();
        } catch {
          /* already closed */
        }
      } finally {
        feedMs = performance.now() - feedStarted;
      }
    })();
  });
}

function killChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }).unref();
    } catch {
      /* best effort */
    }
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}\n`);
    printHelp();
    process.exit(2);
  }
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const startedAt = new Date().toISOString();
  const started = performance.now();
  await fs.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });

  // Stale-state guard: everything from an earlier run is discarded before we start.
  await fs.rm(TEMP_DIR, { force: true, recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const ffmpegInfo = await readFfmpegVersion();
  const ffprobeInfo = await (async () => {
    const result = await spawnCapture(FFPROBE, ['-version'], 20_000);
    return {
      error: result.stderr.trim(),
      ok: result.code === 0,
      version: result.stdout.split(/\r?\n/)[0]?.trim() ?? '',
    };
  })();

  if (!ffmpegInfo.ok || !ffprobeInfo.ok) {
    const missing = !ffmpegInfo.ok ? FFMPEG : FFPROBE;
    const error = !ffmpegInfo.ok ? ffmpegInfo.error : ffprobeInfo.error;
    const artifact = buildArtifact({
      durationMs: performance.now() - started,
      ffmpegInfo,
      ffprobeInfo,
      notes: [`blocked: ${missing} not usable - ${error || 'no version output'}`],
      opts,
      rates: [],
      softwareFallback: null,
      startedAt,
      tempInfo: { filesRemoved: [], kept: false, removed: false, tempDir: TEMP_DIR },
    });
    artifact.verdict = 'QSV=NO-GO';
    artifact.qsvVerdict = 'NO-GO';
    artifact.blocked = { error: error || 'no version output', tool: missing };
    await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    console.error(`BLOCKED: ${missing} is not usable: ${error || 'no version output'}`);
    process.exit(1);
  }

  console.log(`G2 QSV spike`);
  console.log(`  ffmpeg        ${ffmpegInfo.version}`);
  console.log(`  rates         ${opts.fps.join(', ')} fps for ${opts.seconds}s`);
  console.log(`  device        qsv=${opts.device} -filter_hw_device hw`);

  const frames = buildSyntheticFrames();
  const rates = [];
  const notes = [];

  for (const fps of opts.fps) {
    const totalFrames = Math.round(fps * opts.seconds);
    const outPath = path.join(TEMP_DIR, `qsv-${fps}fps.mp4`);
    await fs.rm(outPath, { force: true });
    const attempts = [];
    const chains = [
      { chain: 'required', extraHwFrames: REQUIRED_EXTRA_HW_FRAMES },
      { chain: `fallback-extra-${FALLBACK_EXTRA_HW_FRAMES}`, extraHwFrames: FALLBACK_EXTRA_HW_FRAMES },
      { chain: 'fallback-default-pool', extraHwFrames: null },
    ];

    let winner = null;
    for (const chain of chains) {
      const args = buildEncodeArgs({
        device: opts.device,
        extraHwFrames: chain.extraHwFrames,
        fps,
        outPath,
        totalFrames,
      });
      const run = await encodeRawFrames({ args, frames, timeoutMs: opts.timeoutMs, totalFrames });
      const evidence = parseHardwareEvidence(run.stderr);
      const probe =
        run.code === 0 && !run.timedOut
          ? await probeOutput(outPath, opts.timeoutMs)
          : {
              error: `not probed (ffmpeg exit ${run.code}${run.timedOut ? ', timed out' : ''})`,
              ok: false,
              stream: null,
            };
      const attempt = {
        args,
        chain: chain.chain,
        exitCode: run.code,
        feedMs: Math.round(run.feedMs),
        filter: args[args.indexOf('-vf') + 1],
        framesWritten: run.framesWritten,
        hardwareEvidence: {
          ...evidence,
          hardware: run.code === 0 && Boolean(evidence.deviceLine) && Boolean(evidence.mfxLine),
        },
        probe: probe.ok
          ? {
              avg_frame_rate: probe.stream?.avg_frame_rate ?? null,
              codec_name: probe.stream?.codec_name ?? null,
              height: probe.stream?.height ?? null,
              nb_frames: probe.stream?.nb_frames ?? null,
              nb_read_frames: probe.stream?.nb_read_frames ?? null,
              ok: true,
              r_frame_rate: probe.stream?.r_frame_rate ?? null,
              width: probe.stream?.width ?? null,
            }
          : { error: probe.error, ok: false },
        spawnError: run.spawnError ?? null,
        stderrErrorLines: stderrErrorLines(run.stderr),
        stderrTail: run.stderr.slice(-4000),
        stderrTruncated: run.stderr.length > 4000,
        timedOut: run.timedOut,
        wallMs: Math.round(run.wallMs),
      };
      attempts.push(attempt);
      console.log(
        `  ${fps} fps: ${chain.chain} -> exit ${run.code}${run.timedOut ? ' (timeout)' : ''}${probe.ok ? `, probe ${probe.stream?.avg_frame_rate} ${probe.stream?.nb_read_frames ?? probe.stream?.nb_frames ?? '?'} frames` : ''}`,
      );
      if (run.code === 0 && !run.timedOut && probe.ok) {
        winner = attempt;
        break;
      }
      await fs.rm(outPath, { force: true });
      if (run.timedOut) break; // a hang is not worth retrying other pools
    }

    const probeStream = winner?.probe?.ok ? winner.probe : null;
    const avgFrameRate = probeStream?.avg_frame_rate ?? null;
    const frameCountRaw = probeStream?.nb_read_frames ?? probeStream?.nb_frames ?? null;
    const frameCount = frameCountRaw === null ? null : Number(frameCountRaw);
    const expectedRate = `${fps}/1`;
    const rateMatch = avgFrameRate === expectedRate;
    const frameMatch = frameCount === totalFrames;
    const hardware = Boolean(winner?.hardwareEvidence?.hardware);
    const codecMatch = probeStream?.codec_name === 'h264';
    const passed = Boolean(winner) && rateMatch && frameMatch && hardware && codecMatch;
    if (winner && winner.chain !== 'required') {
      notes.push(
        `rate ${fps}: required chain (hwupload=extra_hw_frames=${REQUIRED_EXTRA_HW_FRAMES}) failed; used ${winner.chain} with filter ${winner.filter}`,
      );
    }
    rates.push({
      args: winner?.args ?? attempts[0]?.args ?? null,
      attempts,
      avg_frame_rate: avgFrameRate,
      chainUsed: winner?.chain ?? null,
      codec_name: probeStream?.codec_name ?? null,
      codecMatch,
      encoderInitEvidence: winner?.hardwareEvidence ?? attempts[0]?.hardwareEvidence ?? null,
      exitCode: winner?.exitCode ?? null,
      fps,
      frameCount,
      frameMatch,
      hardwareEncoded: hardware,
      height: probeStream?.height ?? null,
      nb_frames: probeStream?.nb_frames ?? null,
      nb_read_frames: probeStream?.nb_read_frames ?? null,
      passed,
      rateMatch,
      requestedFrames: totalFrames,
      seconds: opts.seconds,
      timedOut: attempts.some((attempt) => attempt.timedOut),
      wallClockMs: winner?.wallMs ?? null,
      width: probeStream?.width ?? null,
    });
    console.log(
      `  ${fps} fps: avg_frame_rate=${avgFrameRate} frames=${frameCount} hardware=${hardware} passed=${passed} wall=${rates[rates.length - 1].wallClockMs ?? 'n/a'}ms`,
    );
  }

  // Software fallback timing is only meaningful when no hardware rate passed.
  let softwareFallback = null;
  const anyHardware = rates.some((rate) => rate.passed);
  if (!anyHardware) {
    const fps = opts.fps[0];
    const totalFrames = Math.round(fps * opts.seconds);
    const outPath = path.join(TEMP_DIR, `libx264-${fps}fps.mp4`);
    await fs.rm(outPath, { force: true });
    const args = buildSoftwareArgs({ fps, outPath, totalFrames });
    const run = await encodeRawFrames({ args, frames, timeoutMs: opts.timeoutMs, totalFrames });
    const probe =
      run.code === 0 && !run.timedOut
        ? await probeOutput(outPath, opts.timeoutMs)
        : {
            error: `not probed (ffmpeg exit ${run.code}${run.timedOut ? ', timed out' : ''})`,
            ok: false,
            stream: null,
          };
    softwareFallback = {
      args,
      avg_frame_rate: probe.ok ? (probe.stream?.avg_frame_rate ?? null) : null,
      exitCode: run.code,
      fps,
      frameCount: probe.ok ? Number(probe.stream?.nb_read_frames ?? probe.stream?.nb_frames ?? 0) : null,
      framesWritten: run.framesWritten,
      note: 'libx264 timing recorded only because no rate hardware-encoded; never used for the GO path',
      probe: probe.ok ? probe.stream : { error: probe.error },
      requestedFrames: totalFrames,
      stderrTail: run.stderr.slice(-4000),
      timedOut: run.timedOut,
      wallMs: Math.round(run.wallMs),
    };
    console.log(
      `  software fallback: libx264 ${fps} fps exit=${run.code} wall=${softwareFallback.wallMs}ms frames=${softwareFallback.frameCount}`,
    );
  }

  const filesRemoved = await fs.readdir(TEMP_DIR).catch(() => []);
  if (!opts.keep) await fs.rm(TEMP_DIR, { force: true, recursive: true });
  const tempInfo = { filesRemoved, kept: opts.keep, removed: !opts.keep, tempDir: TEMP_DIR };

  const artifact = buildArtifact({
    durationMs: performance.now() - started,
    ffmpegInfo,
    ffprobeInfo,
    notes,
    opts,
    rates,
    softwareFallback,
    startedAt,
    tempInfo,
  });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`VERDICT: ${artifact.verdict}`);
  console.log(`artifact: ${ARTIFACT_PATH}`);
  process.exit(0);
}

function parseArgs(argv) {
  const opts = {
    device: DEFAULT_DEVICE,
    fps: [...DEFAULT_FPS],
    help: false,
    keep: false,
    seconds: DEFAULT_SECONDS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  const takeValue = (arg, index) => {
    const eq = arg.indexOf('=');
    if (eq !== -1) return { next: index, value: arg.slice(eq + 1) };
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    return { next: index + 1, value };
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '--keep') {
      opts.keep = true;
      continue;
    }
    if (arg === '--fps' || arg.startsWith('--fps=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      const rates = value.split(',').map((part) => Number(part.trim()));
      if (!rates.length || rates.some((rate) => !Number.isInteger(rate) || rate <= 0))
        throw new Error(`invalid --fps value: ${value}`);
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
    if (arg === '--device' || arg.startsWith('--device=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      if (!value) throw new Error('invalid --device value');
      opts.device = value;
      continue;
    }
    if (arg === '--timeout' || arg.startsWith('--timeout=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      const timeout = Number(value);
      if (!Number.isFinite(timeout) || timeout <= 0) throw new Error(`invalid --timeout value: ${value}`);
      opts.timeoutMs = Math.round(timeout * 1000);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

/** Hardware proof: the device line names a real PCI adapter and the oneVPL/MFX session came up. */
function parseHardwareEvidence(stderr) {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const deviceLine = lines.find((line) => /Using device\s+[0-9a-fA-F]{4}:[0-9a-fA-F]{4}\s+\(/.test(line)) ?? null;
  const mfxLine =
    lines.find((line) =>
      /oneVPL to create MFX session|Initialize MFX session: implementation version|hardware accelerated implementation/i.test(
        line,
      ),
    ) ?? null;
  const acceleratedLine = lines.find((line) => /hardware accelerated implementation/i.test(line)) ?? null;
  const matchedLines = [
    ...new Set(
      lines.filter((line) =>
        /oneVPL|MFX session|Using device\s+[0-9a-f]{4}:|hardware accelerated implementation/i.test(line),
      ),
    ),
  ].slice(0, 12);
  const adapter = deviceLine ? (deviceLine.match(/Using device\s+\S+\s+\((.*)\)\.?$/)?.[1] ?? null) : null;
  return { adapter, deviceLine, hardwareAcceleratedLine: acceleratedLine, matchedLines, mfxLine };
}

function printHelp() {
  console.log(`G2 QSV feasibility spike.

Usage: node scripts/spike-qsv-encode.mjs [options]

  --fps=60,120     rates to sample (default 60,120)
  --seconds=10     clip length per rate (default 10)
  --device=hw      QSV device name used in "-init_hw_device qsv=<name>";
                   the filter chain always references device "hw", so a name
                   other than "hw" (e.g. --device=bogus) forces the NO-GO path
  --timeout=120    per-command timeout in seconds (default 120, then killed)
  --keep           keep temp raw/encoded files (default: delete them)
  --help           show this text

Exit codes: 0 = verdict written (GO/PARTIAL/NO-GO); 1 = ffmpeg/ffprobe missing
or the artifact could not be written; 2 = invalid arguments.`);
}

async function probeOutput(outputPath, timeoutMs) {
  const args = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-count_frames',
    '-show_entries',
    'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames',
    '-of',
    'json',
    outputPath,
  ];
  const result = await spawnCapture(FFPROBE, args, timeoutMs);
  if (result.code !== 0) {
    return { error: result.stderr.trim() || `ffprobe exited ${result.code}`, ok: false, stream: null };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return { error: null, ok: true, stream: parsed.streams?.[0] ?? null };
  } catch (error) {
    return { error: `ffprobe JSON parse failed: ${String(error)}`, ok: false, stream: null };
  }
}

async function readFfmpegVersion() {
  const result = await spawnCapture(FFMPEG, ['-version'], 20_000);
  const firstLine = result.stdout.split(/\r?\n/)[0]?.trim() ?? '';
  return {
    error: result.stderr.trim(),
    exitCode: result.code,
    ok: result.code === 0 && firstLine.length > 0,
    version: firstLine,
  };
}

function spawnCapture(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve({ code: null, spawnError: String(error), stderr: String(error), stdout: '', timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killChild(child);
    }, timeoutMs);
    const finish = (code, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, spawnError, stderr, stdout, timedOut });
    };
    child.stdout.on('data', (chunk) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk);
    });
    child.once('error', (error) => finish(null, String(error)));
    child.once('close', (code) => finish(code, null));
  });
}

function stderrErrorLines(stderr) {
  return [
    ...new Set(
      stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /error|invalid|failed|unable|cannot|no such|not found/i.test(line)),
    ),
  ].slice(0, 20);
}

main().catch(async (error) => {
  console.error(`spike failed: ${error?.stack ?? error}`);
  process.exit(1);
});
