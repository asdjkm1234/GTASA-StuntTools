/**
 * The map-object stage's DELETION rules (plan opensa-pack/003 phase 5g step 6).
 *
 * Converting is the easy half; deciding what may be REMOVED from the archives is where a mistake is
 * invisible until something renders untextured. Two rules govern it, and both are asserted here on a real
 * modded map object:
 *
 *  - a dictionary goes only when every model that names it has been converted;
 *  - a dictionary that is a `txdp` PARENT of a KEPT one stays, or the child's unconverted models lose the
 *    textures they inherit.
 */
import type { AssetFileSystem } from '@opensa/renderware';
import type { IdeObjectDef } from '@opensa/renderware/parsers/text/types';

import { TexturePlanner } from '@opensa/cell-weld/textures';
import { OsmSectionTag } from '@opensa/engine-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createModelBundles } from './model-bundle';
import { packMapObjects } from './pack-map-objects';

const FIXTURES = join(process.cwd(), 'fixtures', 'original');
const MODEL = 'chinatown_sfe1';
const TXD = 'chinatownsfe';

function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

const files = new Map<string, ArrayBuffer>([
  [`${MODEL}.dff`, fileOf('mods/chinatown_sfe1.dff')],
  [`${TXD}.txd`, fileOf('mods/chinatownsfe.txd')],
]);

const fs: AssetFileSystem = {
  get: (name) => files.get(name.toLowerCase()) ?? null,
  getText: () => null,
  has: (name) => files.has(name.toLowerCase()),
  names: [...files.keys()],
};

function def(modelName: string, txdName: string): IdeObjectDef {
  return { flags: 0, id: 0, modelName, txdName } as IdeObjectDef;
}

/** Run the stage over `defs`, with a fresh planner and bundle set each time. */
function pack(
  defs: readonly IdeObjectDef[],
  txdParents: ReadonlyMap<string, string> = new Map(),
  bundles = createModelBundles(),
): ReturnType<typeof packMapObjects> {
  const catalog = new Map(defs.map((entry, index) => [index, entry]));

  return packMapObjects(fs, { catalog }, new TexturePlanner(fs, new Map()), bundles, () => false, silent, txdParents);
}

/** The stage logs a summary line; the tests assert its RETURN, so the sink swallows it. */
function silent(): void {
  // intentionally quiet
}

describe('packMapObjects', () => {
  describe('negative cases', () => {
    it('keeps a dictionary an UNCONVERTED model still names', () => {
      // The second row names the same TXD but has no DFF, so it cannot convert — and its textures must
      // survive for the unoptimized path that will build it.
      const report = pack([def(MODEL, TXD), def('never_converted', TXD)]);

      expect(report.models).toBe(1);
      expect(report.deletes).toContain(`${MODEL}.dff`);
      expect(report.deletes).not.toContain(`${TXD}.txd`);
    });

    it('keeps a dictionary that is the txdp PARENT of a kept one', () => {
      // `child` is kept (its model never converts); the parent it inherits from must be kept WITH it, or
      // the child resolves to half a dictionary at runtime.
      const report = pack([def(MODEL, TXD), def('never_converted', 'child')], new Map([['child', TXD]]));

      expect(report.deletes).not.toContain(`${TXD}.txd`);
    });

    it('leaves a model another class already bundled alone, rather than claiming its sections', () => {
      const bundles = createModelBundles();
      bundles.add(MODEL, { sections: [{ bytes: new Uint8Array([1]), tag: OsmSectionTag.GEOM }] });
      const report = pack([def(MODEL, TXD)], new Map(), bundles);

      // A by-name class owns its model's PRIVATE dictionary on purpose — taking it over here would both
      // throw on the duplicate tag and cost that class its single-array fast path.
      expect(report.skipped).toBe(1);
      expect(report.models).toBe(0);
      expect(report.deletes).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('converts the model and queues both its DFF and its now-unused dictionary', () => {
      const bundles = createModelBundles();
      const report = pack([def(MODEL, TXD)], new Map(), bundles);

      expect(report.models).toBe(1);
      expect(report.failed).toEqual([]);
      expect(report.deletes).toEqual(expect.arrayContaining([`${MODEL}.dff`, `${TXD}.txd`]));
      expect(bundles.hasSection(MODEL, OsmSectionTag.GEOM)).toBe(true);
    });

    it('writes NO dictionary into the model — its textures are the world plan’s', () => {
      const bundles = createModelBundles();
      pack([def(MODEL, TXD)], new Map(), bundles);

      // The whole saving: 3 674 MB of per-model dictionaries against 400 MB of geometry.
      expect(bundles.hasSection(MODEL, OsmSectionTag.TEXS)).toBe(false);
      expect(bundles.hasSection(MODEL, OsmSectionTag.DESC)).toBe(true);
    });
  });
});
