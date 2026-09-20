import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cellCentre, cellModelName, ideObjsLine, iplInstLine, meshBounds, writeBuild } from './finalize';

describe('finalize line emitters', () => {
  describe('positive cases', () => {
    it('names a cell-LOD with the lod prefix (negative coords kept)', () => {
      expect(cellModelName(3, -7)).toBe('lod_3_-7');
    });

    it('places the cell centre at (cx+0.5, cy+0.5)·cellSize, world Z 0', () => {
      expect(cellCentre({ cx: 3, cy: -7 }, 256)).toEqual([896, -1664, 0]);
    });

    it('emits an IDE objs line pointing every cell at the shared TXD (plan 004)', () => {
      expect(ideObjsLine(5000, 'lod_0_0', 1500)).toBe('5000, lod_0_0, lods, 1500, 0');
    });

    it('emits an IPL inst line with identity rotation and no LOD link', () => {
      expect(iplInstLine(5000, 'lod_0_0', [128, 128, 0])).toBe('5000, lod_0_0, 0, 128, 128, 0, 0, 0, 0, 1, -1');
    });
  });
});

describe('meshBounds', () => {
  describe('negative cases', () => {
    it('returns zero bounds for an empty mesh (no Infinity in the COL)', () => {
      expect(meshBounds({ positions: new Float32Array(0) })).toEqual({ max: [0, 0, 0], min: [0, 0, 0] });
    });
  });

  describe('positive cases', () => {
    it('computes the per-axis min/max over the vertices', () => {
      const positions = new Float32Array([1, -2, 3, -4, 5, -6, 0, 0, 9]);
      expect(meshBounds({ positions })).toEqual({ max: [1, 5, 9], min: [-4, -2, -6] });
    });
  });
});

describe('writeBuild', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opensa-lod-finalize-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it("does not carry a PREVIOUS build's file into the new tree", () => {
      // `--out` outlives a build. A file this run does not produce has to go, or it survives into the tree a
      // field run reads — 23 mod IPLs did exactly that on 2026-08-16.
      const gameDir = join(dir, 'game');
      const outDir = join(dir, 'out');
      mkdirSync(join(gameDir, 'data'), { recursive: true });
      writeFileSync(join(gameDir, 'data', 'gta.dat'), 'IPL DATA\\MAPS\\area.IPL\n');
      mkdirSync(join(outDir, 'data', 'maps'), { recursive: true });
      writeFileSync(join(outDir, 'data', 'maps', 'gone.ipl'), 'inst\nend\n');

      writeBuild({
        baked: [],
        cellSize: 256,
        drawDistance: 1500,
        firstId: 5000,
        gameDir,
        lodTextureSize: 64,
        outDir,
        textureSource: { get: () => null },
      });

      expect(existsSync(join(outDir, 'data', 'maps', 'gone.ipl'))).toBe(false);
      expect(readFileSync(join(outDir, 'data', 'gta.dat'), 'utf8')).toContain('IPL DATA\\MAPS\\lods.ipl');
    });
  });
});
