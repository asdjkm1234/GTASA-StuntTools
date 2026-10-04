import type { ModelSource } from '@opensa/lod-common/model-source';
import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { buildArchiveBuffer, openArchive } from '@opensa/renderware/archive/img-archive';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectImgEntries,
  combinedModelSource,
  gatedHeights,
  layerCostLine,
  removeRetiredOutputs,
  speciesHeight,
  swapFolder,
} from './build';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('collectImgEntries', () => {
  describe('negative cases', () => {
    it('emits NOTHING when there is no HD swap — the layer ships no assets of its own (plan 014)', () => {
      // Before 014 this returned the shared `lod_procobj.txd`/`.col` even with no species: the LOD twin is gone,
      // so the placement layer adds text rows and a raised draw distance, and touches gta3.img only to swap HD.
      expect(collectImgEntries(new Map(), new Map()).size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('carries the swapped HD DFFs and the TXDs their retxd produced', () => {
      const swap = new Map([['cedar1_po.dff', bytes(20)]]);
      const retxdTxds = new Map([['vegetation.txd', bytes(30)]]);

      const entries = collectImgEntries(swap, retxdTxds);

      expect([...entries.keys()].sort()).toEqual(['cedar1_po.dff', 'vegetation.txd']);
      expect(entries.get('cedar1_po.dff')).toEqual(bytes(20));
      expect(entries.get('vegetation.txd')).toEqual(bytes(30));
    });
  });
});

const WASHER = 'fixtures/original/dff/building/washer.dff';
const BUSH = 'fixtures/original/world/sm_bush_large_1.dff';

describe.skipIf(!existsSync(WASHER) || !existsSync(BUSH))('combinedModelSource', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lod-procobj-modelsrc-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('falls back to the archive for a model the pack does not ship (and null when nowhere)', () => {
      const archive = openArchive(
        buildArchiveBuffer([{ data: new Uint8Array(readFileSync(BUSH)), name: 'stockbush.dff' }]),
      );
      const source = combinedModelSource(dir, archive); // empty pack dir
      expect(source.load('stockbush')).not.toBeNull(); // archive fallback
      expect(source.load('ghost')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('prefers the pack DFF over the archive model of the same name (the HD-swap source)', () => {
      // Pack ships `plant.dff` = washer geometry; the archive carries a DIFFERENT `plant.dff` (the bush).
      writeFileSync(join(dir, 'plant.dff'), readFileSync(WASHER));
      const archive = openArchive(
        buildArchiveBuffer([{ data: new Uint8Array(readFileSync(BUSH)), name: 'plant.dff' }]),
      );
      const source = combinedModelSource(dir, archive);

      const fromPack = source.load('plant')!;
      const stock = openArchive(buildArchiveBuffer([{ data: new Uint8Array(readFileSync(WASHER)), name: 'w.dff' }]));
      const washerVerts = combinedModelSource(dir, stock).load('w')!.geometries[0].positions.length;
      expect(fromPack.geometries[0].positions.length).toBe(washerVerts); // the pack's geometry, not the bush's
    });
  });
});

describe('layerCostLine', () => {
  describe('negative cases', () => {
    it('reports no price when nothing was converted (a TC with no matching species)', () => {
      expect(layerCostLine('sa', 1, null)).toBeNull();
    });

    it('does not divide by zero when the layer placed nothing', () => {
      expect(layerCostLine('sa', 1, { objects: 0, rows: 0 })).toContain('0.000 rows/object');
    });
  });

  describe('positive cases', () => {
    it('names the int16 budget the permanent rows are spent on for the sa host', () => {
      const line = layerCostLine('sa', 1, { objects: 15286, rows: 6487 });

      expect(line).toContain('15286 objects · 6487 permanent text rows · 0.424 rows/object');
      expect(line).toMatch(/int16/);
    });

    it('reports the same price for opensa but no row ceiling with it', () => {
      const line = layerCostLine('opensa', 1, { objects: 15286, rows: 6487 });

      expect(line).toContain('0.424 rows/object');
      expect(line).not.toMatch(/int16/);
      expect(line).toContain('no SA row ceiling');
    });

    it("reports the SECOND price too — the inst-bearing area files, against SA's 40 slots", () => {
      // Rows alone stopped being the whole cost when the twin went: an area IPL carrying inst rows is one of 40
      // slots, and the field crashed on the 40th. A density change has to show both numbers.
      const line = layerCostLine('sa', 1, { instBearingFiles: 10, objects: 91_092, rows: 91_092 });

      expect(line).toContain('1.000 rows/object');
      expect(line).toContain("10 inst-bearing area IPL(s) of SA's 40 slots");
    });

    it('states the range the rows were declared at — the layer has no other visibility mechanism', () => {
      const line = layerCostLine('sa', 1, { drawDistance: { changed: 39 }, objects: 100, rows: 100 });

      expect(line).toContain('39 species raised to the configured draw distance');
    });

    it("never deletes an earlier run's area files silently", () => {
      // A census over the output directory otherwise reads two scatters at once (measured: 95 584 rows for a
      // 91 092-row run), so the in-place bake says what it removed.
      expect(layerCostLine('sa', 1, { objects: 100, rows: 100, staleAreasRemoved: 36 })).toContain(
        '36 stale area file(s) from an earlier run removed',
      );
      expect(layerCostLine('sa', 1, { objects: 100, rows: 100, staleAreasRemoved: 0 })).not.toMatch(/stale/);
    });

    it('states the density it was built at, so a capture is not identified by memory', () => {
      expect(layerCostLine('opensa', 2.5, { objects: 10, rows: 4 })).toContain('density 2.5');
    });

    it('says CAP DROPPED when procObjMax bound — a capped run measures the cap, not the density', () => {
      const line = layerCostLine('opensa', 3, { dropped: 812, objects: 20000, rows: 8000 });

      expect(line).toContain('CAP DROPPED 812');
      expect(line).toMatch(/procObjMax binds/);
    });

    it('says nothing about the cap when it did not bind', () => {
      expect(layerCostLine('opensa', 1, { dropped: 0, objects: 10, rows: 4 })).not.toMatch(/CAP DROPPED/);
    });
  });
});

describe('swapFolder', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'procobj-swap-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('treats an absent folder as no swap — pmb passes `<mods-src>/procobj` whether or not it exists', () => {
      expect(swapFolder(join(dir, 'nope'))).toBeUndefined();
    });

    it('treats a folder with no .dff as no swap', () => {
      writeFileSync(join(dir, 'readme.txt'), 'not a model');

      expect(swapFolder(dir)).toBeUndefined();
    });

    it('passes `undefined` straight through', () => {
      expect(swapFolder(undefined)).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('keeps a folder that ships models', () => {
      writeFileSync(join(dir, 'plant.dff'), readFileSync(WASHER));

      expect(swapFolder(dir)).toBe(dir);
    });

    it('keeps a single-file pick', () => {
      const file = join(dir, 'plant.dff');
      writeFileSync(file, readFileSync(WASHER));

      expect(swapFolder(file)).toBe(file);
    });
  });
});

