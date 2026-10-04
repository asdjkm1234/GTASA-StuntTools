/**
 * Which LEVEL gets a cell's roadsign text (plan 100/03).
 *
 * `weldCellParts` welds whatever list it is handed, and its own tests prove that. What is decided HERE, in
 * the convert's per-cell dispatch, is WHETHER the LOD level is handed one at all — and losing that half is
 * silent: the bundle simply welds no text, and every plate in the ~440 → 1000 u band goes blank again. So
 * this asserts the dispatch, not the welder.
 */
import type { AssetFileSystem, IdeObjectDef } from '@opensa/renderware';
import type { RoadsignGlyphQuads } from '@opensa/renderware/roadsign/glyph-quads';

import { TexturePlanner } from '@opensa/cell-weld/textures';
import { createUvAnimRegistry, type WeldedCell } from '@opensa/cell-weld/weld';
import { buildArchiveBuffer, openArchive } from '@opensa/renderware';
import { buildWorldGrid, cellKey } from '@opensa/renderware/map/world-grid';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { weldGridCell, type WeldRectContext } from './convert';

const DFF = 'fixtures/custom/proper-fixes-models/trafficlight1.dff';
const TXD = 'fixtures/original/dff/trafficlight-backface-culling/dyntraffic.txd';
const CELL_SIZE = 250;
/** One plate's worth of quads, in the shape `collectRoadsigns` buckets by world position. */
const PLATE: RoadsignGlyphQuads = {
  colour: 0,
  positions: [40, 40, 20, 41, 40, 20, 41, 40, 21, 40, 40, 21],
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
};

/**
 * A one-cell world with the same model placed at HD and as a cell LOD, so `weldGridCell` produces BOTH
 * bundles for cell (0,0) — `buildWorldGrid` splits on the authoritative `isLod`.
 */
function context(signs?: RoadsignGlyphQuads[]): WeldRectContext {
  const fs = fixtureFs();
  const def: IdeObjectDef = {
    drawDistance: 300,
    flags: 0,
    id: 1315,
    modelName: 'trafficlight1',
    txdName: 'dyntraffic',
  };
  const at = (isLod: boolean): Parameters<typeof buildWorldGrid>[0]['instances'][number] => ({
    id: 1315,
    interior: 0,
    isLod,
    lod: -1,
    modelName: 'trafficlight1',
    position: [40, 40, 15],
    rotation: [0, 0, 0, 1],
  });
  const defs = {
    carGenerators: [],
    catalog: new Map([[1315, def]]),
    imgDirs: [],
    instances: [at(false), at(true)],
    timedCatalog: new Map<number, IdeObjectDef>(),
    txdParents: new Map<string, string>(),
  } as unknown as WeldRectContext['defs'];

  return {
    breakableModels: new Set<string>(),
    cellSize: CELL_SIZE,
    defs,
    fs,
    grid: buildWorldGrid(defs, CELL_SIZE),
    planner: new TexturePlanner(fs, new Map()),
    roadsignsByCell: new Map(signs ? [[cellKey(0, 0), signs]] : []),
    uvAnimRegistry: createUvAnimRegistry(),
  };
}

function fixtureFs(): AssetFileSystem {
  const archive = openArchive(
    buildArchiveBuffer([
      { data: readFileSync(DFF), name: 'trafficlight1.dff' },
      { data: readFileSync(TXD), name: 'dyntraffic.txd' },
    ]),
  );

  return {
    ...archive,
    get: (name) => archive.get(name),
    getText: () => null,
    has: (name) => archive.get(name) !== null,
  };
}

/** Weld cell (0,0) and return the two bundles by level. */
function weldBoth(signs?: RoadsignGlyphQuads[]): Record<string, WeldedCell> {
  const welded: { cell: WeldedCell; key: string }[] = [];
  weldGridCell(context(signs), 0, 0, welded);

  return Object.fromEntries(welded.map(({ cell, key }) => [key.endsWith('lod') ? 'lod' : 'hd', cell]));
}

describe('weldGridCell roadsign levels', () => {
  describe('negative cases', () => {
    it('welds no text into either level when the cell has no signs', () => {
      const levels = weldBoth();

      expect(levels.hd.stats.roadsigns).toBe(0);
      expect(levels.lod.stats.roadsigns).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('hands the cell list to BOTH levels — the LOD half is what plan 100/03 added', () => {
      const levels = weldBoth([PLATE]);

      expect(Object.keys(levels).sort()).toEqual(['hd', 'lod']); // fixture sanity: both bundles exist
      expect(levels.hd.stats.roadsigns).toBe(1);
      expect(levels.lod.stats.roadsigns).toBe(1);
    });
  });
});
