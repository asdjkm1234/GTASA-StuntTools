import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, createReadStream, createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const WIDTH = 1920;
const HEIGHT = 1080;
const DEFAULT_FPS = 30;
/** Target export rates. An unsupported value (e.g. 61) must fail loudly, never be coerced to a nearby rate. */
const SUPPORTED_FPS = [30, 60, 120];
/**
 * Intel Arc A380 + oneVPL: the documented `hwupload=extra_hw_frames=64` fails at the first upload
 * ("Failed to upload frame: -1313558101"); `extra_hw_frames=32` works. Both rates were measured on this host
 * and recorded in `.omo/evidence/gate-G2-flight-analysis-remediation-and-worktree-cleanup.json`.
 */
const HWUPLOAD_EXTRA_FRAMES = 32;
const QSV_DEVICE = process.env.QSV_DEVICE || "hw";
const QSV_FILTER = `format=nv12,hwupload=extra_hw_frames=${HWUPLOAD_EXTRA_FRAMES},format=qsv`;
const ENCODER_STDERR_CAP = 512 * 1024;
/**
 * The frame stream is RAW pixels, never PNG: the replay page composites the engine canvas with the canvas HUD
 * mirror, reads the pixels back at a synchronization point (todo 33) and returns one tightly-packed RGBA frame
 * per encode frame.
 * `rawvideo` + `rgba` is the FFmpeg contract that matches it, and `FRAME_BYTES` is the exact size every
 * hand-off must be (so a screenshot/serialized image can never silently enter the pipe).
 */
const INPUT_FORMAT = "rawvideo";
const PIXEL_FORMAT = "rgba";
const BYTES_PER_PIXEL = 4;
const FRAME_BYTES = WIDTH * HEIGHT * BYTES_PER_PIXEL;
/**
 * In-page encode (todo 28): the page encodes hardware H.264 (Annex-B) with WebCodecs and returns only the
 * encoded chunks, so on that path FFmpeg's input is the H.264 elementary stream and it copy-muxes it.
 */
const ENCODED_INPUT_FORMAT = "h264";
const ENCODE_BATCH_FRAMES = 8;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_CSV_BYTES = 16 * 1024 * 1024;
const MAX_WAV_BYTES = 1024 * 1024 * 1024;
const MAX_SECONDS = 2 * 60 * 60;
const JOB_TTL_MS = 60 * 60 * 1000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CSV_NAME = /^flight_[A-Za-z0-9._-]+\.csv$/i;
const CAMERA_MODES = new Set(["chase-near", "chase-mid", "chase-far", "first-person", "cockpit"]);
/**
 * Explicit export audio modes. `undefined` keeps the legacy priority (uploaded -> recorded -> synthesized).
 * `'synth'` asks for the page's offline-synthesized engine audio ONLY: the recorded game WAV is never a
 * fallback, and an unavailable render fails the job.
 */
const AUDIO_MODES = new Set(["synth"]);
const jobRoute = new RegExp(`^/video-export/(${UUID})(?:/(cancel|download))?$`);
const sourceRoute = new RegExp(`^/video-export/source/(${UUID})\\.csv$`);

/** Recorder filenames only: a flat `flight_*.csv` basename, no separators or Windows stream syntax. */
function validCsvName(value) {
  return typeof value === "string" && CSV_NAME.test(value) && path.basename(value) === value;
}

/** Resolve the requested export rate. `undefined` means the 30 fps default; anything outside the supported set is rejected. */
function resolveFps(value) {
  if (value === undefined || value === null) return DEFAULT_FPS;
  if (typeof value !== "number" || !Number.isInteger(value) || !SUPPORTED_FPS.includes(value)) {
    throw Object.assign(new Error("unsupported frame rate"), { statusCode: 400 });
  }
  return value;
}

function validView(value) {
  if (!value || typeof value !== "object") return false;
  if (CAMERA_MODES.has(value.mode)) return true;
  if (value.mode === "cockpit-look") {
    const pose = value.cockpitLookPose;
    return pose && typeof pose === "object" &&
      Number.isFinite(pose.yaw) && Math.abs(pose.yaw) < 100000 &&
      Number.isFinite(pose.pitch) && Math.abs(pose.pitch) <= 1.45 &&
      Number.isFinite(pose.lateral) && Math.abs(pose.lateral) <= 0.1 &&
      Number.isFinite(pose.longitudinal) && pose.longitudinal >= -0.08 && pose.longitudinal <= 0.12 &&
      Number.isFinite(pose.height) && Math.abs(pose.height) <= 0.08;
  }
  return value.mode === "free" && Array.isArray(value.position) && value.position.length === 3 &&
    value.position.every(number => Number.isFinite(number) && Math.abs(number) < 100000) &&
    Number.isFinite(value.yaw) && Number.isFinite(value.pitch) && Math.abs(value.yaw) < 100000 && Math.abs(value.pitch) <= 1.56;
}

