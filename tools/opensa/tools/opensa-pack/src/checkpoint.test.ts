import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ChunkCheckpoint, clearChunkCheckpoints, readChunkCheckpoints, writeChunkCheckpoint } from './checkpoint';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pack-checkpoint-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

function checkpoint(chunkIndex: number): ChunkCheckpoint {
  return {
    chunkIndex,
    chunkPlan: ['0,0,5,5', '6,0,11,5'],
    doneCells: (chunkIndex + 1) * 36,
    inputs: [
      {
        aabb: [1, 2, 3, 4],
        bytes: Uint8Array.of(10 + chunkIndex, 20, 30),
        enc: 'deflate-raw',
        key: `${chunkIndex},0,hd`,
        kind: 'cell',
        rawLength: 3,
        textures: [0, 1],
      },
    ],
    planner: {
      buckets: [
        {
          format: 1,
          height: 4,
          key: '1|4|4|1',
          layers: [
            {
              alphaClass: 'opaque',
              mips: [{ data: Uint8Array.of(chunkIndex, 1, 2, 3), height: 4, width: 4 }],
              name: `tex${chunkIndex}`,
            },
          ],
          mipCount: 1,
          refs: [0],
          width: 4,
        },
      ],
      byContent: [[123 + chunkIndex, { alphaClass: 'opaque', arrayRef: 0, layer: chunkIndex, stochastic: false }]],
      missingLayers: [],
      nextArrayRef: 1,
      report: { colors: 0, crossTxd: {}, dedup: 0, missing: {}, opaquePass: 1, processed: 0 },
    },
    report: { cells: [chunkIndex] },
    uvAnims: [
      { anim: { duration: 1, keyframes: [{ time: 0, uv: [0, 0] }], name: 'DolSign' }, name: 'dolsign', slot: 0 },
    ],
    water: [[5, -1.5]],
  };
}

describe('chunk checkpoints', () => {
  describe('negative cases', () => {
    it('reads only the CONTIGUOUS run from chunk 0 — a gap ends it, and clear leaves nothing', () => {
      writeChunkCheckpoint(dir, checkpoint(0));
      writeChunkCheckpoint(dir, checkpoint(2));

      expect(readChunkCheckpoints(dir).map((c) => c.chunkIndex)).toEqual([0]);
      clearChunkCheckpoints(dir);
      expect(existsSync(dir)).toBe(false);
      expect(readChunkCheckpoints(dir)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('round-trips every part of a checkpoint — cell bytes, layer mips, dedup entries, anims, water', () => {
      writeChunkCheckpoint(dir, checkpoint(0));
      writeChunkCheckpoint(dir, checkpoint(1));

      const back = readChunkCheckpoints(dir);
      expect(back).toHaveLength(2);
      const one = back[1];
      expect(one.chunkIndex).toBe(1);
      expect(one.doneCells).toBe(72);
      expect([...one.inputs[0].bytes]).toEqual([11, 20, 30]);
      expect(one.inputs[0]).toMatchObject({
        aabb: [1, 2, 3, 4],
        enc: 'deflate-raw',
        key: '1,0,hd',
        kind: 'cell',
        textures: [0, 1],
      });
      expect([...one.planner.buckets[0].layers[0].mips[0].data]).toEqual([1, 1, 2, 3]);
      expect(one.planner.buckets[0].layers[0].name).toBe('tex1');
      expect(one.planner.byContent).toEqual([
        [124, { alphaClass: 'opaque', arrayRef: 0, layer: 1, stochastic: false }],
      ]);
      expect(one.uvAnims[0].anim.keyframes[0].uv).toEqual([0, 0]);
      expect(one.water).toEqual([[5, -1.5]]);
      expect(one.report).toEqual({ cells: [1] });
    });
  });
});
