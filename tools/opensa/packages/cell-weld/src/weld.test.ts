import type { AssetFileSystem, IdeObjectDef, MapDefinitions } from '@opensa/renderware';
import type { GridCell } from '@opensa/renderware/map/world-grid';
import type { RoadsignGlyphQuads } from '@opensa/renderware/roadsign/glyph-quads';

import { decodeOscell, OSCELL_VERTEX_STRIDE, OscellChannel } from '@opensa/engine-formats';
import { buildArchiveBuffer, openArchive } from '@opensa/renderware';
import { frameWorldTransform } from '@opensa/renderware/mesh/frame-transform';
import { IdeFlag } from '@opensa/renderware/parsers/text/index';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { TexturePlanner } from './textures';
import { createUvAnimRegistry, isVegetationDef, uvAnimList, weldCell, weldCellParts } from './weld';

// Real committed fixtures (same case build-region tests use).
const DFF = 'fixtures/custom/proper-fixes-models/trafficlight1.dff';
const TXD = 'fixtures/original/dff/trafficlight-backface-culling/dyntraffic.txd';
// The SF fountain (IDE 9833): a stock model with THREE 2dfx type-1 particle anchors (`water_fountain`).
const FOUNTAIN_DFF = 'fixtures/original/dff/particles/fountain_sfw.dff';
const FOUNTAIN_TXD = 'fixtures/original/dff/particles/fountain_sfw.txd';

function fixtureCell(count: number): GridCell {
  const hd = Array.from({ length: count }, (_, index) => ({
    id: 1315,
    interior: 0,
    lod: -1,
    modelName: 'trafficlight1',
    position: [2350 + index * 10, -1650, 15] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  }));

  return { cx: 9, cy: -7, hd, lod: [] };
}

