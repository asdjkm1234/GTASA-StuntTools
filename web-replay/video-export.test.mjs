import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import { after, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createVideoExporter } from "./video-export.mjs";

const FPS = 30;
const DURATION = 0.2;
const EXPECTED_FRAMES = Math.ceil(DURATION * FPS);
const WIDTH = 1920;
const HEIGHT = 1080;
const FRAME_BYTES = WIDTH * HEIGHT * 4;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PERF_SCRIPT = path.join(REPO_ROOT, "tools", "opensa", "scripts", "test-export-perf.mjs");
const OPENSA_ROOT = path.join(REPO_ROOT, "tools", "opensa");

const temporary = await fs.mkdtemp(path.join(tmpdir(), "stunt-video-test-"));
const recordingsRoot = path.join(temporary, "recordings");
const outputRoot = path.join(temporary, "exports");
await fs.mkdir(recordingsRoot, { recursive: true });

// The pipeline carries RAW RGBA frames, never PNG. The fixture frames are exactly one 1920x1080 RGBA buffer
// each (so FFmpeg's rawvideo input can consume them), and `makePngFrame` deliberately fabricates a buffer the
// size of a frame whose first bytes ARE the PNG signature — the negative case that proves the exporter's
// PNG instrumentation actually fires instead of being a flag nothing sets.
const rawFrame = Buffer.alloc(FRAME_BYTES, 0x20);
rawFrame.writeUInt32LE(0x12345678, 4);
const pngFrame = Buffer.alloc(FRAME_BYTES);
Buffer.from(PNG_SIGNATURE).copy(pngFrame, 0);

function makeWav(seconds, sampleRate = 8000) {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** The synthesized track the mock renderer hands the exporter when no recorded WAV exists (todo 19). */
const synthesizedWav = makeWav(DURATION);

function probe(name, args) {
  const result = spawnSync(name, args, { stdio: "ignore" });
  return !result.error && result.status === 0;
}
function ffprobeJson(args) {
  const result = spawnSync("ffprobe", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
/** Decode the muxed audio to RAW PCM and hash it: determinism is proven on samples, not on a codec name. */
function hashDecodedAudio(file) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0:a:0",
    "-f", "s16le", "-"], { maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.ok(result.stdout.length > 0, "decoded audio must not be empty");
  return createHash("sha256").update(result.stdout).digest("hex");
}

const hasFfmpeg = probe("ffmpeg", ["-version"]) && probe("ffprobe", ["-version"]);
const skipWithoutFfmpeg = hasFfmpeg ? false : "ffmpeg/ffprobe not found on PATH";

/**
 * The in-page copy-mux path needs a real Annex-B H.264 elementary stream to mux (FFmpeg is told `-c:v copy`,
 * so it never invents frames). Generate it once with libx264 from a synthetic source; the mock page hands the
 * bytes over as an encoded chunk, exactly like WebCodecs `EncodedVideoChunk` output.
 */
function encodeAnnexb(frames, fps) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", `testsrc=size=${WIDTH}x${HEIGHT}:rate=${fps}:duration=${frames / fps}`,
    "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-g", String(fps), "-f", "h264", "-"],
    { maxBuffer: 256 * 1024 * 1024 });
  return !result.error && result.status === 0 && result.stdout.length > 0 ? result.stdout : null;
}
const hasLibx264 = hasFfmpeg &&
  (spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "").includes("libx264");
const annexbStream = hasLibx264 ? encodeAnnexb(EXPECTED_FRAMES, FPS) : null;
const skipWithoutH264 = annexbStream ? false : "libx264 unavailable for the in-page H.264 fixture";

const csv = "# FlightRecorder version=7\nlocal_timestamp,x,y,z\n2026-01-01T00:00:00.000,1,2,3\n";

/**
 * "fast" completes quickly; "cancel" is slow enough to interrupt after the first frame; "error" throws from
 * the frame source; "png" returns a PNG-signature buffer that the raw-frame guard must refuse.
 */
let rendererMode = "fast";
let closedRenderers = 0;
let renderedTimes = [];
let lastRendererOptions = null;

const compositor = { backend: "mock-compositor", height: HEIGHT, pixelFormat: "rgba", visible: false, width: WIDTH };

