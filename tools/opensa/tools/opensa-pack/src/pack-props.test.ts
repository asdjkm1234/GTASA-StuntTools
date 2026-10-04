/**
 * The `HULL` bake on a real topple prop (plan opensa-pack/003 phase 5): `lamppost1`, the model the topple
 * behaviour was tuned against.
 *
 * What must hold is not "it round-trips" but "the collider does not move": the baked box has to equal what
 * `engine-props.ts:boundsOf` computes by walking the clump, and the deduplicated cloud has to span the same
 * extent as the raw one — a convex hull is determined by its point SET, so dropping duplicates is only safe
 * if the set is unchanged.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { decodeOsm, decodeOsmHull, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { getClump } from '@opensa/renderware/archive/asset-cache';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createModelBundles } from './model-bundle';
import { packProps } from './pack-props';

const FIXTURES = join(process.cwd(), 'fixtures', 'original');
const MODEL = 'lamppost1';
const TXD = 'dynsigns';
const quiet = (): void => undefined;

/** The REAL `object.dat`: `lamppost1` carries uprootLimit 240, `cardboardbox` carries 0 (it smashes). */
const OBJECT_DAT = readFileSync(join(FIXTURES, 'data', 'object.dat'), 'utf8');
/** A row the uproot gate must skip OUTRIGHT — no insert, and no failure either. */
const SMASH_ONLY = 'cardboardbox';

function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function gameFs(): AssetFileSystem {
  const files = new Map<string, ArrayBuffer>([
    [`${MODEL}.dff`, fileOf('dff/topple/lamppost1.dff')],
    [`${TXD}.txd`, fileOf('dff/topple/dynsigns.txd')],
  ]);

  return {
    get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
    getText: (name: string): null | string => (name === 'data/object.dat' ? OBJECT_DAT : null),
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}

const defs = { catalog: new Map([[1, { modelName: MODEL, txdName: TXD }]]) };

function bakedHull(): ReturnType<typeof decodeOsmHull> {
  const bundles = createModelBundles();
  packProps(gameFs(), defs, bundles, quiet);
  const insert = bundles.inserts().find((entry) => entry.name === `${MODEL}.osm`)!;

  return decodeOsmHull(osmSection(decodeOsm(insert.bytes), OsmSectionTag.HULL)!);
}

/** What the RUNTIME computes today by walking the clump — the thing the bake must reproduce. */
function runtimeBounds(fs: AssetFileSystem): { centre: number[]; half: number[]; points: number } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let points = 0;
  for (const geometry of getClump(fs, MODEL).geometries) {
    for (let at = 0; at < geometry.positions.length; at += 3) {
      points += 1;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], geometry.positions[at + axis]);
        max[axis] = Math.max(max[axis], geometry.positions[at + axis]);
      }
    }
  }

  return {
    centre: [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2),
    half: [0, 1, 2].map((axis) => Math.max(0.12, (max[axis] - min[axis]) / 2)),
    points,
  };
}

describe('packProps on a real topple prop', () => {
  describe('negative cases', () => {
    it('skips a prop object.dat gives no uproot limit — silently, not as a failure', () => {
      const bundles = createModelBundles();

      const report = packProps(gameFs(), defs, bundles, quiet);

      // Only `lamppost1`'s DFF is present, so it is the only conversion. A smash-only row must appear in
      // NEITHER list — the gate skipped it before the fs.
      expect(bundles.inserts().map((entry) => entry.name)).toEqual([`${MODEL}.osm`]);
      expect(report.models).toBe(1);
      expect(report.failed.map((failure) => failure.model)).not.toContain(SMASH_ONLY);
    });

    it('counts a topple row with no model as ABSENT, not as a conversion failure', () => {
      // `object.dat` is a physics-tuning table, not a model roster: it carries rows (cutscene body parts,
      // effect names) whose DFF is in no archive, in stock SA too. Reporting those as failures buried the
      // real ones — 30 of the run's 85 "failures" were this.
      const report = packProps(gameFs(), defs, createModelBundles(), quiet);

      expect(report.failed).toEqual([]);
      expect(report.absent).toBeGreaterThan(0);
    });

    it('drops duplicate points without shrinking the extent', () => {
      const hull = bakedHull();
      const runtime = runtimeBounds(gameFs());
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let at = 0; at < hull.points.length; at += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], hull.points[at + axis]);
          max[axis] = Math.max(max[axis], hull.points[at + axis]);
        }
      }

      expect(hull.points.length / 3).toBeLessThan(runtime.points); // dedup did something
      // …and the cloud still spans exactly the same box, so the hull cannot have moved.
      for (let axis = 0; axis < 3; axis += 1) {
        expect(min[axis]).toBeCloseTo(runtime.centre[axis] - (max[axis] - min[axis]) / 2, 5);
      }
      expect(max.map((value, axis) => value - min[axis])).toEqual(
        runtime.half.map((value, axis) => Math.max(value, (max[axis] - min[axis]) / 2) * 2 - 0),
      );
    });
  });

  describe('positive cases', () => {
    it('bakes the same centre and half-extents the runtime walk produces', () => {
      const hull = bakedHull();
      const runtime = runtimeBounds(gameFs());

      for (let axis = 0; axis < 3; axis += 1) {
        expect(hull.centre[axis]).toBeCloseTo(runtime.centre[axis], 5);
        expect(hull.half[axis]).toBeCloseTo(runtime.half[axis], 5);
      }
    });

    it('carries the hull ALONGSIDE the rigid sections, in one container', () => {
      const bundles = createModelBundles();
      packProps(gameFs(), defs, bundles, quiet);
      const insert = bundles.inserts().find((entry) => entry.name === `${MODEL}.osm`)!;

      const sections = decodeOsm(insert.bytes);

      expect(osmSection(sections, OsmSectionTag.HULL)).not.toBeNull();
      expect(osmSection(sections, OsmSectionTag.GEOM)).not.toBeNull();
      expect(osmSection(sections, OsmSectionTag.DESC)).not.toBeNull();
      expect(osmSection(sections, OsmSectionTag.TEXS)).not.toBeNull();
    });
  });
});