/** The optional voice-over is a WAV beside the recording with the same basename, never outside recordingsRoot. */
function sameBasenameWav(filename, root) {
  if (!validCsvName(filename)) return null;
  const candidate = path.join(root, filename.replace(/\.csv$/i, ".wav"));
  return path.dirname(path.resolve(candidate)) === path.resolve(root) ? candidate : null;
}

const WAV_MIN_BYTES = 44;
/** An export audio track is only accepted when it is a real RIFF/WAVE file, never a truncated blob. */
function isWavBuffer(value) {
  return Buffer.isBuffer(value) && value.length >= WAV_MIN_BYTES &&
    value.toString("ascii", 0, 4) === "RIFF" && value.toString("ascii", 8, 12) === "WAVE";
}

function downloadName(job) {
  return validCsvName(job.filename) ? job.filename.replace(/\.csv$/i, ".mp4") : `flight-${job.id}.mp4`;
}

function respond(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_CSV_BYTES + 2048) {
      const error = new Error("Recording is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { const error = new Error("Invalid JSON"); error.statusCode = 400; throw error; }
}

function abortError() {
  return Object.assign(new Error("Export cancelled"), { name: "AbortError" });
}

function assertActive(signal) {
  if (signal.aborted) throw abortError();
}

function withAbort(promise, signal) {
  assertActive(signal);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(abortError());
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

function status(job) {
  const encoder = job.encoder;
  return { id: job.id, state: job.state, message: job.message, progress: job.progress, fps: job.fps,
    frame: job.frame, totalFrames: job.totalFrames, audio: job.audio, audioSource: job.audioSource ?? null, audioMode: job.audioMode ?? null, downloadUrl: job.state === "ready" ? `/video-export/${job.id}/download` : null,
    // Perf instrumentation: created -> rendering (browser + pak) -> ready (frames + encode + mux).
    createdAt: job.createdAt ?? null, renderStartedAt: job.renderStartedAt ?? null, readyAt: job.readyAt ?? null,
    // Pipeline instrumentation: what the FFmpeg pipe actually was, and what it actually carried. The frame
    // stream is asserted PNG-free from these live counters, never by assuming the code path.
    encoderExited: job.encoderExited,
    encoderArgs: encoder?.args ?? null,
    // Hardware proof is the encoder-INIT log (adapter + oneVPL/MFX session), never the codec name alone.
    hardwareEncoder: job.hardwareEncoder ?? null,
    encoderInitEvidence: job.encoderInitEvidence ?? null,
    frameStream: job.frameStream ? {
      bytes: job.frameStream.bytes,
      chunks: job.frameStream.chunks ?? 0,
      frames: job.frameStream.frames,
      pngSignatureSeen: job.frameStream.pngSignatureSeen,
      fps: job.fps, height: HEIGHT, width: WIDTH,
      inputFormat: encoder?.inputFormat ?? null,
      pixelFormat: encoder?.pixelFormat ?? null,
    } : null,
    // In-page encode (todo 28): which path ran, whether the WebCodecs hardware config was accepted, and the
    // explicit fallback reason when the raw path was used instead. Never silent.
    videoEncode: job.videoEncode ?? null,
    compositor: job.compositor ?? null };
}

/**
 * The replay page hands the exporter a synthesized engine audio track (the todo-19 offline PCM renderer via
 * the page's `renderAudio` hook). The bytes are accepted only as a RIFF/WAVE file the exporter can mux.
 *
 * Returns `{ wav, reason }`: `wav` is the decoded buffer or `null`, `reason` names WHY synthesis was
 * unavailable (never a silent absence). In `audioMode: 'synth'` a null `wav` FAILS the job — the recorded WAV
 * is never a fallback.
 */
async function readRendererAudio(page, signal) {
  const available = await withAbort(page.evaluate(() => {
    const api = globalThis.__flightVideoExport;
    return Boolean(api && typeof api.renderAudio === "function");
  }), signal);
  if (!available) return { wav: null, reason: "the replay page does not expose window.__flightVideoExport.renderAudio" };
  let raw;
  try {
    raw = await withAbort(page.evaluate(() => globalThis.__flightVideoExport.renderAudio()), signal);
  } catch (error) {
    return { wav: null, reason: `renderAudio() failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!raw) return { wav: null, reason: "renderAudio() returned no WAV bytes (the page rendered no synthesized track)" };
  const buffer = Buffer.isBuffer(raw) ? raw : raw instanceof Uint8Array ? Buffer.from(raw) : typeof raw?.base64 === "string" ? Buffer.from(raw.base64, "base64") : null;
  if (!buffer) return { wav: null, reason: "renderAudio() returned synthesized audio in an unsupported shape" };
  if (!isWavBuffer(buffer)) return { wav: null, reason: "renderAudio() returned bytes that are not a RIFF/WAVE file" };
  return { wav: buffer, reason: null };
}

/**
 * Browser contract supplied by the replay app when ?videoExport=1:
 * window.__flightVideoExport.ready() -> Promise<{ duration: seconds, compositor: { backend, width, height, pixelFormat } }>
 * window.__flightVideoExport.renderAudio() -> Promise<Uint8Array>         // the offline-synthesized engine WAV
 * window.__flightVideoExport.renderFrame(seconds) -> Promise<Uint8Array>   // one RAW RGBA frame
 * ready waits for the selected recording, aircraft and pak to be renderable; renderFrame pauses real-time
 * playback, seeks absolute time, renders ONE frame, waits for the engine's GPU submit to finish, composites the
 * canvas HUD mirror over it, reads the composited pixels back with `getImageData` (a synchronous readback point)
 * and returns the tightly-packed RGBA bytes. No screenshot, no requestAnimationFrame and no presentation wait
 * are used: the compositor is a pure function of the injected time (the todo-21 seam), and the readback is
 * synchronized to the render so a captured frame is always a completed render (todo 33).
 *
 * The window is launched HEADLESS — the export must never open a visible second window. `visible` is an
 * explicit request flag (default false) so a host can ask for a debug window, and the tests assert the
 * factory is called with `visible: false`.
 */
async function openReplayRenderer({ sourceUrl, executablePath, opensaRoot, signal, visible = false }) {
  if (!executablePath || !existsSync(executablePath)) throw new Error("Chrome or Edge was not found");
  const requireFromOpensa = createRequire(path.join(opensaRoot, "package.json"));
  let chromium;
  try { ({ chromium } = requireFromOpensa("playwright")); }
  catch { throw new Error("Playwright is not installed in tools/opensa/node_modules"); }
  const profile = await fs.mkdtemp(path.join(tmpdir(), "stunt-video-browser-"));
  let context;
  try {
    context = await withAbort(chromium.launchPersistentContext(profile, {
      executablePath, headless: visible !== true, viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1, args: ["--no-first-run", "--no-default-browser-check"],
      ignoreDefaultArgs: ["--enable-automation"],
    }), signal);
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(180_000);
    await withAbort(page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 180_000 }), signal);
    await withAbort(page.waitForFunction(() => {
      const api = globalThis.__flightVideoExport;
      return Boolean(api && typeof api.ready === "function" && typeof api.renderFrame === "function");
    }, { timeout: 180_000 }), signal);
    const ready = await withAbort(page.evaluate(() => globalThis.__flightVideoExport.ready()), signal);
    const compositor = ready?.compositor ?? null;
    const audio = await readRendererAudio(page, signal);
    // The in-page hardware encoder is detected, never assumed: an older page without it keeps the raw path.
    const hasInPageEncode = await withAbort(page.evaluate(() => {
      const api = globalThis.__flightVideoExport;
      return Boolean(api && typeof api.beginEncode === "function" && typeof api.encodeFrames === "function" && typeof api.endEncode === "function");
    }), signal);
    // The frame contract is fixed at the exporter end; a compositor that reports a different one must fail
    // loudly instead of silently feeding FFmpeg a mismatched byte layout.
    if (compositor && (compositor.width !== WIDTH || compositor.height !== HEIGHT ||
      compositor.pixelFormat !== PIXEL_FORMAT)) {
      throw new Error(`Replay compositor frame contract mismatch: ${JSON.stringify(compositor)}`);
    }
    return {
      duration: ready?.duration,
      compositor,
      audioWav: audio.wav,
      audioUnavailableReason: audio.reason,
      hasInPageEncode,
      // Only attached when the page really exposes the encoder, so `typeof beginEncode === "function"` is a
      // truthful capability test (a page without it keeps the raw lane, never a call that would throw).
      ...(hasInPageEncode ? {
        async beginEncode(fps) {
          return withAbort(page.evaluate((value) => globalThis.__flightVideoExport.beginEncode(value), fps), signal);
        },
        async encodeFrames(startFrame, count) {
          return withAbort(page.evaluate(([start, total]) => globalThis.__flightVideoExport.encodeFrames(start, total), [startFrame, count]), signal);
        },
        async endEncode() {
          return withAbort(page.evaluate(() => globalThis.__flightVideoExport.endEncode()), signal);
        },
      } : {}),
      async frameAt(seconds) {
        assertActive(signal);
        const raw = await withAbort(page.evaluate((time) => globalThis.__flightVideoExport.renderFrame(time), seconds), signal);
        if (!raw) throw new Error("Replay compositor returned no frame");
        if (Buffer.isBuffer(raw)) return raw;
        if (raw instanceof Uint8Array) return Buffer.from(raw);
        if (typeof raw?.base64 === "string") return Buffer.from(raw.base64, "base64");
        throw new Error("Replay compositor returned a frame in an unsupported shape");
      },
      async close() {
        await context.close().catch(() => {});
        await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/** Await a back-pressured pipe write (resolves on drain, rejects on error). */
function writeToStream(stream, buffer) {
  return new Promise((resolve, reject) => {
    const failed = (error) => { cleanup(); reject(error); };
    const drained = () => { cleanup(); resolve(); };
    const cleanup = () => { stream.off("error", failed); stream.off("drain", drained); };
    stream.once("error", failed);
    try {
      if (stream.write(buffer)) { cleanup(); resolve(); }
      else stream.once("drain", drained);
    } catch (error) { failed(error); }
  });
}

/**
 * Hand one RAW composited frame to FFmpeg. The frame MUST be exactly `FRAME_BYTES` of RGBA; anything else
 * (a screenshot, a serialized image, a truncated/over-long buffer) is rejected here, and a leading PNG
 * signature is recorded and refused so the instrumentation can prove the pipe never carried one.
 */
function writeFrame(stream, frame, signal, job) {
  assertActive(signal);
  const stats = job.frameStream;
  if (!Buffer.isBuffer(frame) || frame.length !== FRAME_BYTES) {
    throw new Error(`Replay returned an invalid raw frame (${Buffer.isBuffer(frame) ? `${frame.length} bytes` : "not a buffer"}, expected ${FRAME_BYTES} RGBA bytes)`);
  }
  if (frame.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    stats.pngSignatureSeen = true;
    throw new Error("Replay frame stream contained a PNG signature; the compositor must emit raw pixels");
  }
  stats.frames += 1;
  stats.bytes += frame.length;
  return writeToStream(stream, frame);
}

/**
 * Hand one encoded H.264 chunk (Annex-B, from the page's WebCodecs encoder) to the copy-muxing FFmpeg.
 * The payload is small — this is the whole point of the in-page path: raw 8.3 MB frames never cross CDP.
 * A PNG signature is still refused, so the instrumentation proves the pipe carried encoded video, not images.
 */
function writeEncodedChunk(stream, chunk, signal, job) {
  assertActive(signal);
  const stats = job.frameStream;
  if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
    throw new Error(`Replay encoder returned an invalid encoded chunk (${Buffer.isBuffer(chunk) ? `${chunk.length} bytes` : "not a buffer"})`);
  }
  if (chunk.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    stats.pngSignatureSeen = true;
    throw new Error("Replay encoded stream contained a PNG signature; the page must return H.264 chunks");
  }
  stats.chunks += 1;
  stats.bytes += chunk.length;
  return writeToStream(stream, chunk);
}

/** Hardware proof: a real PCI adapter line plus the oneVPL/MFX session, parsed from the encoder-init log. */
function parseHardwareEvidence(stderr) {
  const lines = stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const deviceLine = lines.find(line => /Using device\s+[0-9a-fA-F]{4}:[0-9a-fA-F]{4}\s+\(/.test(line)) ?? null;
  const mfxLine = lines.find(line => /oneVPL to create MFX session|Initialize MFX session: implementation version|hardware accelerated implementation/i.test(line)) ?? null;
  const adapter = deviceLine ? (deviceLine.match(/Using device\s+\S+\s+\((.*)\)\.?$/)?.[1] ?? null) : null;
  return { adapter, deviceLine, mfxLine };
}

/**
 * Raw, already-1920x1080 RGBA frames on stdin — no per-frame image decode and no scale filter. Video is
 * encoded by the Intel QSV hardware encoder through the proven oneVPL chain (`-init_hw_device qsv=…`,
 * `format=nv12,hwupload=extra_hw_frames=32,format=qsv`, `h264_qsv`) at exactly the requested rate:
 * `-fps_mode cfr -r <fps>` pins the cadence and `-frames:v` pins the count. A recorded WAV or the
 * synthesized PCM is muxed with `-t frames/fps`. `-loglevel verbose` is required because the encoder-init
 * log is the only hardware proof, so it is captured (capped) for `status()`/evidence.
 */
function runFfmpeg(job, ffmpegExecutable, wavPath, outputPath) {
  const fps = job.fps;
  const args = ["-hide_banner", "-loglevel", "verbose", "-y", "-init_hw_device", `qsv=${QSV_DEVICE}`,
    "-filter_hw_device", "hw", "-f", INPUT_FORMAT, "-pix_fmt", PIXEL_FORMAT,
    "-s", `${WIDTH}x${HEIGHT}`, "-framerate", String(fps), "-i", "pipe:0"];
  if (wavPath) args.push("-i", wavPath);
  args.push("-vf", QSV_FILTER, "-c:v", "h264_qsv", "-fps_mode", "cfr", "-r", String(fps),
    "-frames:v", String(job.totalFrames));
  if (wavPath) args.push("-af", "apad", "-c:a", "aac", "-b:a", "192k", "-t", String(job.totalFrames / fps));
  else args.push("-an");
  args.push("-movflags", "+faststart", outputPath);
  const child = spawn(ffmpegExecutable, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-ENCODER_STDERR_CAP); });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}: ${stderr.trim()}`)));
  });
  // Keep a failed encoder from becoming an unhandled rejection while the browser is still taking frames.
  completion.catch(() => {});
  job.encoder = { args, chain: QSV_FILTER, fps, height: HEIGHT, inputFormat: INPUT_FORMAT, pixelFormat: PIXEL_FORMAT, width: WIDTH };
  return { child, completion, readLog: () => stderr };
}