let exporter;
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (exporter && await exporter.handle(req, res, pathname)) return;
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

exporter = createVideoExporter({
  origin,
  recordingsRoot,
  opensaRoot: temporary,
  chromiumPath: "mock",
  outputRoot,
  rendererFactory: async (options) => {
    lastRendererOptions = options;
    if (rendererMode === "cancel") {
      return {
        compositor,
        duration: 5,
        audioWav: synthesizedWav,
        frameAt: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return rawFrame;
        },
        close: async () => { closedRenderers += 1; },
      };
    }
    if (rendererMode === "no-audio") {
      // The page exposed renderAudio but produced no synthesized track: the synth-only export must fail, never
      // fall back to the recorded WAV.
      return { compositor, duration: DURATION, audioWav: null, frameAt: async () => rawFrame, close: async () => { closedRenderers += 1; } };
    }
    if (rendererMode.startsWith("in-page")) {
      let sentStream = false;
      return {
        compositor,
        duration: DURATION,
        audioWav: synthesizedWav,
        hasInPageEncode: true,
        async beginEncode() {
          if (rendererMode === "in-page-unsupported") {
            return { adapter: "mock-arc", codec: null, config: null, hardwareAcceleration: "prefer-hardware",
              mediaCapabilities: null, reason: "test rejects hardware H.264", supported: false };
          }
          return { adapter: "mock-arc", codec: "avc1.64002A",
            config: { avc: { format: "annexb" }, codec: "avc1.64002A", framerate: FPS, hardwareAcceleration: "prefer-hardware", height: HEIGHT, latencyMode: "quality", width: WIDTH },
            hardwareAcceleration: "prefer-hardware", mediaCapabilities: { powerEfficient: true, smooth: true, supported: true }, reason: null, supported: true };
        },
        async encodeFrames(startFrame, count) {
          if (rendererMode === "in-page-fail") throw new Error("forced in-page encoder error");
          const chunks = annexbStream && !sentStream ? [annexbStream.toString("base64")] : [];
          sentStream = true;
          return { bytes: annexbStream?.length ?? 0, chunks, error: null, frames: startFrame + count };
        },
        async endEncode() {
          return { bytes: 0, chunks: [], error: null, framesEncoded: EXPECTED_FRAMES, totalBytes: annexbStream?.length ?? 0, totalChunks: annexbStream ? 1 : 0 };
        },
        frameAt: async () => rawFrame,
        close: async () => { closedRenderers += 1; },
      };
    }
    return {
      compositor,
      duration: DURATION,
      audioWav: synthesizedWav,
      frameAt: async (seconds) => {
        if (rendererMode === "error") throw new Error("forced renderer error");
        if (rendererMode === "png") return pngFrame;
        renderedTimes.push(seconds);
        return rawFrame;
      },
      close: async () => { closedRenderers += 1; },
    };
  },
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
});