function fixtureDefs(def: Partial<IdeObjectDef> = {}): MapDefinitions {
  const catalog = new Map<number, IdeObjectDef>();
  catalog.set(1315, {
    drawDistance: 80,
    flags: 0,
    id: 1315,
    modelName: 'trafficlight1',
    txdName: 'dyntraffic',
    ...def,
  });

  return {
    carGenerators: [],
    catalog,
    imgDirs: [],
    instances: [],
    timedCatalog: new Map<number, IdeObjectDef>(),
    txdParents: new Map<string, string>(),
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

/** One fountain at a known spot, so the welded anchors can be checked against the instance. */
function fountainCell(): GridCell {
  return {
    cx: 0,
    cy: 0,
    hd: [
      {
        id: 9833,
        interior: 0,
        lod: -1,
        modelName: 'fountain_sfw',
        position: [-1900, 900, 20],
        rotation: [0, 0, 0, 1],
      },
    ],
    lod: [],
  };
}

function fountainDefs(): MapDefinitions {
  const catalog = new Map<number, IdeObjectDef>();
  catalog.set(9833, {
    drawDistance: 40,
    flags: 0,
    id: 9833,
    modelName: 'fountain_sfw',
    txdName: 'fountain_sfw',
  });

  return {
    carGenerators: [],
    catalog,
    imgDirs: [],
    instances: [],
    timedCatalog: new Map<number, IdeObjectDef>(),
    txdParents: new Map<string, string>(),
  };
}

function fountainFs(): AssetFileSystem {
  const archive = openArchive(
    buildArchiveBuffer([
      { data: readFileSync(FOUNTAIN_DFF), name: 'fountain_sfw.dff' },
      { data: readFileSync(FOUNTAIN_TXD), name: 'fountain_sfw.txd' },
    ]),
  );

  return {
    get: (name: string) => archive.get(name.split('/').pop() ?? name),
    getText: () => null,
    has: (name: string) => archive.get(name.split('/').pop() ?? name) !== null,
  } as unknown as AssetFileSystem;
}

/** Summed extent of a welded cell's vertex positions — a placement fingerprint the vertex count cannot see. */
function spread(bytes: Uint8Array): number {
  const cell = decodeOscell(bytes);
  const view = new DataView(cell.vertexData.buffer, cell.vertexData.byteOffset, cell.vertexData.byteLength);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < cell.vertexCount; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = view.getFloat32(vertex * OSCELL_VERTEX_STRIDE + axis * 4, true);
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }

  return max[0] - min[0] + (max[1] - min[1]) + (max[2] - min[2]);
}

describe('weldCell 2dfx particles', () => {
  describe('negative cases', () => {
    it('welds a cell LOD’s anchors ONCE, never once per level into one bundle', () => {
      // The hazard the HD-only gate used to answer. Doubling is now the streamer's job — a slot holds one
      // level and the swap unloads the old key in the same call — so what a bundle must guarantee is that it
      // carries each anchor a single time. Both bundles of one cell exist; neither is ever resident twice.
      const fs = fountainFs();
      const origin: [number, number, number] = [-1900, 0, -900];
      const lodCell: GridCell = { ...fountainCell(), hd: [], lod: fountainCell().hd };

      const hd = weldCell(fs, fountainDefs(), fountainCell(), false, new TexturePlanner(fs, new Map()), origin);
      const lodded = weldCell(fs, fountainDefs(), lodCell, true, new TexturePlanner(fs, new Map()), origin);

      expect(hd!.stats.particles).toBe(3);
      expect(lodded!.stats.particles).toBe(3);
      expect(decodeOscell(lodded!.bytes).particles.map((p) => p.position)).toEqual(
        decodeOscell(hd!.bytes).particles.map((p) => p.position),
      );
    });
  });

  describe('positive cases', () => {
    it('carries the anchors into a LOD cell too — an emitter has to survive past the HD ring', () => {
      const fs = fountainFs();
      const cell: GridCell = { ...fountainCell(), hd: [], lod: fountainCell().hd };

      const welded = weldCell(fs, fountainDefs(), cell, true, new TexturePlanner(fs, new Map()), [-1900, 0, -900]);

      const particles = decodeOscell(welded!.bytes).particles;
      expect(particles).toHaveLength(3);
      expect(new Set(particles.map((particle) => particle.effectName))).toEqual(new Set(['water_fountain']));
    });

    it('welds the DFF 2dfx anchors into the cell, in ENGINE space, relative to the cell origin', () => {
      const fs = fountainFs();
      const origin: [number, number, number] = [-1900, 0, -900];

      const welded = weldCell(fs, fountainDefs(), fountainCell(), false, new TexturePlanner(fs, new Map()), origin);

      const particles = decodeOscell(welded!.bytes).particles;
      expect(welded!.stats.particles).toBe(3);
      expect(particles).toHaveLength(3);
      expect(new Set(particles.map((particle) => particle.effectName))).toEqual(new Set(['water_fountain']));
      // GTA (-1900, 900, 20) → engine (-1900, 20, -900), minus the origin ⇒ the anchors sit near the cell's
      // local zero, the Y (engine up) a few metres above the instance. A left-behind basis change lands them
      // hundreds of metres out, which is how the fountain sprayed sideways in the first place.
      for (const particle of particles) {
        expect(Math.abs(particle.position[0])).toBeLessThan(10);
        expect(Math.abs(particle.position[2])).toBeLessThan(10);
        expect(particle.position[1]).toBeGreaterThan(15); // 20 m up (engine Y), give or take the anchor height
        expect(particle.position[1]).toBeLessThan(30);
      }
    });
  });
});

// The nodding donkey: a 6-frame clump whose arm swings (clip in counxref.ifp, named after the MODEL).
const ANIM_DFF = 'fixtures/original/dff/anim-clump/nt_noddonkbase.dff';
const ANIM_IFP = 'fixtures/original/dff/anim-clump/counxref.ifp';

function animCell(): GridCell {
  return {
    cx: 0,
    cy: 0,
    hd: [
      {
        id: 1315,
        interior: 0,
        lod: -1,
        modelName: 'nt_noddonkbase',
        position: [10, 20, 30],
        rotation: [0, 0, 0, 1],
      },
    ],
    lod: [],
  };
}

/** `anim: null` = a plain static def (passing `undefined` would hit the default — a trap this test fell in). */
function animDefs(anim: null | string = 'counxref'): MapDefinitions {
  const catalog = new Map<number, IdeObjectDef>();
  catalog.set(1315, {
    ...(anim !== null ? { anim } : {}),
    drawDistance: 100,
    flags: 0,
    id: 1315,
    modelName: 'nt_noddonkbase',
    txdName: 'dyntraffic',
  });

  return {
    carGenerators: [],
    catalog,
    imgDirs: [],
    instances: [],
    timedCatalog: new Map<number, IdeObjectDef>(),
    txdParents: new Map<string, string>(),
  };
}

function animFs(): AssetFileSystem {
  const archive = openArchive(
    buildArchiveBuffer([
      { data: readFileSync(ANIM_DFF), name: 'nt_noddonkbase.dff' },
      { data: readFileSync(ANIM_IFP), name: 'counxref.ifp' },
      { data: readFileSync(TXD), name: 'dyntraffic.txd' },
    ]),
  );

  return {
    get: (name: string) => archive.get(name.split('/').pop() ?? name),
    getText: () => null,
    has: (name: string) => archive.get(name.split('/').pop() ?? name) !== null,
  } as unknown as AssetFileSystem;
}

describe('weldCell animated objects (B7·b)', () => {
  describe('negative cases', () => {
    it('welds the WHOLE model when its IFP is missing — a lost clip must not delete a building', () => {
      // The "blue hole": anim defs used to be skipped wholesale, which deleted burger01_LAw — a 22x35 m diner
      // that sits in the anim section only because its sign spins.
      const fs = animFs();

      const whole = weldCell(fs, animDefs(null), animCell(), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);
      const missing = weldCell(
        fs,
        animDefs('no_such_ifp'),
        animCell(),
        false,
        new TexturePlanner(fs, new Map()),
        [0, 0, 0],
      );

      expect(decodeOscell(missing!.bytes).vertexCount).toBe(decodeOscell(whole!.bytes).vertexCount);
      expect(missing!.stats.animatedStatic).toBe(1);
      expect(missing!.stats.animatedObjects).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('applies the atomic frame chain for a CLUMP def and drops it for a simple one (SA parity, 095)', () => {
      // `LoadAtomicFile` hands every atomic a fresh identity frame, so a plain objs/tobj model's own frame
      // transform is dead data; only `anim` entries load as clumps and keep their hierarchy. `nt_noddonkbase`
      // is a 5-atomic pump whose parts hang off offset frames, so the two paths cannot land on the same box.
      const fs = animFs();

      // A missing IFP keeps the CLUMP path (no frame is excluded) — the difference is the transform alone.
      const asClump = weldCell(
        fs,
        animDefs('no_such_ifp'),
        animCell(),
        false,
        new TexturePlanner(fs, new Map()),
        [0, 0, 0],
      );
      const asSimple = weldCell(fs, animDefs(null), animCell(), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      expect(decodeOscell(asSimple!.bytes).vertexCount).toBe(decodeOscell(asClump!.bytes).vertexCount);
      // The same vertices land in a different place. Measured for this pump: 75.79 simple vs 66.82 as a
      // clump — direction is not the point (its frames pull parts together as often as apart), the point is
      // that a simple def must not be moved by data SA throws away.
      expect(spread(asSimple!.bytes)).not.toBeCloseTo(spread(asClump!.bytes), 1);
    });

    it('leaves the MOVING frames out of the bundle and welds the rest (the host draws the moving part live)', () => {
      const fs = animFs();

      const still = weldCell(fs, animDefs(null), animCell(), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);
      const animated = weldCell(fs, animDefs(), animCell(), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      const whole = decodeOscell(still!.bytes).vertexCount;
      const staticOnly = decodeOscell(animated!.bytes).vertexCount;
      // Some geometry left (the moving arm) — and some stayed (the pump's base). Weld ALL of it and the arm
      // shows twice: a frozen copy in the bundle plus the live one on top of it.
      expect(staticOnly).toBeGreaterThan(0);
      expect(staticOnly).toBeLessThan(whole);
      expect(animated!.stats.animatedObjects).toBe(1);
      expect(animated!.stats.animatedStatic).toBe(0);
    });
  });
});

describe('weldCell breakables', () => {
  describe('negative cases', () => {
    it('records NO smashable ranges for a LOD cell — a far prop is never hit', () => {
      const fs = fixtureFs();
      const cell: GridCell = { ...fixtureCell(2), hd: [], lod: fixtureCell(2).hd };

      const welded = weldCell(fs, fixtureDefs(), cell, true, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      expect(decodeOscell(welded!.bytes).breakables).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('records each smashable placement’s index ranges, keyed so a physics hit resolves to one prop', () => {
      // trafficlight1 ships an RW Breakable shatter mesh. The prop stays INSIDE the merged bundle (splitting
      // it out per placement measured 4.5x the draw calls) — the engine shatters it by degenerating exactly
      // these index ranges.
      const fs = fixtureFs();

      const welded = weldCell(fs, fixtureDefs(), fixtureCell(3), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      const cell = decodeOscell(welded!.bytes);
      expect(cell.breakables.length).toBeGreaterThan(0);
      expect(new Set(cell.breakables.map((breakable) => breakable.keyHash)).size).toBe(3); // 3 placements
      for (const breakable of cell.breakables) {
        expect(breakable.indexCount).toBeGreaterThan(0);
        expect(breakable.indexOffset + breakable.indexCount).toBeLessThanOrEqual(cell.indexCount);
      }
    });

    it('tags a smashable prop’s 2dfx lights with its placement — a smashed traffic light takes its coronas', () => {
      // Without the owner tag the coronas stayed lit in mid-air after the pole itself was gone.
      const fs = fixtureFs();

      const welded = weldCell(fs, fixtureDefs(), fixtureCell(2), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      const cell = decodeOscell(welded!.bytes);
      expect(cell.lights.length).toBeGreaterThan(0);
      expect(cell.lights.every((light) => light.owner !== 0)).toBe(true);
      const placements = new Set(cell.breakables.map((breakable) => breakable.keyHash));
      for (const light of cell.lights) {
        expect(placements.has(light.owner)).toBe(true);
      }
    });
  });
});

// `mine`: a stock model with NO prelit and NO night set + an EMPTY txd — the plainest timed-model fixture.
const MINE_DFF = 'fixtures/original/dff/empty-txd/mine.dff';
const MINE_TXD = 'fixtures/original/dff/empty-txd/mine.txd';

function mineCell(): GridCell {
  return {
    cx: 0,
    cy: 0,
    hd: [{ id: 4001, interior: 0, lod: -1, modelName: 'mine', position: [0, 0, 0], rotation: [0, 0, 0, 1] }],
    lod: [],
  };
}

function mineDefs(def: Partial<IdeObjectDef> = {}): MapDefinitions {
  const catalog = new Map<number, IdeObjectDef>();
  catalog.set(4001, { drawDistance: 100, flags: 0, id: 4001, modelName: 'mine', txdName: 'mine', ...def });

  return {
    carGenerators: [],
    catalog,
    imgDirs: [],
    instances: [],
    timedCatalog: new Map<number, IdeObjectDef>(),
    txdParents: new Map<string, string>(),
  };
}

// The breakable bin (DXT3 alpha texture `bins2_LAe2`) — the ALPHA side of the additive-class test.
const BIN_DFF = 'fixtures/original/dff/breakable/binnt08_la.dff';
const BIN_TXD = 'fixtures/original/dff/breakable/labins01_la.txd';

function binCell(): GridCell {
  return {
    cx: 0,
    cy: 0,
    hd: [
      {
        id: 1337,
        interior: 0,
        lod: -1,
        modelName: 'binnt08_la',
        position: [10, 10, 5],
        rotation: [0, 0, 0, 1],
      },
    ],
    lod: [],
  };
}

function binDefs(def: Partial<IdeObjectDef> = {}): MapDefinitions {
  const catalog = new Map<number, IdeObjectDef>();
  catalog.set(1337, {
    drawDistance: 80,
    flags: 0,
    id: 1337,
    modelName: 'binnt08_la',
    txdName: 'labins01_la',
    ...def,
  });

  return {
    carGenerators: [],
    catalog,
    imgDirs: [],
    instances: [],
    timedCatalog: new Map<number, IdeObjectDef>(),
    txdParents: new Map<string, string>(),
  };
}

function binFs(): AssetFileSystem {
  const archive = openArchive(
    buildArchiveBuffer([
      { data: readFileSync(BIN_DFF), name: 'binnt08_la.dff' },
      { data: readFileSync(BIN_TXD), name: 'labins01_la.txd' },
    ]),
  );

  return {
    ...archive,
    get: (name) => archive.get(name),
    getText: () => null,
    has: (name) => archive.get(name) !== null,
  };
}

function mineFs(): AssetFileSystem {
  const archive = openArchive(
    buildArchiveBuffer([
      { data: readFileSync(MINE_DFF), name: 'mine.dff' },
      { data: readFileSync(MINE_TXD), name: 'mine.txd' },
    ]),
  );

  return {
    get: (name: string) => archive.get(name.split('/').pop() ?? name),
    getText: () => null,
    has: (name: string) => archive.get(name.split('/').pop() ?? name) !== null,
  } as unknown as AssetFileSystem;
}

describe('weldCell', () => {
  describe('negative cases', () => {
    it('returns null for an empty cell', () => {
      const fs = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      expect(weldCell(fs, fixtureDefs(), { cx: 0, cy: 0, hd: [], lod: [] }, false, planner, [0, 0, 0])).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('routes an IdeFlag.ADDITIVE def to pipelineClass 4 only for ALPHA materials (085 rows C + H)', () => {
      // vgncircus2neon's real flags: DRAW_LAST (0x4) + ADDITIVE (0x8) + 0x80; its glow textures are DXT3
      // WITH alpha and vanilla ADDs them (row C). casinoblock3_nt carries the same flags over DXT1
      // NO-alpha textures and vanilla draws those in the opaque pass — classing them additive erased
      // every black texel and opened see-through holes in the Fremont facade (row H).
      const alphaFs = binFs();
      const welded = weldCell(
        alphaFs,
        binDefs({ flags: 140 }),
        binCell(),
        false,
        new TexturePlanner(alphaFs, new Map()),
        [0, 0, 0],
      );

      const classes = new Set(decodeOscell(welded!.bytes).groups.map((group) => group.pipelineClass));
      expect(classes).toEqual(new Set([4]));
      // The same model without the flag never lands there.
      const plain = weldCell(alphaFs, binDefs(), binCell(), false, new TexturePlanner(alphaFs, new Map()), [0, 0, 0]);
      expect(decodeOscell(plain!.bytes).groups.some((group) => group.pipelineClass === 4)).toBe(false);

      // Opaque-textured model with the SAME flags: stays lit geometry (row H — vanilla only additive-blends
      // the alpha pass; DXT1 materials render opaque and their black texels must occlude).
      const fs = fixtureFs();
      const opaque = weldCell(
        fs,
        fixtureDefs({ flags: 140 }),
        fixtureCell(1),
        false,
        new TexturePlanner(fs, new Map()),
        [0, 0, 0],
      );
      expect(decodeOscell(opaque!.bytes).groups.some((group) => group.pipelineClass === 4)).toBe(false);
    });

    it('routes an alpha MASK to the depth-writing cutout class, and an overlay def back to blend (092)', () => {
      // `bins2_LAe2` is a DXT3 mask whose edge is far wider than the 2 % cutout bound, so it used to weld as
      // pipelineClass 2 — no depth write, and whatever is behind paints over it. That is the Watts Towers bug.
      const fs = binFs();
      const masked = weldCell(fs, binDefs(), binCell(), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);
      const maskClasses = new Set(decodeOscell(masked!.bytes).groups.map((group) => group.pipelineClass));
      expect(maskClasses.has(1)).toBe(true);
      expect(maskClasses.has(2)).toBe(false);

      // NO_ZBUFFER_WRITE (0x40) is SA declaring an OVERLAY — ground decals, graffiti, road lines. A cutout
      // writes depth and compares `greater`, so a coplanar overlay would lose its own test: it stays blend.
      const overlay = weldCell(
        fs,
        binDefs({ flags: IdeFlag.NO_ZBUFFER_WRITE }),
        binCell(),
        false,
        new TexturePlanner(fs, new Map()),
        [0, 0, 0],
      );
      const overlayClasses = new Set(decodeOscell(overlay!.bytes).groups.map((group) => group.pipelineClass));
      expect(overlayClasses.has(2)).toBe(true);
      expect(overlayClasses.has(1)).toBe(false);

      // …but only for ALPHA materials (plan 039): bare-0x40 opaque terrain must keep occluding.
      const opaqueFs = fixtureFs();
      const terrain = weldCell(
        opaqueFs,
        fixtureDefs({ flags: IdeFlag.NO_ZBUFFER_WRITE }),
        fixtureCell(1),
        false,
        new TexturePlanner(opaqueFs, new Map()),
        [0, 0, 0],
      );
      expect(decodeOscell(terrain!.bytes).groups.every((group) => group.pipelineClass === 0)).toBe(true);
    });

    it('welds animated defs statically and counts them (field fix: anim skip left building-sized holes)', () => {
      const fs = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());
      const welded = weldCell(fs, fixtureDefs({ anim: 'trafficlight' }), fixtureCell(2), false, planner, [0, 0, 0]);

      expect(welded).not.toBeNull();
      expect(welded!.stats.animatedStatic).toBe(2);
      expect(decodeOscell(welded!.bytes).vertexCount).toBeGreaterThan(0);
    });

    it('welds timed defs into trailing objectTable entries (074/06 row 9)', () => {
      const fs = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());
      const welded = weldCell(fs, fixtureDefs({ time: { off: 6, on: 20 } }), fixtureCell(2), false, planner, [0, 0, 0]);

      expect(welded).not.toBeNull();
      const cell = decodeOscell(welded!.bytes);
      expect(cell.objects.length).toBeGreaterThan(0);
      for (const object of cell.objects) {
        expect(object.kind).toBe(0);
        expect(object.params & 0xff).toBe(20); // on hour
        expect((object.params >> 8) & 0xff).toBe(6); // off hour
        expect(object.groupStart + object.groupCount).toBeLessThanOrEqual(cell.groups.length);
      }
      // Every group is owned by an object here (the whole cell is timed).
      const owned = cell.objects.reduce((sum, object) => sum + object.groupCount, 0);
      expect(owned).toBe(cell.groups.length);
      expect(welded!.stats.timedObjects).toBe(cell.objects.length);
    });
    it('keeps a NIGHT-ONLY timed model fullbright: night = day prelit, emissive vs void (085 row D)', () => {
      // `mine` carries NO night set (and no prelit — day defaults to white): the class of model the dark
      // day×ambient synthesis crushed. casinoblock41_nt's window: shown 22→5 only; its day prelit IS the
      // night look. A model WITH an authored night set keeps it — the trafficlight tests above cover that.
      const fs = mineFs();

      const welded = weldCell(
        fs,
        mineDefs({ time: { off: 5, on: 22 } }),
        mineCell(),
        false,
        new TexturePlanner(fs, new Map()),
        [0, 0, 0],
      );

      const cell = decodeOscell(welded!.bytes);
      const view = new DataView(cell.vertexData.buffer, cell.vertexData.byteOffset, cell.vertexData.byteLength);
      for (let vertex = 0; vertex < cell.vertexCount; vertex += 1) {
        const at = vertex * OSCELL_VERTEX_STRIDE;
        for (let channel = 0; channel < 3; channel += 1) {
          expect(view.getUint8(at + 28 + channel)).toBe(view.getUint8(at + 24 + channel));
        }
        expect(view.getUint16(at + 34, true) >> 8).toBe(255); // fullbright vs void ⇒ full mask
      }
      expect(cell.channelMask & OscellChannel.EMISSIVE).not.toBe(0);
    });

    it('still synthesizes the dark ambient night for a DAY-window timed model', () => {
      const fs = mineFs();

      const welded = weldCell(
        fs,
        mineDefs({ time: { off: 22, on: 5 } }),
        mineCell(),
        false,
        new TexturePlanner(fs, new Map()),
        [0, 0, 0],
      );

      const cell = decodeOscell(welded!.bytes);
      const view = new DataView(cell.vertexData.buffer, cell.vertexData.byteOffset, cell.vertexData.byteLength);
      for (let vertex = 0; vertex < cell.vertexCount; vertex += 1) {
        const at = vertex * OSCELL_VERTEX_STRIDE;
        expect(view.getUint8(at + 28)).toBeLessThan(view.getUint8(at + 24)); // night = day × ambient
        expect(view.getUint16(at + 34, true) >> 8).toBe(0); // synthesized night never glows
      }
    });

    it('bakes multiple instances into merged groups (few draws, correct totals)', () => {
      const fs = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());
      const instances = 5;
      const welded = weldCell(fs, fixtureDefs(), fixtureCell(instances), false, planner, [2350, 0, 1650]);

      expect(welded).not.toBeNull();
      const cell = decodeOscell(welded!.bytes);
      // Groups are per (array, class, side) — NOT per instance: 5 traffic lights share the same few groups.
      expect(cell.groups.length).toBeLessThanOrEqual(6);
      expect(cell.groups.length).toBeGreaterThan(0);
      expect(cell.vertexCount).toBeGreaterThan(0);
      expect(cell.indexCount % 3).toBe(0);
      // Index payload references valid vertices.
      const indices = cell.index16
        ? new Uint16Array(cell.indexData.buffer, cell.indexData.byteOffset, cell.indexCount)
        : new Uint32Array(cell.indexData.buffer, cell.indexData.byteOffset, cell.indexCount);
      for (const index of indices) {
        expect(index).toBeLessThan(cell.vertexCount);
      }
      // 5 instances ⇒ 5× the single-instance geometry.
      const single = weldCell(
        fs,
        fixtureDefs(),
        fixtureCell(1),
        false,
        new TexturePlanner(fs, new Map()),
        [2350, 0, 1650],
      );
      expect(cell.vertexCount).toBe(decodeOscell(single!.bytes).vertexCount * instances);
    });

    it('is deterministic (same input ⇒ identical bytes)', () => {
      const fs = fixtureFs();
      const a = weldCell(fs, fixtureDefs(), fixtureCell(3), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);
      const b = weldCell(fs, fixtureDefs(), fixtureCell(3), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      expect([...a!.bytes]).toEqual([...b!.bytes]);
    });
  });
});

// The LV strip's neon-rope palm (vegaxref 3509): the rope's night set is saturated red (255/49/49) over a
// flat grey day (81/81/81) — its Rec709 luma is BARELY above the day's, the case that broke the luma-delta
// emissive rule (the rope never glowed while the bark next to it did).
const NITREE_DFF = 'fixtures/original/dff/night-colours/vgsn_nitree_r01.dff';
const NITREE_TXD = 'fixtures/original/dff/night-colours/vgsn_nitree.txd';

/** Per-vertex emissive bytes (channels u16 high byte) of a welded cell. */
function emissiveBytes(bytes: Uint8Array): number[] {
  const cell = decodeOscell(bytes);
  const view = new DataView(cell.vertexData.buffer, cell.vertexData.byteOffset, cell.vertexData.byteLength);
  const out: number[] = [];
  for (let vertex = 0; vertex < cell.vertexCount; vertex += 1) {
    out.push(view.getUint16(vertex * OSCELL_VERTEX_STRIDE + 34, true) >> 8);
  }

  return out;
}

function nitreeCell(): GridCell {
  return {
    cx: 0,
    cy: 0,
    hd: [
      {
        id: 3509,
        interior: 0,
        lod: -1,
        modelName: 'VgsN_nitree_r01',
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      },
    ],
    lod: [],
  };
}

function nitreeDefs(): MapDefinitions {
  const catalog = new Map<number, IdeObjectDef>();
  catalog.set(3509, {
    drawDistance: 120,
    flags: 2097156,
    id: 3509,
    modelName: 'VgsN_nitree_r01',
    txdName: 'vgsn_nitree',
  });

  return {
    carGenerators: [],
    catalog,
    imgDirs: [],
    instances: [],
    timedCatalog: new Map<number, IdeObjectDef>(),
    txdParents: new Map<string, string>(),
  };
}

function nitreeFs(): AssetFileSystem {
  const archive = openArchive(
    buildArchiveBuffer([
      { data: readFileSync(NITREE_DFF), name: 'vgsn_nitree_r01.dff' },
      { data: readFileSync(NITREE_TXD), name: 'vgsn_nitree.txd' },
    ]),
  );

  return {
    get: (name: string) => archive.get(name.split('/').pop() ?? name),
    getText: () => null,
    has: (name: string) => archive.get(name.split('/').pop() ?? name) !== null,
  } as unknown as AssetFileSystem;
}

describe('weldCell night emissive mask', () => {
  describe('negative cases', () => {
    it('keeps the mask at 0 where the night set is darker than day on every channel (foliage)', () => {
      const fs = nitreeFs();

      const welded = weldCell(fs, nitreeDefs(), nitreeCell(), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      // The palm's leaves/planta night sets sit far below their day prelit — they must not glow.
      const zeros = emissiveBytes(welded!.bytes).filter((value) => value === 0).length;
      expect(zeros).toBeGreaterThan(50);
    });
  });

  describe('positive cases', () => {
    it('fires on a saturated neon night set whose LUMA barely beats the day (the LV rope light)', () => {
      const fs = nitreeFs();

      const welded = weldCell(fs, nitreeDefs(), nitreeCell(), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      // The rope is 128 source vertices at night 255/49/49 over day 81 — max-channel delta 0.68 ⇒ full mask.
      // The luma rule read the same vertices as delta 0.046 (below the 0.05 floor) and left the rope dark.
      const full = emissiveBytes(welded!.bytes).filter((value) => value === 255).length;
      expect(full).toBeGreaterThanOrEqual(100);
      expect(decodeOscell(welded!.bytes).channelMask & OscellChannel.EMISSIVE).not.toBe(0);
    });
  });
});

// visagesign04: a stock UV-animated sign whose DFF opens with a UVAnimDict — three materials each scroll a
// dict entry (Money, DolSign, Material #2065564020). The exact case the parser's uvAnim support was built on.
const UVANIM_DFF = 'fixtures/custom/dff/uv-anim/visagesign04.dff';

function uvAnimCell(): GridCell {
  return {
    cx: 0,
    cy: 0,
    hd: [{ id: 5000, interior: 0, lod: -1, modelName: 'visagesign04', position: [10, 20, 30], rotation: [0, 0, 0, 1] }],
    lod: [],
  };
}

function uvAnimDefs(def: Partial<IdeObjectDef> = {}): MapDefinitions {
  const catalog = new Map<number, IdeObjectDef>();
  catalog.set(5000, {
    drawDistance: 100,
    flags: 0,
    id: 5000,
    modelName: 'visagesign04',
    txdName: 'visagesign04',
    ...def,
  });

  return {
    carGenerators: [],
    catalog,
    imgDirs: [],
    instances: [],
    timedCatalog: new Map<number, IdeObjectDef>(),
    txdParents: new Map<string, string>(),
  };
}

function uvAnimFs(): AssetFileSystem {
  const archive = openArchive(buildArchiveBuffer([{ data: readFileSync(UVANIM_DFF), name: 'visagesign04.dff' }]));

  return {
    get: (name: string) => archive.get(name.split('/').pop() ?? name),
    getText: () => null,
    has: (name: string) => archive.get(name.split('/').pop() ?? name) !== null,
  } as unknown as AssetFileSystem;
}

describe('weldCell UV-scroll (B7·c)', () => {
  describe('negative cases', () => {
    it('welds a scroller STATICALLY with no registry (occluder weld) — no kind-4 objects, geometry still drawn', () => {
      const fs = uvAnimFs();

      const welded = weldCell(fs, uvAnimDefs(), uvAnimCell(), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      const cell = decodeOscell(welded!.bytes);
      expect(cell.objects.filter((object) => object.kind === 4)).toHaveLength(0);
      expect(cell.vertexCount).toBeGreaterThan(0);
    });

    it('never scrolls a LOD copy — a second ghost sign would crawl behind the HD one', () => {
      const fs = uvAnimFs();
      const registry = createUvAnimRegistry();
      const cell: GridCell = { ...uvAnimCell(), hd: [], lod: uvAnimCell().hd };

      const welded = weldCell(
        fs,
        uvAnimDefs(),
        cell,
        true,
        new TexturePlanner(fs, new Map()),
        [0, 0, 0],
        undefined,
        registry,
      );

      expect(decodeOscell(welded!.bytes).objects.filter((object) => object.kind === 4)).toHaveLength(0);
      expect(registry.byName.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('routes a TIMED scroller to ONE kind-5 row — window beside the slot, no kind-0 twin (minor 7)', () => {
      // casinoblock41_nt: a scroller that exists only 22→5. Minor 6 wrote it as TWO rows (kind 0 + kind 4):
      // the stripes ran around the clock and the geometry doubled inside the window.
      const fs = uvAnimFs();
      const registry = createUvAnimRegistry();

      const welded = weldCell(
        fs,
        uvAnimDefs({ time: { off: 5, on: 22 } }),
        uvAnimCell(),
        false,
        new TexturePlanner(fs, new Map()),
        [0, 0, 0],
        undefined,
        registry,
      );

      const cell = decodeOscell(welded!.bytes);
      // The model's NON-scrolling remainder stays a plain kind-0 timed draw; the three scroll materials
      // become kind-5 rows — and none of them gets a kind-0 twin (the double-draw this kind fixes).
      const timedRows = cell.objects.filter((object) => object.kind === 0);
      expect(timedRows).toHaveLength(1);
      expect(cell.objects.filter((object) => object.kind === 4)).toHaveLength(0);
      const scrollers = cell.objects.filter((object) => object.kind === 5);
      expect(scrollers).toHaveLength(3);
      const scrollerGroups = new Set(scrollers.map((object) => object.groupStart));
      expect(scrollerGroups.has(timedRows[0].groupStart)).toBe(false);
      for (const object of scrollers) {
        expect((object.params >> 16) & 0xff).toBe(22); // on hour
        expect((object.params >> 24) & 0xff).toBe(5); // off hour
        expect(object.params & 0xffff).toBeLessThan(uvAnimList(registry).length); // the animation slot
      }
    });

    it('routes each UVAnimDict material to a kind-4 objectTable draw and registers the animation globally', () => {
      const fs = uvAnimFs();
      const registry = createUvAnimRegistry();

      const welded = weldCell(
        fs,
        uvAnimDefs(),
        uvAnimCell(),
        false,
        new TexturePlanner(fs, new Map()),
        [0, 0, 0],
        undefined,
        registry,
      );

      const cell = decodeOscell(welded!.bytes);
      const scrollers = cell.objects.filter((object) => object.kind === 4);
      expect(scrollers).toHaveLength(3);
      expect(welded!.stats.uvAnimObjects).toBe(3);
      const list = uvAnimList(registry);
      expect(new Set(list.map((animation) => animation.name))).toEqual(
        new Set(['DolSign', 'Material #2065564020', 'Money']),
      );
      // Each scroller's slot indexes the manifest list; the groups leave the merged bundle (object-owned).
      const slots = scrollers.map((object) => object.params);
      expect(new Set(slots).size).toBe(3);
      for (const object of scrollers) {
        expect(object.params).toBeGreaterThanOrEqual(0);
        expect(object.params).toBeLessThan(list.length);
        expect(object.groupCount).toBe(1);
        expect(object.groupStart + object.groupCount).toBeLessThanOrEqual(cell.groups.length);
      }
    });

    it('shares one slot across cells — SA dict names are global identifiers', () => {
      const fs = uvAnimFs();
      const registry = createUvAnimRegistry();

      weldCell(
        fs,
        uvAnimDefs(),
        uvAnimCell(),
        false,
        new TexturePlanner(fs, new Map()),
        [0, 0, 0],
        undefined,
        registry,
      );
      const afterFirst = registry.byName.size;
      weldCell(
        fs,
        uvAnimDefs(),
        uvAnimCell(),
        false,
        new TexturePlanner(fs, new Map()),
        [500, 0, 0],
        undefined,
        registry,
      );

      expect(afterFirst).toBe(3);
      expect(registry.byName.size).toBe(3); // the second cell adds no new names
    });
  });
});

describe('frameWorldTransform', () => {
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  describe('negative cases', () => {
    it('returns null for an identity chain (the static-world fast path)', () => {
      const frames = [
        { name: 'root', parentIndex: -1, position: [0, 0, 0] as [number, number, number], rotation: IDENTITY },
        { name: 'mesh', parentIndex: 0, position: [0, 0, 0] as [number, number, number], rotation: IDENTITY },
      ];

      expect(frameWorldTransform(frames, 1)).toBeNull();
      expect(frameWorldTransform(frames, -1)).toBeNull();
      expect(frameWorldTransform([], 5)).toBeNull();
    });

    it('ignores the clump ROOT frame — SA overwrites its matrix, and anti-rip mods poison exactly it', () => {
      // The comet lock: rotation[0][0] = −3.9e14 on the root, everything else identity. Composing it flung
      // every off-centre part to ±1e14 while the real game rendered the car whole.
      const frames = [
        {
          name: 'comet',
          parentIndex: -1,
          position: [0, 0, 5] as [number, number, number],
          rotation: [-3.9e14, 0, 0, 0, 1, 0, 0, 0, 1],
        },
        {
          name: 'door_lf_dummy',
          parentIndex: 0,
          position: [-0.8, 0.5, 0] as [number, number, number],
          rotation: IDENTITY,
        },
      ];
      const transform = frameWorldTransform(frames, 1);

      expect(transform).not.toBeNull();
      expect(transform!.pos).toEqual([-0.8, 0.5, 0]); // the child's own translation, no root contribution
      expect(transform!.rot).toEqual(IDENTITY);
    });
  });

  describe('positive cases', () => {
    it('composes the parent chain below the root (translation + RW column-basis rotation)', () => {
      // Leaf rotates 90° about Z (RW columns: right=(0,1,0), up=(−1,0,0), at=(0,0,1)), its parent lifts
      // by 5. The root's own transform never renders in SA (the entity matrix replaces it), so the lift
      // lives on a mid frame here.
      const frames = [
        { name: 'root', parentIndex: -1, position: [0, 0, 0] as [number, number, number], rotation: IDENTITY },
        { name: 'chassis', parentIndex: 0, position: [0, 0, 5] as [number, number, number], rotation: IDENTITY },
        {
          name: 'part',
          parentIndex: 1,
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 1, 0, -1, 0, 0, 0, 0, 1],
        },
      ];
      const transform = frameWorldTransform(frames, 2);

      expect(transform).not.toBeNull();
      const { pos, rot } = transform!;
      // v = (1, 0, 0) → rotated (0, 1, 0) → lifted (0, 1, 5).
      const v = [1, 0, 0];
      const world = [
        rot[0] * v[0] + rot[1] * v[1] + rot[2] * v[2] + pos[0],
        rot[3] * v[0] + rot[4] * v[1] + rot[5] * v[2] + pos[1],
        rot[6] * v[0] + rot[7] * v[1] + rot[8] * v[2] + pos[2],
      ];
      expect(world[0]).toBeCloseTo(0);
      expect(world[1]).toBeCloseTo(1);
      expect(world[2]).toBeCloseTo(5);
    });
  });
});

describe('weldCell placement mapper (minor 6)', () => {
  describe('negative cases', () => {
    it('writes no name pool when the cell welded nothing', () => {
      const empty: GridCell = { cx: 9, cy: -7, hd: [], lod: [] };

      const welded = weldCell(
        fixtureFs(),
        fixtureDefs(),
        empty,
        false,
        new TexturePlanner(fixtureFs(), new Map()),
        [0, 0, 0],
      );

      expect(welded).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('names every placement and points its ranges at real triangles', () => {
      const fs = fixtureFs();
      const welded = weldCell(fs, fixtureDefs(), fixtureCell(3), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      const cell = decodeOscell(welded!.bytes);

      expect(welded!.stats.placements).toBe(cell.placements.length);
      expect(cell.placements.length).toBeGreaterThanOrEqual(3); // three instances, at least one row each
      for (const placement of cell.placements) {
        expect(cell.names[placement.nameRef]).toBe('trafficlight1');
        expect(cell.names[placement.txdRef]).toBe('dyntraffic');
        expect(placement.indexCount).toBeGreaterThan(0);
        expect(placement.indexOffset + placement.indexCount).toBeLessThanOrEqual(cell.indexCount);
      }
    });

    it('gives each instance its own id and its own box, at the position it was placed', () => {
      const fs = fixtureFs();
      const welded = weldCell(fs, fixtureDefs(), fixtureCell(3), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      const cell = decodeOscell(welded!.bytes);
      const ids = new Set(cell.placements.map((placement) => placement.id));

      expect(ids.size).toBe(3);
      // The three lights stand 10 u apart on GTA +x, which is engine +x — so their boxes must too.
      const minX = [...ids]
        .map((id) => Math.min(...cell.placements.filter((p) => p.id === id).map((p) => p.bounds[0])))
        .sort((a, b) => a - b);
      expect(minX[1] - minX[0]).toBeCloseTo(10, 1);
      expect(minX[2] - minX[1]).toBeCloseTo(10, 1);
    });

    it('covers every triangle in the cell exactly once across the mapper', () => {
      const fs = fixtureFs();
      const welded = weldCell(fs, fixtureDefs(), fixtureCell(2), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      const cell = decodeOscell(welded!.bytes);
      const covered = cell.placements.reduce((total, placement) => total + placement.indexCount, 0);

      // A gap would be an unpickable object; an overlap would mean two objects claim the same triangles.
      expect(covered).toBe(cell.indexCount);
    });
  });
});

/** A LOD-level copy of the traffic-light cell: the same instances, filed under `lod`. */
function lodFixtureCell(): GridCell {
  return { ...fixtureCell(1), hd: [], lod: fixtureCell(1).hd };
}

/** One plate's worth of glyph quads at a world position, in the shape the pre-pass produces. */
function plate(x: number, y: number, z: number, quads = 1): RoadsignGlyphQuads {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let q = 0; q < quads; q += 1) {
    const left = x + q;
    positions.push(left, y, z, left + 1, y, z, left + 1, y, z + 1, left, y, z + 1);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  }

  return { colour: 0, positions, uvs };
}

/** Weld one level with an optional roadsign list, at the traffic-light cell's origin. */
function weldWithSigns(
  lod: boolean,
  cell: GridCell,
  signs?: RoadsignGlyphQuads[],
): null | { quads: number; rows: number; signs: number } {
  const fs = fixtureFs();
  const welded = weldCellParts(
    fs,
    fixtureDefs(),
    cell,
    lod,
    new TexturePlanner(fs, new Map()),
    [2350, 0, 1650],
    undefined,
    undefined,
    signs,
  );
  if (!welded) {
    return null;
  }

  // `stats.vertices` only fills during the later encode pass, so count the scratch buckets themselves.
  return {
    quads: welded.stats.roadsignQuads,
    rows: welded.buckets.reduce((total, bucket) => total + bucket.vertices.length, 0),
    signs: welded.stats.roadsigns,
  };
}

describe('weldCell roadsign text', () => {
  describe('negative cases', () => {
    it('welds each plate ONCE into a bundle, however many bundles the cell has', () => {
      // A plate is world-space, so the pre-pass files it under exactly one cell key and hands the SAME list
      // to both levels. Neither bundle may contain it twice, and the two bundles are never resident together
      // — one slot, one level, and the HD↔LOD swap unloads the old key inside the same call.
      const signs = [plate(2350, -1650, 20), plate(2360, -1650, 20)];

      expect(weldWithSigns(false, fixtureCell(1), signs)?.signs).toBe(2);
      expect(weldWithSigns(true, lodFixtureCell(), signs)?.signs).toBe(2);
    });
  });

  describe('positive cases', () => {
    it('counts GLYPH QUADS, not signs — the number the LOD-range reading is taken from', () => {
      // `roadsigns` is how many plates welded; `roadsignQuads` is how much TEXT, and only the second can
      // answer "is this plate blank at LOD range" (minor 8). One sign of three glyphs must read 1 and 3.
      const withText = weldWithSigns(true, lodFixtureCell(), [plate(2350, -1650, 20, 3)]);

      expect(withText?.signs).toBe(1);
      expect(withText?.quads).toBe(3);
    });

    it('counts the same quads on BOTH levels — a plate that thins at range is the defect', () => {
      const signs = [plate(2350, -1650, 20, 2), plate(2360, -1650, 20, 4)];

      expect(weldWithSigns(false, fixtureCell(1), signs)?.quads).toBe(6);
      expect(weldWithSigns(true, lodFixtureCell(), signs)?.quads).toBe(6);
    });

    it('welds the text into a LOD bundle — the 440→1000 u band used to draw a blank plate', () => {
      const bare = weldWithSigns(true, lodFixtureCell());
      const withText = weldWithSigns(true, lodFixtureCell(), [plate(2350, -1650, 20)]);

      expect(bare?.signs).toBe(0);
      expect(withText?.signs).toBe(1);
      // The glyphs are real geometry, not just a counter: the bundle grows by the quad.
      expect(withText!.rows).toBeGreaterThan(bare!.rows);
    });
  });
});

describe('isVegetationDef', () => {
  describe('negative cases', () => {
    it('says no for a model that is neither flagged nor listed', () => {
      expect(isVegetationDef({ flags: 0, modelName: 'ws_streetlight1' })).toBe(false);
    });

    it('does not turn an unrelated lod-prefixed model into vegetation', () => {
      // Stock building LODs are named `lod<model>` too; stripping the prefix must only MATCH the list,
      // never invent membership.
      expect(isVegetationDef({ flags: 0, modelName: 'lodger01_law' })).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('reads the IDE vegetation bits', () => {
      expect(isVegetationDef({ flags: IdeFlag.IS_TREE, modelName: 'whatever' })).toBe(true);
      expect(isVegetationDef({ flags: IdeFlag.IS_PALM, modelName: 'whatever' })).toBe(true);
    });

    it('classes a generated impostor as its SOURCE when the source is listed by name only', () => {
      // 105 of the 184 impostors of the 2026-08-21 build are in this case: the stock row carries no
      // vegetation bit, so the LOD inherits none and only the NAME can say what it stands for.
      expect(isVegetationDef({ flags: 0, modelName: 'ash1_hi' })).toBe(true);
      expect(isVegetationDef({ flags: 0, modelName: 'lodash1_hi' })).toBe(true);
    });
  });
});