/**
 * In-page encode (todo 28): FFmpeg reads the Annex-B H.264 elementary stream the page already encoded on the
 * hardware encoder and COPY-MUXES it into MP4 (`-c:v copy`) — no re-encode, so the encoder bottlenecks of the
 * raw path (and the per-frame raw CDP transfer) are out of the picture. Video timing comes from the input
 * `-framerate` (the chunks are CFR, one per 1/fps). NOTE: `-frames:v` is deliberately NOT used here — with
 * `-c:v copy` it cuts the output before the AAC muxer flushes, dropping the audio entirely (measured). Audio
 * mux is otherwise unchanged from the raw path.
 */
function runFfmpegMux(job, ffmpegExecutable, wavPath, outputPath) {
  const fps = job.fps;
  // `-framerate` alone leaves FFmpeg free to derive the stream timebase from the H.264 VUI, which on a real
  // WebCodecs stream resolves to a non-integer tick (avg_frame_rate came out 1024000/17067, not 60/1). An
  // INPUT `-r` pins the demuxer timestamps to exactly 1/fps, so the copy-muxed track is exactly 60/1 / 120/1.
  const args = ["-hide_banner", "-loglevel", "verbose", "-y", "-f", ENCODED_INPUT_FORMAT,
    "-framerate", String(fps), "-r", String(fps), "-i", "pipe:0"];
  if (wavPath) args.push("-i", wavPath);
  args.push("-c:v", "copy", "-fps_mode", "cfr", "-r", String(fps));
  if (wavPath) args.push("-af", "apad", "-c:a", "aac", "-b:a", "192k", "-t", String(job.totalFrames / fps));
  else args.push("-an");
  args.push("-movflags", "+faststart", outputPath);
  const child = spawn(ffmpegExecutable, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-ENCODER_STDERR_CAP); });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}: ${stderr.trim()}`)));
  });
  completion.catch(() => {});
  job.encoder = { args, chain: "copy", fps, height: HEIGHT, inputFormat: ENCODED_INPUT_FORMAT, pixelFormat: "yuv420p", width: WIDTH };
  return { child, completion, readLog: () => stderr };
}

/**
 * Report the page's WebCodecs result as job evidence. `hardware` is claimed only when the browser accepted a
 * `prefer-hardware` config; `hardwareProof` names exactly what backs that claim (a `powerEfficient` media
 * capability or the reported hardware config + adapter) and every field the page returned is carried through.
 */
function normalizeVideoEncode(info) {
  if (!info) {
    return { mode: "raw", supported: false, fallback: true, fallbackReason: "page reported no encoder info", hardware: false, hardwareProof: null };
  }
  if (info.supported === true) {
    const capabilities = info.mediaCapabilities ?? null;
    const powerEfficient = capabilities?.powerEfficient === true;
    return {
      mode: "in-page-hardware",
      supported: true,
      fallback: false,
      fallbackReason: null,
      adapter: info.adapter ?? null,
      codec: info.codec ?? null,
      config: info.config ?? null,
      hardwareAcceleration: info.hardwareAcceleration ?? null,
      mediaCapabilities: capabilities,
      hardware: info.hardwareAcceleration === "prefer-hardware",
      hardwareProof: powerEfficient ? "webcodecs-power-efficient" : "webcodecs-hardware-config",
    };
  }
  return {
    mode: "raw",
    supported: false,
    fallback: true,
    fallbackReason: info.reason ?? "WebCodecs hardware H.264 is not supported",
    adapter: info.adapter ?? null,
    hardwareAcceleration: info.hardwareAcceleration ?? null,
    hardware: false,
    hardwareProof: null,
  };
}

/** A block of frames through the raw path: one RGBA frame per encode frame into the QSV encoder's stdin. */
async function streamRawFrames(renderer, job, ffmpeg) {
  for (let frame = 0; frame < job.totalFrames; frame += 1) {
    assertActive(job.controller.signal);
    const raw = await renderer.frameAt(frame / job.fps);
    await writeFrame(ffmpeg.child.stdin, raw, job.controller.signal, job);
    job.frame = frame + 1;
    job.progress = Math.floor((job.frame / job.totalFrames) * 95);
  }
}

/**
 * Drive the page's in-page encoder in bounded batches and copy-mux the chunks. Only encoded chunks cross CDP;
 * the encoder's queue is drained page-side each batch, and `endEncode` flushes so no frame is dropped.
 */
async function streamInPageFrames(renderer, job, ffmpeg) {
  let frame = 0;
  while (frame < job.totalFrames) {
    assertActive(job.controller.signal);
    const count = Math.min(ENCODE_BATCH_FRAMES, job.totalFrames - frame);
    const result = await renderer.encodeFrames(frame, count);
    if (!result || !Array.isArray(result.chunks)) throw new Error("Replay encoder returned no encoded chunks");
    for (const encoded of result.chunks) {
      await writeEncodedChunk(ffmpeg.child.stdin, Buffer.from(encoded, "base64"), job.controller.signal, job);
    }
    frame += count;
    job.frame = frame;
    job.frameStream.frames = Number.isInteger(result.frames) ? result.frames : frame;
    job.progress = Math.floor((frame / job.totalFrames) * 95);
  }
  const tail = await renderer.endEncode();
  if (!tail || !Array.isArray(tail.chunks)) throw new Error("Replay encoder flush returned no encoded chunks");
  for (const encoded of tail.chunks) {
    await writeEncodedChunk(ffmpeg.child.stdin, Buffer.from(encoded, "base64"), job.controller.signal, job);
  }
  if (Number.isInteger(tail.framesEncoded)) {
    // `-c:v copy` cannot pin the count, so the page's own frame count is the guard: a mismatch means the
    // encoder dropped or duplicated frames and the raw path is a truthful fallback.
    if (tail.framesEncoded !== job.totalFrames) {
      throw new Error(`in-page encoder produced ${tail.framesEncoded} frames, expected ${job.totalFrames}`);
    }
    job.frameStream.frames = tail.framesEncoded;
  }
}

/** Copy the page's WebCodecs result into the job's hardware evidence (used for the in-page path). */
function setInPageHardwareEvidence(job) {
  const videoEncode = job.videoEncode ?? {};
  job.hardwareEncoder = videoEncode.hardware === true;
  job.encoderInitEvidence = {
    adapter: videoEncode.adapter ?? null,
    codec: videoEncode.codec ?? null,
    config: videoEncode.config ?? null,
    hardwareAcceleration: videoEncode.hardwareAcceleration ?? null,
    hardware: videoEncode.hardware === true,
    mediaCapabilities: videoEncode.mediaCapabilities ?? null,
    platform: "webcodecs",
    proof: videoEncode.hardwareProof ?? null,
  };
}

export function createVideoExporter({ origin, recordingsRoot, opensaRoot, chromiumPath,
  ffmpegExecutable = "ffmpeg", outputRoot = path.join(tmpdir(), "GTASA-StuntTools-video-exports"),
  rendererFactory = openReplayRenderer }) {
  const jobs = new Map();
  const uploads = new Map();
  let running = null;

  async function pruneUploads() {
    for (const [token, item] of uploads) {
      if (Date.now() - item.createdAt < JOB_TTL_MS) continue;
      uploads.delete(token);
      await fs.rm(item.path, { force: true }).catch(() => {});
    }
  }

  async function run(job) {
    let renderer;
    let ffmpeg;
    const output = path.join(outputRoot, `${job.id}.mp4`);
    try {
      const recording = `/video-export/source/${job.id}.csv`;
      const viewQuery = job.view ? `&exportView=${encodeURIComponent(JSON.stringify(job.view))}` : "";
      const sourceUrl = `${origin}/opensa/flight-replay.html?recording=${encodeURIComponent(recording)}&pak=${encodeURIComponent(job.pakBase)}&videoExport=1${viewQuery}`;
      // `visible: false` is the explicit no-second-window request; the default renderer launches headless.
      renderer = await rendererFactory({ sourceUrl, executablePath: chromiumPath, opensaRoot, signal: job.controller.signal, visible: false });
      assertActive(job.controller.signal);
      job.compositor = renderer.compositor ?? null;
      const duration = Number(renderer.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS) throw new Error("Recording duration must be between 0 and 2 hours");
      job.totalFrames = Math.max(1, Math.ceil(duration * job.fps));
      job.state = "rendering";
      job.renderStartedAt = Date.now();
      job.message = "Rendering replay frames";
      await fs.mkdir(outputRoot, { recursive: true });
      let wavPath = null;
      if (job.audioMode === "synth") {
        // The user explicitly does not want the recorded game WAV. Prefer NOTHING over the recording: a missing
        // or malformed synthesized render FAILS the job, loudly, with the page's own reason. Uploaded/recorded
        // WAVs are never consulted on this path.
        if (!isWavBuffer(renderer.audioWav)) {
          throw new Error(`synthesized audio was requested but unavailable: ${renderer.audioUnavailableReason ?? "the replay page returned no synthesized WAV"}`);
        }
        const synthesized = path.join(outputRoot, `${job.id}.synthesized.wav`);
        await fs.writeFile(synthesized, renderer.audioWav);
        wavPath = synthesized;
        job.synthesizedWav = synthesized;
        job.audioSource = "synthesized";
      } else {
        wavPath = job.uploadedWav;
        if (wavPath) job.audioSource = "uploaded";
        const candidate = wavPath ? null : sameBasenameWav(job.filename, recordingsRoot);
        if (candidate) {
          const info = await fs.lstat(candidate).catch(() => null);
          if (info?.isFile()) {
            wavPath = candidate;
            job.audioSource = "recorded";
          }
        }
        // No recorded voice-over: mux the renderer's synthesized PCM (todo 19) when it supplied a valid WAV.
        if (!wavPath && isWavBuffer(renderer.audioWav)) {
          const synthesized = path.join(outputRoot, `${job.id}.synthesized.wav`);
          await fs.writeFile(synthesized, renderer.audioWav);
          wavPath = synthesized;
          job.synthesizedWav = synthesized;
          job.audioSource = "synthesized";
        }
        if (!wavPath) job.audioSource = "none";
      }
      job.audio = Boolean(wavPath);

      // Path selection (todo 28): prefer the page's in-page hardware encoder. Fall back to the raw QSV lane
      // EXPLICITLY when the page has no encoder or the browser rejects every hardware H.264 config.
      const inPageCapable = typeof renderer.beginEncode === "function";
      let useInPage = false;
      if (inPageCapable) {
        const info = await renderer.beginEncode(job.fps);
        job.videoEncode = normalizeVideoEncode(info);
        useInPage = job.videoEncode.supported === true;
      } else {
        job.videoEncode = normalizeVideoEncode(null);
      }

      if (useInPage) {
        try {
          ffmpeg = runFfmpegMux(job, ffmpegExecutable, wavPath, output);
          job.controller.signal.addEventListener("abort", () => ffmpeg.child.kill(), { once: true });
          await streamInPageFrames(renderer, job, ffmpeg);
        } catch (error) {
          if (job.controller.signal.aborted || error?.name === "AbortError") throw error;
          // The in-page encoder failed mid-stream. Re-run the WHOLE clip on the raw path, and record why:
          // an explicit, observable fallback, never a silent downgrade.
          const reason = error instanceof Error ? error.message : String(error);
          ffmpeg.child.stdin.destroy(); ffmpeg.child.kill(); await ffmpeg.completion.catch(() => {}); job.encoderExited = true;
          await fs.rm(output, { force: true }).catch(() => {});
          job.videoEncode = { ...job.videoEncode, mode: "raw-fallback", fallback: true, fallbackReason: reason };
          job.frame = 0; job.progress = 0; job.encoderExited = false; job.encoder = null;
          job.frameStream = { bytes: 0, chunks: 0, frames: 0, pngSignatureSeen: false };
          useInPage = false;
        }
      }
      if (!useInPage) {
        ffmpeg = runFfmpeg(job, ffmpegExecutable, wavPath, output);
        job.controller.signal.addEventListener("abort", () => ffmpeg.child.kill(), { once: true });
        await streamRawFrames(renderer, job, ffmpeg);
      }
      job.state = "encoding";
      job.message = "Finishing MP4";
      ffmpeg.child.stdin.end();
      await ffmpeg.completion;
      job.encoderExited = true;
      if (job.videoEncode?.mode === "in-page-hardware") {
        setInPageHardwareEvidence(job);
      } else {
        const evidence = parseHardwareEvidence(ffmpeg.readLog());
        job.encoderInitEvidence = { ...evidence, hardware: Boolean(evidence.deviceLine && evidence.mfxLine) };
        job.hardwareEncoder = job.encoderInitEvidence.hardware;
      }
      assertActive(job.controller.signal);
      job.state = "ready";
      job.readyAt = Date.now();
      job.message = "Video ready";
      job.progress = 100;
      job.output = output;
    } catch (error) {
      if (ffmpeg) {
        ffmpeg.child.stdin.destroy(); ffmpeg.child.kill(); await ffmpeg.completion.catch(() => {}); job.encoderExited = true;
        if (job.videoEncode?.mode === "in-page-hardware") {
          setInPageHardwareEvidence(job);
        } else {
          const evidence = parseHardwareEvidence(ffmpeg.readLog());
          job.encoderInitEvidence = { ...evidence, hardware: Boolean(evidence.deviceLine && evidence.mfxLine) };
          job.hardwareEncoder = job.encoderInitEvidence.hardware;
        }
      }
      await fs.rm(output, { force: true }).catch(() => {});
      job.state = job.controller.signal.aborted || error?.name === "AbortError" ? "cancelled" : "failed";
      job.message = job.state === "cancelled" ? "Export cancelled" : (error instanceof Error ? error.message : String(error));
    } finally {
      if (renderer) await renderer.close().catch(() => {});
      if (job.uploadedWav) await fs.rm(job.uploadedWav, { force: true }).catch(() => {});
      if (job.synthesizedWav) await fs.rm(job.synthesizedWav, { force: true }).catch(() => {});
      job.finishedAt = Date.now();
      if (running === job.id) running = null;
    }
  }

  /** Drop outputs and job records once they are old enough that no client is polling them. */
  async function pruneFinishedJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (!job.finishedAt || now - job.finishedAt < JOB_TTL_MS) continue;
      if (job.output) await fs.rm(job.output, { force: true }).catch(() => {});
      jobs.delete(id);
    }
  }

  async function handle(req, res, pathname) {
    if (!pathname.startsWith("/video-export")) return false;
    // Drain request bodies for replies that do not read them, so the client reliably sees the response.
    const reject = (code, body) => { req.resume(); respond(res, code, body); };
    if (req.method === "POST" && req.headers.origin !== origin) {
      reject(403, { error: "Forbidden" }); return true;
    }
    if (pathname === "/video-export/audio") {
      if (req.method !== "POST") { reject(405, { error: "Method not allowed" }); return true; }
      await pruneUploads();
      const announced = Number(req.headers["content-length"] ?? 0);
      if (announced > MAX_WAV_BYTES) { reject(413, { error: "WAV is too large" }); return true; }
      const token = randomUUID();
      const wavPath = path.join(outputRoot, `${token}.wav`);
      let bytes = 0;
      try {
        await fs.mkdir(outputRoot, { recursive: true });
        const limit = new Transform({ transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          callback(bytes > MAX_WAV_BYTES ? new Error("WAV is too large") : null, chunk);
        } });
        await pipeline(req, limit, createWriteStream(wavPath, { flags: "wx" }));
        const file = await fs.open(wavPath, "r");
        const header = Buffer.alloc(12);
        try { await file.read(header, 0, 12, 0); } finally { await file.close(); }
        if (bytes < 44 || header.toString("ascii", 0, 4) !== "RIFF" ||
          header.toString("ascii", 8, 12) !== "WAVE") throw new Error("Invalid WAV file");
        uploads.set(token, { path: wavPath, createdAt: Date.now() });
        respond(res, 201, { token });
      } catch (error) {
        await fs.rm(wavPath, { force: true }).catch(() => {});
        respond(res, bytes > MAX_WAV_BYTES ? 413 : 400, { error: error.message });
      }
      return true;
    }
    if (pathname === "/video-export") {
      if (req.method !== "POST") { reject(405, { error: "Method not allowed" }); return true; }
      if (running) { reject(409, { error: "An export is already running" }); return true; }
      let input;
      try { input = await readJson(req); }
      catch (error) { respond(res, error.statusCode ?? 400, { error: error.message }); return true; }
      const filename = input?.filename;
      if (typeof input?.csv !== "string" || !input.csv.includes("local_timestamp,") ||
        Buffer.byteLength(input.csv) > MAX_CSV_BYTES || (filename !== undefined && !validCsvName(filename))) {
        respond(res, 400, { error: "Invalid FlightRecorder CSV or filename" }); return true;
      }
      const pakBase = input.pakBase ?? "/map-pak";
      if (pakBase !== "/map-pak" && !new RegExp(`^/route-pak/${UUID}$`).test(pakBase)) {
        respond(res, 400, { error: "Invalid map pak" }); return true;
      }
      if (input.view !== undefined && !validView(input.view)) {
        respond(res, 400, { error: "Invalid camera view" }); return true;
      }
      let fps;
      try { fps = resolveFps(input.fps); }
      catch (error) { respond(res, error.statusCode ?? 400, { error: error.message }); return true; }
      if (input.audioToken !== undefined &&
        (typeof input.audioToken !== "string" || !new RegExp(`^${UUID}$`).test(input.audioToken) ||
          !uploads.has(input.audioToken))) {
        respond(res, 400, { error: "Invalid uploaded WAV" }); return true;
      }
      if (input.audioMode !== undefined && !AUDIO_MODES.has(input.audioMode)) {
        respond(res, 400, { error: "Invalid audio mode" }); return true;
      }
      const id = randomUUID();
      await pruneFinishedJobs();
      const uploadedWav = input.audioToken ? uploads.get(input.audioToken).path : null;
      if (input.audioToken) uploads.delete(input.audioToken);
      const job = { id, csv: input.csv, filename: input.filename ?? null, pakBase, view: input.view ?? null,
        fps, uploadedWav, audioMode: input.audioMode ?? null, createdAt: Date.now(), renderStartedAt: null, readyAt: null,
        state: "starting", message: "Starting video export", progress: 0, frame: 0, totalFrames: 0,
        audio: false, audioSource: null, synthesizedWav: null, output: null, finishedAt: null, controller: new AbortController(),
        compositor: null, encoder: null, encoderExited: false, hardwareEncoder: null, encoderInitEvidence: null,
        videoEncode: null, frameStream: { bytes: 0, chunks: 0, frames: 0, pngSignatureSeen: false } };
      jobs.set(id, job);
      running = id;
      void run(job);
      respond(res, 202, { id }); return true;
    }
    const source = sourceRoute.exec(pathname);
    if (source && req.method === "GET") {
      const job = jobs.get(source[1]);
      if (!job) respond(res, 404, { error: "Unknown export" });
      else respond(res, 200, job.csv, "text/csv; charset=utf-8");
      return true;
    }
    const match = jobRoute.exec(pathname);
    if (!match) { respond(res, 404, { error: "Unknown export route" }); return true; }
    const job = jobs.get(match[1]);
    if (!job) { respond(res, 404, { error: "Unknown export" }); return true; }
    if (!match[2] && req.method === "GET") { respond(res, 200, status(job)); return true; }
    if (match[2] === "cancel" && req.method === "POST") {
      req.resume();
      if (["starting", "rendering", "encoding"].includes(job.state)) {
        job.state = "cancelling";
        job.message = "Cancelling export";
        job.controller.abort();
      }
      respond(res, 200, status(job)); return true;
    }
    if (match[2] === "download" && req.method === "GET") {
      if (job.state !== "ready" || !job.output) { respond(res, 409, { error: "Video is not ready" }); return true; }
      const stat = await fs.stat(job.output).catch(() => null);
      if (!stat) { respond(res, 404, { error: "Video file is missing" }); return true; }
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${downloadName(job)}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      createReadStream(job.output).pipe(res);
      return true;
    }
    respond(res, 405, { error: "Method not allowed" }); return true;
  }

  return { handle, jobs };
}