async function startExport(body, requestOrigin = origin) {
  return fetch(`${origin}/video-export`, {
    method: "POST",
    headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForJob(id, expectedState) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`${origin}/video-export/${id}`);
    const job = await response.json();
    if (expectedState ? job.state === expectedState : ["ready", "failed", "cancelled"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Export did not reach ${expectedState ?? "a terminal state"}`);
}

async function downloadVideo(job) {
  const response = await fetch(`${origin}${job.downloadUrl}`);
  assert.equal(response.status, 200);
  const file = path.join(temporary, `${job.id}.mp4`);
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

const outputExists = async (id) =>
  fs.stat(path.join(outputRoot, `${id}.mp4`)).then(() => true, () => false);

describe("video export HTTP contract", () => {
  describe("negative cases", () => {
    it("rejects unsafe or malformed requests before starting a job", async () => {
      const body = { csv, filename: "flight_test.csv" };
      assert.equal((await startExport(body, "http://evil.invalid")).status, 403);

      const invalidJson = await fetch(`${origin}/video-export`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "not json",
      });
      assert.equal(invalidJson.status, 400);

      assert.equal((await startExport({ csv: "no header" })).status, 400);
      assert.equal((await startExport({ csv, filename: "../escape.csv" })).status, 400);
      assert.equal((await startExport({ csv, filename: "flight_a:b.csv" })).status, 400);
      assert.equal((await startExport({ csv, filename: "recording.csv" })).status, 400);
      assert.equal((await startExport({ csv, pakBase: "/map-pak/../secret" })).status, 400);
      assert.equal((await startExport({ csv, pakBase: "/route-pak/not-a-uuid" })).status, 400);
      assert.equal((await startExport({ csv, fps: 61 })).status, 400);
      assert.equal((await startExport({ csv, fps: "60" })).status, 400);
      assert.equal((await startExport({ csv, audioMode: "recorded" })).status, 400);
      assert.equal((await startExport({ csv, view: { mode: "cockpit-look",
        cockpitLookPose: { yaw: 0, pitch: 0, lateral: 2, longitudinal: 0, height: 0 } } })).status, 400);
      assert.equal(await exporter.jobs.size, 0);
    });

    it("rejects --fps 61 through the perf harness CLI and accepts 30 fps", () => {
      const rejected = spawnSync(process.execPath, [PERF_SCRIPT, "--fps", "61"],
        { cwd: OPENSA_ROOT, encoding: "utf8", windowsHide: true });
      assert.equal(rejected.status, 2, rejected.stderr);
      assert.match(rejected.stderr, /unsupported frame rate: 61/);
      assert.ok(!rejected.stdout.includes("pipeline lane"),
        `an unsupported rate must fail before any export work starts (stdout: ${rejected.stdout})`);
      const accepted = spawnSync(process.execPath, [PERF_SCRIPT, "--fps", "30", "--help"],
        { cwd: OPENSA_ROOT, encoding: "utf8", windowsHide: true });
      assert.equal(accepted.status, 0, accepted.stderr);
      assert.match(accepted.stdout, /supported: 30, 60, 120/);
    });

    it("rejects unknown jobs, unknown routes and unsupported methods", async () => {
      const unknown = "00000000-0000-4000-8000-000000000000";
      assert.equal((await fetch(`${origin}/video-export/${unknown}`)).status, 404);
      assert.equal((await fetch(`${origin}/video-export/${unknown}/download`)).status, 404);
      const cancelUnknown = await fetch(`${origin}/video-export/${unknown}/cancel`, {
        method: "POST",
        headers: { Origin: origin },
      });
      assert.equal(cancelUnknown.status, 404);
      assert.equal((await fetch(`${origin}/video-export/source/${unknown}.csv`)).status, 404);
      assert.equal((await fetch(`${origin}/video-export/not-a-route`)).status, 404);
      assert.equal((await fetch(`${origin}/video-export`)).status, 405);
    });

    it("records an explicit fallback when the page rejects the WebCodecs hardware config", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "in-page-unsupported";
      const start = await startExport({ csv, filename: "flight_inpage_unsupported.csv" });
      assert.equal(start.status, 202);
      const job = await waitForJob((await start.json()).id);
      assert.equal(job.state, "ready", job.message);
      // The rejection is REPORTED (mode/reason), never silent, and the raw QSV lane actually ran.
      assert.equal(job.videoEncode.mode, "raw");
      assert.equal(job.videoEncode.supported, false);
      assert.equal(job.videoEncode.fallback, true);
      assert.match(job.videoEncode.fallbackReason, /test rejects hardware H\.264/);
      assert.equal(job.frameStream.inputFormat, "rawvideo");
      assert.equal(job.frameStream.frames, EXPECTED_FRAMES);
      assert.ok(job.encoderArgs.includes("h264_qsv"));
      console.log(`[t28] hardware rejection: mode=${job.videoEncode.mode} fallback=${job.videoEncode.fallback} ` +
        `reason="${job.videoEncode.fallbackReason}" input=${job.frameStream.inputFormat}`);
    });

    it("falls back explicitly to the raw lane when the in-page encoder errors mid-stream", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "in-page-fail";
      const start = await startExport({ csv, filename: "flight_inpage_midstream_fail.csv" });
      assert.equal(start.status, 202);
      const job = await waitForJob((await start.json()).id);
      assert.equal(job.state, "ready", job.message);
      // The encoder failure is named, and the whole clip was re-run on the raw lane (a QSV encoder, not copy).
      assert.equal(job.videoEncode.mode, "raw-fallback");
      assert.equal(job.videoEncode.fallback, true);
      assert.match(job.videoEncode.fallbackReason, /forced in-page encoder error/);
      assert.equal(job.frameStream.inputFormat, "rawvideo");
      assert.equal(job.frameStream.frames, EXPECTED_FRAMES);
      assert.ok(job.encoderArgs.includes("h264_qsv"));
      assert.ok(!job.encoderArgs.includes("copy"));
      console.log(`[t28] mid-stream fallback: mode=${job.videoEncode.mode} fallback=${job.videoEncode.fallback} ` +
        `reason="${job.videoEncode.fallbackReason}" input=${job.frameStream.inputFormat} argsCopy=${job.encoderArgs.includes("copy")}`);
    });

    it("fails loudly instead of muxing the recorded WAV when synthesized audio is requested but unavailable", { skip: skipWithoutFfmpeg }, async () => {
      // A recorded WAV with the same basename EXISTS beside the CSV: on the legacy priority it would have been
      // muxed. With `audioMode: 'synth'` it must be IGNORED and the missing synthesis must fail the job.
      rendererMode = "no-audio";
      await fs.writeFile(path.join(recordingsRoot, "flight_synth_unavailable.wav"), makeWav(DURATION));
      const start = await startExport({ csv, filename: "flight_synth_unavailable.csv", fps: 30, audioMode: "synth" });
      assert.equal(start.status, 202);
      const { id } = await start.json();
      const job = await waitForJob(id);
      assert.equal(job.state, "failed");
      assert.equal(job.audioMode, "synth");
      assert.match(job.message, /synthesized audio was requested but unavailable/);
      assert.equal(job.audio, false, "no audio track may be muxed when synthesis failed");
      assert.equal(job.audioSource, null);
      assert.equal(job.encoderExited, false, "the encoder never started");
      assert.equal(await outputExists(id), false);
      console.log(`[t34] synth unavailable: state=${job.state} audio=${job.audio} audioSource=${job.audioSource} message="${job.message}"`);
    });
  });

  describe("positive cases", () => {
    it("exports exact 1920x1080 30 fps H.264/AAC from raw composite frames and the same-basename WAV", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "fast";
      renderedTimes = [];
      const closedBefore = closedRenderers;
      await fs.writeFile(path.join(recordingsRoot, "flight_test.wav"), makeWav(DURATION));

      const start = await startExport({ csv, filename: "flight_test.csv",
        view: { mode: "first-person", audioTuning: { front: 0.35, presenceHighHz: 650 } } });
      assert.equal(start.status, 202);
      const { id } = await start.json();
      const job = await waitForJob(id);
      assert.equal(job.state, "ready", job.message);
      assert.equal(job.totalFrames, EXPECTED_FRAMES);
      assert.equal(job.audio, true);
      assert.equal(job.progress, 100);
      assert.equal(job.downloadUrl, `/video-export/${id}/download`);
      assert.equal(job.encoderExited, true);
      assert.deepEqual(renderedTimes, Array.from({ length: EXPECTED_FRAMES }, (_, frame) => frame / FPS));
      assert.equal(closedRenderers, closedBefore + 1);

      // NO PNG, PROVEN BY INSTRUMENTATION: the pipe was rawvideo/rgba, it carried exactly one full RGBA
      // buffer per frame, FFmpeg was never told to read an image, and the frame source never showed a window.
      assert.equal(job.frameStream.inputFormat, "rawvideo");
      assert.equal(job.frameStream.pixelFormat, "rgba");
      assert.equal(job.frameStream.pngSignatureSeen, false);
      assert.equal(job.frameStream.frames, EXPECTED_FRAMES);
      assert.equal(job.frameStream.bytes, EXPECTED_FRAMES * FRAME_BYTES);
      assert.ok(job.encoderArgs.includes("rawvideo"));
      assert.ok(!job.encoderArgs.some((argument) => /png/i.test(argument)));
      assert.equal(lastRendererOptions.visible, false);
      const exportedView = JSON.parse(new URL(lastRendererOptions.sourceUrl).searchParams.get("exportView"));
      assert.deepEqual(exportedView.audioTuning, { front: 0.35, presenceHighHz: 650 });
      assert.equal(job.compositor.backend, "mock-compositor");
      console.log(`[t23] raw-frame pipe: input=${job.frameStream.inputFormat}/${job.frameStream.pixelFormat} ` +
        `frames=${job.frameStream.frames} bytes=${job.frameStream.bytes} pngSignatureSeen=${job.frameStream.pngSignatureSeen} ` +
        `encoderExited=${job.encoderExited} rendererVisible=${lastRendererOptions.visible} argsPng=${job.encoderArgs.some((a) => /png/i.test(a))}`);

      const file = await downloadVideo(job);
      const streams = ffprobeJson(["-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames", "-of", "json", file]).streams;
      assert.equal(streams.length, 1);
      assert.equal(streams[0].codec_name, "h264");
      assert.equal(streams[0].width, 1920);
      assert.equal(streams[0].height, 1080);
      assert.equal(streams[0].r_frame_rate, "30/1");
      assert.equal(Number(streams[0].nb_read_frames), EXPECTED_FRAMES);
      const audio = ffprobeJson(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
        "-of", "json", file]).streams;
      assert.equal(audio[0]?.codec_name, "aac");

      const source = await fetch(`${origin}/video-export/source/${id}.csv`);
      assert.equal(source.status, 200);
      assert.equal(await source.text(), csv);
    });

    it("keeps the 30 fps path working when the rate is requested explicitly", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "fast";
      renderedTimes = [];
      const closedBefore = closedRenderers;
      const start = await startExport({ csv, filename: "flight_explicit_30.csv", fps: 30 });
      assert.equal(start.status, 202);
      const { id } = await start.json();
      const job = await waitForJob(id);
      assert.equal(job.state, "ready", job.message);
      assert.equal(job.fps, 30);
      assert.equal(job.totalFrames, EXPECTED_FRAMES);
      assert.equal(job.frameStream.fps, 30);
      assert.equal(job.audio, true);
      assert.equal(job.audioSource, "synthesized");
      assert.deepEqual(renderedTimes, Array.from({ length: EXPECTED_FRAMES }, (_, frame) => frame / FPS));
      assert.equal(closedRenderers, closedBefore + 1);

      // Primary-path reporting: the frame source was asked for a headless (non-visible) renderer, the pipe was
      // rawvideo/rgba, no image argument was ever handed to FFmpeg, and the compositor backend is surfaced.
      assert.equal(lastRendererOptions.visible, false);
      assert.equal(job.compositor.visible, false);
      assert.equal(job.compositor.backend, "mock-compositor");
      assert.equal(job.compositor.width, WIDTH);
      assert.equal(job.compositor.height, HEIGHT);
      assert.equal(job.frameStream.inputFormat, "rawvideo");
      assert.equal(job.frameStream.pixelFormat, "rgba");
      assert.equal(job.frameStream.pngSignatureSeen, false);
      assert.equal(job.frameStream.frames, EXPECTED_FRAMES);
      assert.equal(job.frameStream.bytes, EXPECTED_FRAMES * FRAME_BYTES);
      assert.ok(job.encoderArgs.includes("rawvideo") && job.encoderArgs.includes("rgba"));
      assert.ok(!job.encoderArgs.some((argument) => /png/i.test(argument)));
      assert.ok(job.encoderArgs.includes("-r") && job.encoderArgs[job.encoderArgs.indexOf("-r") + 1] === "30");

      const file = await downloadVideo(job);
      const streams = ffprobeJson(["-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=avg_frame_rate,r_frame_rate,nb_read_frames", "-of", "json", file]).streams;
      assert.equal(streams[0].r_frame_rate, "30/1");
      assert.equal(streams[0].avg_frame_rate, "30/1");
      assert.equal(Number(streams[0].nb_read_frames), EXPECTED_FRAMES);
      const audio = ffprobeJson(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
        "-of", "json", file]).streams;
      assert.equal(audio[0]?.codec_name, "aac");
      console.log(`[t26] explicit 30 fps: state=${job.state} fps=${job.fps} avg=${streams[0].avg_frame_rate} ` +
        `frames=${streams[0].nb_read_frames} backend=${job.compositor.backend} visible=${job.compositor.visible} ` +
        `input=${job.frameStream.inputFormat}/${job.frameStream.pixelFormat}`);
    });

    it("exports at 60 fps when that rate is requested and echoes it in the status payload", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "fast";
      renderedTimes = [];
      const closedBefore = closedRenderers;
      const fps = 60;
      const expectedFrames = Math.ceil(DURATION * fps);
      const start = await startExport({ csv, filename: "flight_explicit_60.csv", fps });
      assert.equal(start.status, 202);
      const { id } = await start.json();
      const job = await waitForJob(id);
      assert.equal(job.state, "ready", job.message);
      assert.equal(job.fps, fps);
      assert.equal(job.totalFrames, expectedFrames);
      assert.equal(job.frameStream.fps, fps);
      assert.equal(job.frameStream.frames, expectedFrames);
      assert.deepEqual(renderedTimes, Array.from({ length: expectedFrames }, (_, frame) => frame / fps));
      assert.ok(job.encoderArgs.includes("-r") && job.encoderArgs[job.encoderArgs.indexOf("-r") + 1] === "60");
      assert.equal(closedRenderers, closedBefore + 1);

      const file = await downloadVideo(job);
      const streams = ffprobeJson(["-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=avg_frame_rate,r_frame_rate,nb_read_frames", "-of", "json", file]).streams;
      assert.equal(streams[0].r_frame_rate, "60/1");
      assert.equal(streams[0].avg_frame_rate, "60/1");
      assert.equal(Number(streams[0].nb_read_frames), expectedFrames);
      console.log(`[t30] explicit 60 fps: state=${job.state} fps=${job.fps} avg=${streams[0].avg_frame_rate} ` +
        `frames=${streams[0].nb_read_frames}`);
    });

    it("copy-muxes in-page encoded H.264 chunks without re-encoding", { skip: skipWithoutH264 }, async () => {
      rendererMode = "in-page";
      const start = await startExport({ csv, filename: "flight_inpage_copy.csv" });
      assert.equal(start.status, 202);
      const job = await waitForJob((await start.json()).id);
      assert.equal(job.state, "ready", job.message);
      // The in-page hardware encoder was used: its reported config/adapter back the hardware claim, and the
      // transfer carried ENCODED chunks (kilobytes), never a raw 8.3 MB frame.
      assert.equal(job.videoEncode.mode, "in-page-hardware");
      assert.equal(job.videoEncode.supported, true);
      assert.equal(job.videoEncode.fallback, false);
      assert.equal(job.hardwareEncoder, true);
      assert.equal(job.encoderInitEvidence.platform, "webcodecs");
      assert.equal(job.encoderInitEvidence.proof, "webcodecs-power-efficient");
      assert.equal(job.encoderInitEvidence.adapter, "mock-arc");
      assert.equal(job.frameStream.inputFormat, "h264");
      assert.equal(job.frameStream.pixelFormat, "yuv420p");
      assert.equal(job.frameStream.pngSignatureSeen, false);
      assert.ok(job.frameStream.chunks >= 1);
      assert.ok(job.frameStream.bytes > 0 && job.frameStream.bytes < FRAME_BYTES,
        `encoded chunks must be far smaller than one raw frame (saw ${job.frameStream.bytes} bytes)`);
      assert.ok(job.encoderArgs.includes("copy"));
      assert.ok(!job.encoderArgs.includes("h264_qsv"));

      const file = await downloadVideo(job);
      const streams = ffprobeJson(["-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames", "-of", "json", file]).streams;
      assert.equal(streams[0].codec_name, "h264");
      assert.equal(streams[0].width, 1920);
      assert.equal(streams[0].height, 1080);
      assert.equal(streams[0].r_frame_rate, "30/1");
      assert.equal(Number(streams[0].nb_read_frames), EXPECTED_FRAMES);
      const audio = ffprobeJson(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
        "-of", "json", file]).streams;
      assert.equal(audio[0]?.codec_name, "aac");
      // Cadence must be EXACT: without an INPUT `-r` FFmpeg derives a non-integer tick from the H.264 VUI and
      // avg_frame_rate drifted to 1024000/17067 on the real stream instead of 30/1.
      assert.equal(streams[0].avg_frame_rate, "30/1");
      console.log(`[t28] in-page copy: mode=${job.videoEncode.mode} proof=${job.encoderInitEvidence.proof} ` +
        `adapter=${job.encoderInitEvidence.adapter} chunks=${job.frameStream.chunks} bytes=${job.frameStream.bytes} ` +
        `frames=${job.frameStream.frames} codec=${streams[0].codec_name} avg=${streams[0].r_frame_rate}`);
    });

    it("produces identical decoded audio across repeated identical exports", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "fast";
      const hashes = [];
      for (let run = 1; run <= 2; run += 1) {
        const start = await startExport({ csv, filename: "flight_deterministic_audio.csv", fps: 30 });
        assert.equal(start.status, 202);
        const job = await waitForJob((await start.json()).id);
        assert.equal(job.state, "ready", job.message);
        assert.equal(job.audioSource, "synthesized");
        hashes.push(hashDecodedAudio(await downloadVideo(job)));
      }
      assert.equal(hashes[0], hashes[1], "two identical exports must mux identical PCM audio");
      console.log(`[t26] deterministic audio: sha256=${hashes[0].slice(0, 16)} across 2 identical 30 fps exports`);
    });

    it("exports with a synthesized audio track when no recorded WAV exists", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "fast";
      const start = await startExport({ csv, filename: "flight_silent.csv" });
      assert.equal(start.status, 202);
      const { id } = await start.json();
      const job = await waitForJob(id);
      assert.equal(job.state, "ready", job.message);
      assert.equal(job.audio, true, "the exporter must mux the renderer's synthesized WAV when no recorded WAV exists");
      assert.equal(job.audioSource, "synthesized");
      assert.equal(job.frameStream.pngSignatureSeen, false);
      assert.equal(job.frameStream.frames, EXPECTED_FRAMES);
      assert.equal(job.frameStream.bytes, EXPECTED_FRAMES * FRAME_BYTES);

      const file = await downloadVideo(job);
      const audio = ffprobeJson(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
        "-of", "json", file]).streams;
      assert.equal(audio[0]?.codec_name, "aac", "the synthesized track must be encoded, not dropped");
      console.log(`[t19] synthesized export: audio=${job.audio} audioSource=${job.audioSource} codec=${audio[0]?.codec_name}`);
    });

    it("uses the synthesized WAV and ignores the same-basename recording when audioMode is synth", { skip: skipWithoutFfmpeg }, async () => {
      // A recorded WAV with the same basename exists, so the legacy priority would mux it. `audioMode: 'synth'`
      // must select the renderer's synthesized WAV instead, and the mux args must name that exact file.
      rendererMode = "fast";
      await fs.writeFile(path.join(recordingsRoot, "flight_synth_priority.wav"), makeWav(DURATION));
      const start = await startExport({ csv, filename: "flight_synth_priority.csv", fps: 30, audioMode: "synth" });
      assert.equal(start.status, 202);
      const { id } = await start.json();
      const job = await waitForJob(id);
      assert.equal(job.state, "ready", job.message);
      assert.equal(job.audioMode, "synth");
      assert.equal(job.audio, true);
      assert.equal(job.audioSource, "synthesized");
      const wavArgs = job.encoderArgs.filter((argument) => typeof argument === "string" && /\.wav$/i.test(argument));
      assert.ok(wavArgs.some((argument) => /\.synthesized\.wav$/i.test(argument)), `mux must read the synthesized WAV (saw ${wavArgs.join(", ")})`);
      assert.ok(!wavArgs.some((argument) => /flight_synth_priority\.wav$/i.test(argument)), `the recorded WAV must not be muxed (saw ${wavArgs.join(", ")})`);

      const file = await downloadVideo(job);
      const audio = ffprobeJson(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
        "-of", "json", file]).streams;
      assert.equal(audio[0]?.codec_name, "aac");
      console.log(`[t34] synth priority: audioSource=${job.audioSource} muxWav=${wavArgs.join(", ")} codec=${audio[0]?.codec_name}`);
    });

    it("cancels a running export, keeps the single-run lock and cleans up output and the encoder", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "cancel";
      const closedBefore = closedRenderers;
      const start = await startExport({ csv, filename: "flight_cancel.csv" });
      assert.equal(start.status, 202);
      const { id } = await start.json();

      const firstFrame = await waitForJob(id, "rendering");
      assert.equal(firstFrame.totalFrames, Math.ceil(5 * FPS));
      assert.equal(firstFrame.frameStream.pngSignatureSeen, false);
      const busy = await startExport({ csv, filename: "flight_test.csv" });
      assert.equal(busy.status, 409);

      // The partial MP4 really exists before the cancel: the last encoder argument is that exact output path
      // and the file on disk has bytes. "Cancel deletes partial output" then means a file that existed, not a
      // file that was never created.
      const partialPath = path.join(outputRoot, `${id}.mp4`);
      let partialBytes = 0;
      let encoderArgs = firstFrame.encoderArgs;
      for (let attempt = 0; attempt < 200 && partialBytes === 0; attempt += 1) {
        encoderArgs = (await (await fetch(`${origin}/video-export/${id}`)).json()).encoderArgs ?? encoderArgs;
        partialBytes = await fs.stat(partialPath).then((stats) => stats.size, () => 0);
        if (partialBytes === 0) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(encoderArgs, "the encoder must have started before the cancel");
      assert.ok(partialBytes > 0, `a partial export must be on disk before the cancel (saw ${partialBytes} bytes)`);
      assert.equal(path.resolve(encoderArgs.at(-1)), path.resolve(partialPath));

      const cancel = await fetch(`${origin}/video-export/${id}/cancel`, { method: "POST", headers: { Origin: origin } });
      assert.equal(cancel.status, 200);
      const cancelled = await waitForJob(id, "cancelled");
      assert.equal(cancelled.message, "Export cancelled");
      assert.equal(cancelled.downloadUrl, null);
      assert.ok(cancelled.frame < cancelled.totalFrames,
        `cancel must interrupt mid-run, not complete it (frame ${cancelled.frame}/${cancelled.totalFrames})`);
      assert.equal(closedRenderers, closedBefore + 1);
      assert.equal(cancelled.encoderExited, true, "the FFmpeg child must be reaped on cancel");
      assert.equal(await outputExists(id), false);
      assert.equal(await fs.stat(partialPath).then(() => true, () => false), false,
        "the partial MP4 observed on disk before the cancel must be deleted");
      console.log(`[t26] cancel: partialBytes=${partialBytes} frame=${cancelled.frame}/${cancelled.totalFrames} ` +
        `encoderExited=${cancelled.encoderExited} outputDeleted=${!(await outputExists(id))}`);
      const download = await fetch(`${origin}/video-export/${id}/download`);
      assert.equal(download.status, 409);
      // Re-run after a cancel: the single-run lock must have been released and a fresh export must succeed.
      rendererMode = "fast";
      const again = await startExport({ csv, filename: "flight_after_cancel.csv" });
      assert.equal(again.status, 202);
      const rerun = await waitForJob((await again.json()).id);
      assert.equal(rerun.state, "ready", rerun.message);
    });

    it("marks the job failed and removes partial output when the frame source throws", async () => {
      rendererMode = "error";
      const start = await startExport({ csv, filename: "flight_renderer_error.csv" });
      assert.equal(start.status, 202);
      const { id } = await start.json();
      const job = await waitForJob(id);
      assert.equal(job.state, "failed");
      assert.match(job.message, /forced renderer error/);
      assert.equal(job.downloadUrl, null);
      assert.equal(job.encoderExited, true);
      assert.equal(await outputExists(id), false);
      assert.equal((await fetch(`${origin}/video-export/${id}/download`)).status, 409);
    });

    it("refuses a PNG-signature frame and records it in the pipeline instrumentation", async () => {
      rendererMode = "png";
      const start = await startExport({ csv, filename: "flight_png_frame.csv" });
      assert.equal(start.status, 202);
      const { id } = await start.json();
      const job = await waitForJob(id);
      assert.equal(job.state, "failed");
      assert.match(job.message, /PNG signature/);
      // The detector really fires: the flag is set AND nothing reached the encoder's frame counters.
      assert.equal(job.frameStream.pngSignatureSeen, true);
      assert.equal(job.frameStream.frames, 0);
      assert.equal(job.frameStream.bytes, 0);
      assert.equal(job.encoderExited, true);
      assert.equal(await outputExists(id), false);
      console.log(`[t23] png detector: state=${job.state} pngSignatureSeen=${job.frameStream.pngSignatureSeen} ` +
        `frames=${job.frameStream.frames} bytes=${job.frameStream.bytes} message="${job.message}"`);
    });
  });
});
