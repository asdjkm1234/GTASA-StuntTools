import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, createReadStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const MAX_CSV_BYTES = 16 * 1024 * 1024;
const MAX_SECONDS = 2 * 60 * 60;
const JOB_TTL_MS = 60 * 60 * 1000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CSV_NAME = /^flight_[A-Za-z0-9._-]+\.csv$/i;
const jobRoute = new RegExp(`^/video-export/(${UUID})(?:/(cancel|download))?$`);
const sourceRoute = new RegExp(`^/video-export/source/(${UUID})\\.csv$`);

/** Recorder filenames only: a flat `flight_*.csv` basename, no separators or Windows stream syntax. */
function validCsvName(value) {
  return typeof value === "string" && CSV_NAME.test(value) && path.basename(value) === value;
}

/** The optional voice-over is a WAV beside the recording with the same basename, never outside recordingsRoot. */
function sameBasenameWav(filename, root) {
  if (!validCsvName(filename)) return null;
  const candidate = path.join(root, filename.replace(/\.csv$/i, ".wav"));
  return path.dirname(path.resolve(candidate)) === path.resolve(root) ? candidate : null;
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
  return { id: job.id, state: job.state, message: job.message, progress: job.progress,
    frame: job.frame, totalFrames: job.totalFrames, audio: job.audio, downloadUrl: job.state === "ready" ? `/video-export/${job.id}/download` : null };
}

/**
 * Browser contract supplied by the replay app when ?videoExport=1:
 * window.__flightVideoExport.ready() -> Promise<{ duration: seconds }>
 * window.__flightVideoExport.renderFrame(seconds) -> Promise<void>
 * ready waits for the selected recording, aircraft and pak to be renderable;
 * renderFrame pauses real-time playback, seeks absolute time, submits a full frame,
 * and resolves only after presentation. The app owns export layout: current operation
 * panels hidden, analysis HUD visible, canvas fitting the 1920x1080 viewport.
 */
async function openReplayRenderer({ sourceUrl, executablePath, opensaRoot, signal }) {
  if (!executablePath || !existsSync(executablePath)) throw new Error("Chrome or Edge was not found");
  const requireFromOpensa = createRequire(path.join(opensaRoot, "package.json"));
  let chromium;
  try { ({ chromium } = requireFromOpensa("playwright")); }
  catch { throw new Error("Playwright is not installed in tools/opensa/node_modules"); }
  const profile = await fs.mkdtemp(path.join(tmpdir(), "stunt-video-browser-"));
  let context;
  try {
    context = await withAbort(chromium.launchPersistentContext(profile, {
      executablePath, headless: false, viewport: { width: WIDTH, height: HEIGHT },
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
    return {
      duration: ready?.duration,
      async frameAt(seconds) {
        assertActive(signal);
        await withAbort(page.evaluate((time) => globalThis.__flightVideoExport.renderFrame(time), seconds), signal);
        return withAbort(page.screenshot({ type: "png", animations: "disabled", timeout: 60_000 }), signal);
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

function writeFrame(stream, png, signal) {
  assertActive(signal);
  return new Promise((resolve, reject) => {
    const failed = (error) => { cleanup(); reject(error); };
    const drained = () => { cleanup(); resolve(); };
    const cleanup = () => { stream.off("error", failed); stream.off("drain", drained); };
    stream.once("error", failed);
    try {
      if (stream.write(png)) { cleanup(); resolve(); }
      else stream.once("drain", drained);
    } catch (error) { failed(error); }
  });
}

function runFfmpeg(job, ffmpegExecutable, wavPath, outputPath) {
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS),
    "-vcodec", "png", "-i", "pipe:0"];
  if (wavPath) args.push("-i", wavPath);
  args.push("-frames:v", String(job.totalFrames), "-vf", `scale=${WIDTH}:${HEIGHT}:flags=fast_bilinear`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p");
  if (wavPath) args.push("-af", "apad", "-c:a", "aac", "-b:a", "192k", "-t", String(job.totalFrames / FPS));
  else args.push("-an");
  args.push("-movflags", "+faststart", outputPath);
  const child = spawn(ffmpegExecutable, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}: ${stderr.trim()}`)));
  });
  // Keep a failed encoder from becoming an unhandled rejection while the browser is still taking frames.
  completion.catch(() => {});
  return { child, completion };
}

export function createVideoExporter({ origin, recordingsRoot, opensaRoot, chromiumPath,
  ffmpegExecutable = "ffmpeg", outputRoot = path.join(tmpdir(), "GTASA-StuntTools-video-exports"),
  rendererFactory = openReplayRenderer }) {
  const jobs = new Map();
  let running = null;

  async function run(job) {
    let renderer;
    let ffmpeg;
    const output = path.join(outputRoot, `${job.id}.mp4`);
    try {
      const recording = `/video-export/source/${job.id}.csv`;
      const sourceUrl = `${origin}/opensa/flight-replay.html?recording=${encodeURIComponent(recording)}&pak=${encodeURIComponent(job.pakBase)}&videoExport=1`;
      renderer = await rendererFactory({ sourceUrl, executablePath: chromiumPath, opensaRoot, signal: job.controller.signal });
      assertActive(job.controller.signal);
      const duration = Number(renderer.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS) throw new Error("Recording duration must be between 0 and 2 hours");
      job.totalFrames = Math.max(1, Math.ceil(duration * FPS));
      job.state = "rendering";
      job.message = "Rendering replay frames";
      await fs.mkdir(outputRoot, { recursive: true });
      let wavPath = null;
      const candidate = sameBasenameWav(job.filename, recordingsRoot);
      if (candidate) {
        const info = await fs.lstat(candidate).catch(() => null);
        if (info?.isFile()) wavPath = candidate;
      }
      job.audio = Boolean(wavPath);
      ffmpeg = runFfmpeg(job, ffmpegExecutable, wavPath, output);
      job.controller.signal.addEventListener("abort", () => ffmpeg.child.kill(), { once: true });
      for (let frame = 0; frame < job.totalFrames; frame += 1) {
        assertActive(job.controller.signal);
        const png = await renderer.frameAt(frame / FPS);
        if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
          throw new Error("Replay returned an invalid PNG frame");
        }
        await writeFrame(ffmpeg.child.stdin, png, job.controller.signal);
        job.frame = frame + 1;
        job.progress = Math.floor((job.frame / job.totalFrames) * 95);
      }
      job.state = "encoding";
      job.message = "Finishing MP4";
      ffmpeg.child.stdin.end();
      await ffmpeg.completion;
      assertActive(job.controller.signal);
      job.state = "ready";
      job.message = "Video ready";
      job.progress = 100;
      job.output = output;
    } catch (error) {
      if (ffmpeg) { ffmpeg.child.stdin.destroy(); ffmpeg.child.kill(); await ffmpeg.completion.catch(() => {}); }
      await fs.rm(output, { force: true }).catch(() => {});
      job.state = job.controller.signal.aborted || error?.name === "AbortError" ? "cancelled" : "failed";
      job.message = job.state === "cancelled" ? "Export cancelled" : (error instanceof Error ? error.message : String(error));
    } finally {
      if (renderer) await renderer.close().catch(() => {});
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
      const id = randomUUID();
      await pruneFinishedJobs();
      const job = { id, csv: input.csv, filename: input.filename ?? null, pakBase,
        state: "starting", message: "Starting video export", progress: 0, frame: 0, totalFrames: 0,
        audio: false, output: null, finishedAt: null, controller: new AbortController() };
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
