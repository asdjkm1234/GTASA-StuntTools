/**
 * The `SHAT` round trip on a real prop (plan opensa-pack/003 phase 5b): opensa-pack bakes it, the runtime's
 * `getBreakable` reads it back — and must return exactly what a full `parseDff` would have produced.
 *
 * Writer and reader live in different packages, so the only thing keeping them honest is this file.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { decodeOsm, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { getBreakable } from '@opensa/renderware/breakable/mesh';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createModelBundles } from './model-bundle';
import { packBreakables } from './pack-breakables';

const FIXTURES = join(process.cwd(), 'fixtures', 'original');
const MODEL = 'binnt08_la';

/** The writer logs a summary line; the tests do not care about it. */
const quiet = (): void => undefined;

/** The archives after phase 5b: the `.dff` stays (only the shatter mesh is baked), plus a `SHAT`-only `.osm`. */
function convertedFiles(): { files: Map<string, ArrayBuffer>; report: ReturnType<typeof packBreakables> } {
  const files = stockFiles();
  const bundles = createModelBundles();
  const report = packBreakables(fsFrom(files), [MODEL], bundles, quiet);
  for (const insert of bundles.inserts()) {
    files.set(
      insert.name,
      insert.bytes.buffer.slice(
        insert.bytes.byteOffset,
        insert.bytes.byteOffset + insert.bytes.byteLength,
      ) as ArrayBuffer,
    );
  }

  return { files, report };
}

function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function fsFrom(files: Map<string, ArrayBuffer>): AssetFileSystem {
  return {
    get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
    getText: () => null,
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}

function stockFiles(): Map<string, ArrayBuffer> {
  return new Map<string, ArrayBuffer>([[`${MODEL}.dff`, fileOf('dff/breakable/binnt08_la.dff')]]);
}

describe('packBreakables', () => {
  describe('negative cases', () => {
    it('reports a model that is not in the archive instead of throwing', () => {
      const bundles = createModelBundles();
      const report = packBreakables(fsFrom(new Map()), ['nosuchprop'], bundles, quiet);

      expect(bundles.inserts()).toEqual([]);
      expect(report.skipped).toBe(1);
      expect(report.failed).toEqual([]);
    });

    it('writes ONLY a SHAT section — the prop keeps its .dff for everything else', () => {
      const { files } = convertedFiles();

      const osm = decodeOsm(new Uint8Array(files.get(`${MODEL}.osm`)!));

      expect(osmSection(osm, OsmSectionTag.SHAT)).toBeDefined();
      expect(osmSection(osm, OsmSectionTag.GEOM)).toBeNull();
      expect(osmSection(osm, OsmSectionTag.DESC)).toBeNull();
      expect(files.has(`${MODEL}.dff`)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('bakes the same mesh the DFF parse would have produced', () => {
      const stock = getBreakable(fsFrom(stockFiles()), MODEL);
      const { files } = convertedFiles();

      const baked = getBreakable(fsFrom(files), MODEL);

      expect(stock).toBeDefined();
      expect(baked).toBeDefined();
      expect(baked?.positions).toEqual(stock?.positions);
      expect(baked?.triangles).toEqual(stock?.triangles);
      expect(baked?.triangleMaterials).toEqual(stock?.triangleMaterials);
      expect(baked?.uvs).toEqual(stock?.uvs);
      expect(baked?.colours).toEqual(stock?.colours);
      expect(baked?.materials).toEqual(stock?.materials);
    });

    it('reads the baked mesh with NO .dff present at all — nothing to parse', () => {
      const { files } = convertedFiles();
      files.delete(`${MODEL}.dff`);

      const baked = getBreakable(fsFrom(files), MODEL);

      expect(baked?.triangleMaterials.length).toBeGreaterThan(0);
    });

    it('counts the prop as authored when the DFF ships an RW Breakable plugin', () => {
      const { report } = convertedFiles();

      expect(report.authored).toBe(1);
      expect(report.synthesized).toBe(0);
      expect(report.bytes).toBeGreaterThan(0);
    });
  });
});
