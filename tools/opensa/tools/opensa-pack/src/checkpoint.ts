/**
 * Per-chunk checkpoints of a chunked convert (pmb plan 006, phase 2). After each weld chunk the convert
 * writes everything a later chunk depends on — the welded cell entries so far, the report, the UV-anim
 * registry, the water grid, and the texture planner's INCREMENTAL journal (its layers assigned in first-use
 * order across chunks, so chunk N's plan depends on chunks 1..N-1) — as `chunk-<i>.json` + `chunk-<i>.bin`
 * under a checkpoint dir. A resume replays them in order onto fresh state and continues at chunk K+1.
 *
 * Two files per chunk because the payloads are large binary (wire-compressed cells, DXT/RGBA8 mip rows) and
 * the rest is small JSON that has to stay readable; the JSON carries `[offset, length]` slices into the bin.
 * Chunks are journalled INCREMENTALLY (only what the chunk added), so a run's total checkpoint traffic is
 * about the size of the pak, not 16× it.
 */
import type { PlannedLayer, PlannerJournal } from '@opensa/cell-weld/textures';
import type { OspakInput } from '@opensa/engine-formats';
import type { RWUvAnimation } from '@opensa/renderware/parsers/binary/types';

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** What one chunk adds — the unit written after every chunk and replayed on resume. */
export interface ChunkCheckpoint {
  readonly chunkIndex: number;
  /** The convert's chunk plan (rects), so a resume refuses a run whose plan differs. */
  readonly chunkPlan: readonly string[];
  readonly doneCells: number;
  /** Cell entries this chunk produced (already wire-compressed). */
  readonly inputs: readonly OspakInput[];
  readonly planner: PlannerJournal;
  /** Full snapshot of the convert report (small). */
  readonly report: unknown;
  /** Full snapshot of the UV-anim registry (small). */
  readonly uvAnims: readonly { readonly anim: RWUvAnimation; readonly name: string; readonly slot: number }[];
  /** Full snapshot of the water height grid. */
  readonly water: readonly (readonly [number, number])[];
}

type Slice = readonly [number, number];

interface StoredCheckpoint extends Omit<ChunkCheckpoint, 'inputs' | 'planner'> {
  inputs: StoredInput[];
  planner: StoredJournal;
}

interface StoredInput extends Omit<OspakInput, 'bytes'> {
  bytes: Slice;
}

interface StoredJournal extends Omit<PlannerJournal, 'buckets'> {
  buckets: (Omit<PlannerJournal['buckets'][number], 'layers'> & { layers: StoredLayer[] })[];
}

interface StoredLayer extends Omit<PlannedLayer, 'mips'> {
  mips: { data: Slice; height: number; width: number }[];
}

const jsonPath = (dir: string, index: number): string => join(dir, `chunk-${index}.json`);
const binPath = (dir: string, index: number): string => join(dir, `chunk-${index}.bin`);

/** Drop every checkpoint — a fresh convert must not read a previous run's chunks. */
export function clearChunkCheckpoints(dir: string): void {
  rmSync(dir, { force: true, recursive: true });
}

/** Every checkpoint on disk, contiguous from chunk 0 — a gap ends the run of usable checkpoints. */
export function readChunkCheckpoints(dir: string): ChunkCheckpoint[] {
  const out: ChunkCheckpoint[] = [];
  for (let index = 0; existsSync(jsonPath(dir, index)) && existsSync(binPath(dir, index)); index += 1) {
    const stored = JSON.parse(readFileSync(jsonPath(dir, index), 'utf8')) as StoredCheckpoint;
    const bin = new Uint8Array(readFileSync(binPath(dir, index)));
    const get = ([offset, length]: Slice): Uint8Array => bin.subarray(offset, offset + length);
    out.push({
      ...stored,
      inputs: stored.inputs.map((input) => ({ ...input, bytes: get(input.bytes) })),
      planner: {
        ...stored.planner,
        buckets: stored.planner.buckets.map((bucket) => ({
          ...bucket,
          layers: bucket.layers.map((layer) => ({
            ...layer,
            mips: layer.mips.map((mip) => ({ data: get(mip.data), height: mip.height, width: mip.width })),
          })),
        })),
        byContent: stored.planner.byContent,
      },
    });
  }

  return out;
}

/** Write chunk `checkpoint.chunkIndex`. The bin is written first, the json last — a json is the commit mark. */
export function writeChunkCheckpoint(dir: string, checkpoint: ChunkCheckpoint): void {
  mkdirSync(dir, { recursive: true });
  const blobs: Uint8Array[] = [];
  let offset = 0;
  const put = (bytes: Uint8Array): Slice => {
    const slice: Slice = [offset, bytes.byteLength];
    blobs.push(bytes);
    offset += bytes.byteLength;

    return slice;
  };
  const stored: StoredCheckpoint = {
    ...checkpoint,
    inputs: checkpoint.inputs.map((input) => ({ ...input, bytes: put(input.bytes) })),
    planner: {
      ...checkpoint.planner,
      buckets: checkpoint.planner.buckets.map((bucket) => ({
        ...bucket,
        layers: bucket.layers.map((layer) => ({
          ...layer,
          mips: layer.mips.map((mip) => ({ data: put(mip.data), height: mip.height, width: mip.width })),
        })),
      })),
    },
  };
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const blob of blobs) {
    bin.set(blob, at);
    at += blob.byteLength;
  }
  writeFileSync(binPath(dir, checkpoint.chunkIndex), bin);
  writeFileSync(jsonPath(dir, checkpoint.chunkIndex), JSON.stringify(stored));
}
