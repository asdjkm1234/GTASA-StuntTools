import { readFileSync } from 'node:fs';

/**
 * What the slow frames of a FIELD DRIVE actually were — a census of the `[slow]` lines the game prints
 * itself for every frame over `SLOW_FRAME_MS` (`perfLogs = IS_DEV`, so any dev run has them). Input is a
 * browser console export, not a harness log: this is the tool for the runs a human drives.
 *
 * It answers the three questions a drive is run to settle, and nothing else:
 *   1. did the per-type car cost (091) ever land on a slow frame — `vehicle-osm` / `vehicle-model` spans;
 *   2. is `other`/`unattributed` the GC tail or the CPU waiting on the GPU — compare `gpu` on the same line;
 *   3. does the attribution still add up — a NEGATIVE `unattributed` means a span is being subtracted twice
 *      (`docs/restrictions/architecture.md`), and nothing else in the repo catches that.
 *
 * Run: `npx tsx scripts/debug/slow-frame-census.ts <console-export.log> [--worst 8]`
 */
const GPU_BOUND_MS = 8;
const WORST_DEFAULT = 8;

interface SlowFrame {
  cells: number;
  collision: number;
  draws: number;
  frameMs: number;
  gpuMs: number;
  otherMs: number;
  renderMs: number;
  /** The named spans of this frame, `unattributed` removed (it is reported on its own). */
  spans: string;
  streamMs: number;
  unattributedMs: number;
}

/** The block that owns the frame — `other` covers both the GC tail and a wait on the GPU, so it is not a verdict. */
function dominant(frame: SlowFrame): string {
  const blocks: readonly [string, number][] = [
    ['collision', frame.collision],
    ['other', frame.otherMs],
    ['render', frame.renderMs],
    ['stream', frame.streamMs],
  ];

  return [...blocks].sort((a, b) => b[1] - a[1])[0][0];
}

function field(line: string, pattern: RegExp): number {
  const match = pattern.exec(line);

  return match === null ? 0 : Number(match[1]);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parse(line: string): SlowFrame {
  return {
    cells: field(line, /cells (\d+)/),
    collision: field(line, /collision ([\d.]+)/),
    draws: field(line, /draws (\d+)/),
    frameMs: field(line, /frame ([\d.]+)/),
    gpuMs: field(line, /gpu ([\d.]+)/),
    otherMs: field(line, /other ([\d.]+)/),
    renderMs: field(line, /render ([\d.]+)/),
    spans: (/other [\d.]+ \(([^)]*)\)/.exec(line)?.[1] ?? '').replace(/·?\s*unattributed -?[\d.]+/, '').trim(),
    streamMs: field(line, /stream ([\d.]+)/),
    unattributedMs: field(line, /unattributed (-?[\d.]+)/),
  };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function spanNames(frames: readonly SlowFrame[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const frame of frames) {
    for (const part of frame.spans.split('·')) {
      const name = part.trim().split(' ')[0];
      if (name.length > 0) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }

  return counts;
}

const [path, ...rest] = process.argv.slice(2);
if (path === undefined) {
  console.error('usage: slow-frame-census.ts <console-export.log> [--worst N]');
  process.exit(1);
}
const worstCount = Number(rest[rest.indexOf('--worst') + 1]) || WORST_DEFAULT;
const frames = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.includes('[slow]'))
  .map(parse);

if (frames.length === 0) {
  console.error(`no [slow] lines in ${path} — was the console opened before the run, and is this a dev build?`);
  process.exit(1);
}

const frameMs = frames.map((frame) => frame.frameMs);
console.log(`slow frames: ${frames.length} (over the game's own SLOW_FRAME_MS threshold)`);
console.log(
  `frame ms: min ${Math.min(...frameMs).toFixed(1)} · p50 ${percentile(frameMs, 0.5).toFixed(1)} · ` +
    `p90 ${percentile(frameMs, 0.9).toFixed(1)} · max ${Math.max(...frameMs).toFixed(1)}`,
);

const owners = new Map<string, number>();
for (const frame of frames) {
  owners.set(dominant(frame), (owners.get(dominant(frame)) ?? 0) + 1);
}
console.log(
  'dominant block:',
  [...owners]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ${count}`)
    .join(' · '),
);

// Q2 — is `other` the GPU or the GC? A frame whose GPU pass dwarfs its CPU render was waiting, not collecting.
const gpuBound = frames.filter((frame) => frame.gpuMs > GPU_BOUND_MS);
console.log(
  `gpu pass: mean ${mean(frames.map((frame) => frame.gpuMs)).toFixed(2)} ms · ` +
    `max ${Math.max(...frames.map((frame) => frame.gpuMs)).toFixed(2)} · ` +
    `over ${GPU_BOUND_MS} ms on ${gpuBound.length}/${frames.length} frames ` +
    `(cpu render mean ${mean(frames.map((frame) => frame.renderMs)).toFixed(2)} ms)`,
);

// Q1 — did any named work land on a slow frame at all?
const named = frames.filter((frame) => frame.spans.length > 0);
const counts = spanNames(named);
console.log(
  `frames carrying a named span: ${named.length}` +
    (counts.size === 0
      ? ''
      : ` — ${[...counts]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => `${name} ×${count}`)
          .join(' · ')}`),
);

// Q3 — does the attribution add up?
const negative = frames.filter((frame) => frame.unattributedMs < 0);
if (negative.length > 0) {
  console.log(
    `NEGATIVE unattributed on ${negative.length} frames (worst ${Math.min(...negative.map((f) => f.unattributedMs)).toFixed(1)}) ` +
      '— a span is subtracted twice; see docs/restrictions/architecture.md',
  );
}

console.log(`\nworst ${worstCount} frames:`);
for (const frame of [...frames].sort((a, b) => b.frameMs - a.frameMs).slice(0, worstCount)) {
  console.log(
    `  ${frame.frameMs.toFixed(1)} ms · gpu ${frame.gpuMs.toFixed(2)} · render ${frame.renderMs.toFixed(1)} · ` +
      `stream ${frame.streamMs.toFixed(1)} · collision ${frame.collision.toFixed(1)} · other ${frame.otherMs.toFixed(1)} ` +
      `(unattributed ${frame.unattributedMs.toFixed(1)}) · draws ${frame.draws} · cells ${frame.cells}` +
      (frame.spans.length > 0 ? ` · [${frame.spans}]` : ''),
  );
}