describe('speciesHeight', () => {
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  /** A one-triangle clump placed by a single frame — the shape `buildModelMesh` walks. */
  const clump = (positions: number[], framePosition: [number, number, number] = [0, 0, 0]): RWClump =>
    ({
      atomics: [{ frameIndex: 0, geometryIndex: 0 }],
      frames: [{ name: '', parentIndex: -1, position: framePosition, rotation: IDENTITY }],
      geometries: [
        {
          materials: [{ texture: { name: 'bark' } }],
          normals: null,
          positions: new Float32Array(positions),
          prelitColors: null,
          triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
          uvLayers: [],
        },
      ],
    }) as unknown as RWClump;

  describe('negative cases', () => {
    it('is zero for geometry with no Z extent — a flat decal is not tall clutter', () => {
      expect(speciesHeight(clump([0, 0, 5, 2, 0, 5, 0, 2, 5]))).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('measures the bbox Z extent, not the distance from the origin', () => {
      // A 3 m triangle sitting 10 m up is 3 m tall. The gate asks how tall the model is, never where it is.
      expect(speciesHeight(clump([0, 0, 10, 1, 0, 13, 0, 1, 10]))).toBeCloseTo(3, 6);
    });

    it('is frame-aware — the atomic frame moves the geometry but not its height', () => {
      expect(speciesHeight(clump([0, 0, 0, 1, 0, 4, 0, 1, 0], [50, 50, 20]))).toBeCloseTo(4, 6);
    });
  });
});

describe('gatedHeights', () => {
  const source = (heights: Record<string, number>): ModelSource => ({
    load: (model) =>
      heights[model] === undefined
        ? null
        : ({
            atomics: [{ frameIndex: 0, geometryIndex: 0 }],
            frames: [{ name: '', parentIndex: -1, position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
            geometries: [
              {
                materials: [{ texture: { name: 'bark' } }],
                normals: null,
                positions: new Float32Array([0, 0, 0, 1, 0, heights[model], 0, 1, 0]),
                prelitColors: null,
                triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
                uvLayers: [],
              },
            ],
          } as unknown as RWClump),
  });

  describe('negative cases', () => {
    it('skips a species the model source cannot load instead of failing the build', () => {
      // A TC's procobj.dat may name species it does not ship.
      expect([...gatedHeights(['missing', 'cedar'], source({ cedar: 6 }), 0).keys()]).toEqual(['cedar']);
    });

    it('drops species under the gate — short clutter stays on the runtime scatter', () => {
      const kept = gatedHeights(['grass', 'bush', 'cedar'], source({ bush: 4, cedar: 12, grass: 0.4 }), 4);

      expect([...kept.keys()].sort()).toEqual(['bush', 'cedar']); // 4 is AT the gate, so it stays
    });
  });

  describe('positive cases', () => {
    it('keeps everything loadable when the gate is off (0)', () => {
      const kept = gatedHeights(['grass', 'cedar'], source({ cedar: 12, grass: 0.4 }), 0);

      expect(kept.get('grass')).toBeCloseTo(0.4, 6);
      expect(kept.get('cedar')).toBeCloseTo(12, 6);
    });
  });
});

describe('removeRetiredOutputs', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'retired-'));
  });

  const write = (relative: string): void => {
    mkdirSync(join(dir, dirname(relative)), { recursive: true });
    writeFileSync(join(dir, relative), 'x');
  };

  describe('negative cases', () => {
    it('leaves the outputs this tool still writes', () => {
      // `lod_procobj.models` is current — the manifest downstream generators read. Only the LOD-era files go.
      write('data/maps/lod_procobj.models');
      write('data/maps/plobj0.ipl');
      write('data/maps/generic/procobj.ide');
      removeRetiredOutputs(dir);

      expect(existsSync(join(dir, 'data', 'maps', 'lod_procobj.models'))).toBe(true);
      expect(existsSync(join(dir, 'data', 'maps', 'plobj0.ipl'))).toBe(true);
      expect(existsSync(join(dir, 'data', 'maps', 'generic', 'procobj.ide'))).toBe(true);
    });

    it('is silent on a tree that never carried them', () => {
      expect(() => removeRetiredOutputs(dir)).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('deletes the pre-014 LOD IDE and the linear-TXD sidecar', () => {
      // Found in the real artifact 2026-08-10: `lod_procobj.ide` declaring 48 models with zero DFFs behind them,
      // surviving every later build because the in-place bake writes into a tree nobody wipes.
      write('data/maps/lod_procobj.ide');
      write('linear-txd/lod_procobj.txd');
      removeRetiredOutputs(dir);

      expect(existsSync(join(dir, 'data', 'maps', 'lod_procobj.ide'))).toBe(false);
      expect(existsSync(join(dir, 'linear-txd', 'lod_procobj.txd'))).toBe(false);
    });
  });
});
