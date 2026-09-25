import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { after, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createVideoExporter } from "./video-export.mjs";

const FPS = 30;
const DURATION = 0.2;
const EXPECTED_FRAMES = Math.ceil(DURATION * FPS);

const temporary = await fs.mkdtemp(path.join(tmpdir(), "stunt-video-test-"));
const recordingsRoot = path.join(temporary, "recordings");
const outputRoot = path.join(temporary, "exports");
await fs.mkdir(recordingsRoot, { recursive: true });

// A deterministic 1x1 RGB PNG so the fixture does not depend on a media tool. The exporter validates the
// PNG signature and FFmpeg scales every frame to the fixed 1920x1080 output.
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}
function makePng(red, green, blue) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.from([0, red, green, blue]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

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

function probe(name, args) {
  const result = spawnSync(name, args, { stdio: "ignore" });
  return !result.error && result.status === 0;
}
function ffprobeJson(args) {
  const result = spawnSync("ffprobe", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const hasFfmpeg = probe("ffmpeg", ["-version"]) && probe("ffprobe", ["-version"]);
const skipWithoutFfmpeg = hasFfmpeg ? false : "ffmpeg/ffprobe not found on PATH";

const png = makePng(0, 0, 255);
const csv = "# FlightRecorder version=7\nlocal_timestamp,x,y,z\n2026-01-01T00:00:00.000,1,2,3\n";

/** "fast" completes quickly; "cancel" is slow enough to interrupt after the first frame. */
let rendererMode = "fast";
let closedRenderers = 0;
let renderedTimes = [];

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
  rendererFactory: async () => {
    if (rendererMode === "cancel") {
      return {
        duration: 5,
        frameAt: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return png;
        },
        close: async () => { closedRenderers += 1; },
      };
    }
    return {
      duration: DURATION,
      frameAt: async (seconds) => { renderedTimes.push(seconds); return png; },
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
      assert.equal(await exporter.jobs.size, 0);
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
  });

  describe("positive cases", () => {
    it("exports exact 1920x1080 30 fps H.264/AAC from the same-basename WAV", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "fast";
      renderedTimes = [];
      const closedBefore = closedRenderers;
      await fs.writeFile(path.join(recordingsRoot, "flight_test.wav"), makeWav(DURATION));

      const start = await startExport({ csv, filename: "flight_test.csv" });
      assert.equal(start.status, 202);
      const { id } = await start.json();
      const job = await waitForJob(id);
      assert.equal(job.state, "ready", job.message);
      assert.equal(job.totalFrames, EXPECTED_FRAMES);
      assert.equal(job.audio, true);
      assert.equal(job.progress, 100);
      assert.equal(job.downloadUrl, `/video-export/${id}/download`);
      assert.deepEqual(renderedTimes, Array.from({ length: EXPECTED_FRAMES }, (_, frame) => frame / FPS));
      assert.equal(closedRenderers, closedBefore + 1);

      const file = await downloadVideo(job);
      const streams = ffprobeJson(["-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_read_frames", "-of", "json", file]).streams;
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

    it("exports without an audio track when no matching WAV exists", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "fast";
      const start = await startExport({ csv, filename: "flight_silent.csv" });
      assert.equal(start.status, 202);
      const { id } = await start.json();
      const job = await waitForJob(id);
      assert.equal(job.state, "ready", job.message);
      assert.equal(job.audio, false);

      const file = await downloadVideo(job);
      const audio = ffprobeJson(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
        "-of", "json", file]).streams;
      assert.equal(audio.length, 0);
    });

    it("cancels a running export, keeps the single-run lock and leaves no file", { skip: skipWithoutFfmpeg }, async () => {
      rendererMode = "cancel";
      const closedBefore = closedRenderers;
      const start = await startExport({ csv, filename: "flight_cancel.csv" });
      assert.equal(start.status, 202);
      const { id } = await start.json();

      const firstFrame = await waitForJob(id, "rendering");
      assert.equal(firstFrame.totalFrames, Math.ceil(5 * FPS));
      const busy = await startExport({ csv, filename: "flight_test.csv" });
      assert.equal(busy.status, 409);

      const cancel = await fetch(`${origin}/video-export/${id}/cancel`, { method: "POST", headers: { Origin: origin } });
      assert.equal(cancel.status, 200);
      const cancelled = await waitForJob(id, "cancelled");
      assert.equal(cancelled.message, "Export cancelled");
      assert.equal(cancelled.downloadUrl, null);
      assert.equal(closedRenderers, closedBefore + 1);
      assert.equal(await fs.stat(path.join(outputRoot, `${id}.mp4`)).then(() => true, () => false), false);
      const download = await fetch(`${origin}/video-export/${id}/download`);
      assert.equal(download.status, 409);
    });
  });
});
