import {
  encodeOscell,
  encodeOstex,
  type Oscell,
  OSCELL_VERTEX_STRIDE,
  OstexFormat,
  ostexLayerBytes,
} from '@opensa/engine-formats';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

/**
 * What the engine DECIDES each frame, asserted through a recording device (plan 077 phase 3).
 *
 * These are the decisions the bench cannot see and a screenshot can only hint at: the hour gate on `tobj`
 * objects, the two-phase opaque→blend ordering that a 2026-07-12 field bug taught us, and the residency
 * ledger returning to its prior line on unload. None of them need a GPU — only a device-shaped recorder.
 */

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

const camera = (eye: [number, number, number] = [0, 0, 30]): CameraState => ({
  aspect: 16 / 9,
  eye,
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target: [eye[0] + 100, eye[1], eye[2]],
  up: [0, 0, 1],
});

/** Booted engine with texture array 0 present — the load order the engine enforces. */
async function bootedEngine(): Promise<Engine> {
  const engine = new Engine();
  await engine.init(harness.canvas);
  engine.textures.load(0, textureArrayBytes());

  return engine;
}

/** A minimal but VALID cell: one triangle, one group, at `origin`. */
function cellBytes(overrides: Partial<Oscell> = {}): Uint8Array {
  const vertexCount = 3;

  return encodeOscell({
    bounds: [0, 0, 0, 50],
    breakables: [],
    channelMask: 0,
    groups: [{ bounds: [0, 0, 0, 50], indexCount: 3, indexOffset: 0, pipelineClass: 0, side: 0, textureArrayRef: 0 }],
    index16: false,
    indexCount: 3,
    indexData: new Uint8Array(new Uint32Array([0, 1, 2]).buffer),
    lights: [],
    names: [],
    objects: [],
    origin: [0, 0, 0],
    particles: [],
    placements: [],
    roadsignQuads: 0,
    vertexCount,
    vertexData: new Uint8Array(vertexCount * OSCELL_VERTEX_STRIDE),
    ...overrides,
  });
}

/** A 4x4 single-layer RGBA8 array — cells reference texture array 0, which must exist before they load. */
function textureArrayBytes(): Uint8Array {
  const size = 4;

  return encodeOstex({
    format: OstexFormat.RGBA8,
    height: size,
    layers: [{ alphaClass: 0, cutoutRef: 0, nameHash: 1, wrap: 0 }],
    mipCount: 1,
    payload: new Uint8Array(ostexLayerBytes(OstexFormat.RGBA8, size, size, 1)),
    premultiplied: false,
    width: size,
  });
}

/** A cell whose single object is a `tobj` visible in [on, off). */
function timedCellBytes(on: number, off: number): Uint8Array {
  return cellBytes({
    objects: [
      {
        groupCount: 1,
        groupStart: 0,
        kind: 0, // timed
        params: (off << 8) | on,
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      },
    ],
  });
}

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

/**
 * Draws the WORLD contributed this frame, excluding the unconditional sky draw the pass always issues.
 * (Counting raw draws would make every "nothing visible" assertion off by one — the sky is not a cell.)
 */
const worldDraws = (): number => Math.max(0, gpu.draws.filter((draw) => draw.pass.includes('world')).length - 1);

/** Cell bundles executed into the world pass — the signal that a CELL, not the sky, rendered. */
const cellBundles = (): number =>
  gpu.passes.filter((pass) => pass.label.includes('world')).reduce((total, pass) => total + pass.bundles.length, 0);

describe('Engine frame decisions', () => {
  describe('negative cases', () => {
    it('draws a NIGHT-window timed object at 22:00 but not at 14:00', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', timedCellBytes(20, 6)); // lit windows: on at 20, off at 06

      engine.environment.hour = 14;
      gpu.reset();
      engine.frame(camera());
      const atNoon = worldDraws();

      engine.environment.hour = 22;
      gpu.reset();
      engine.frame(camera());
      const atNight = worldDraws();

      expect(atNight).toBeGreaterThan(atNoon);
    });

    it('honours a window that WRAPS midnight at both ends', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', timedCellBytes(20, 6));

      const drawsAt = (hour: number): number => {
        engine.environment.hour = hour;
        gpu.reset();
        engine.frame(camera());

        return worldDraws();
      };

      const off = drawsAt(12);
      expect(drawsAt(23)).toBeGreaterThan(off); // after `on`, before midnight
      expect(drawsAt(3)).toBeGreaterThan(off); // after midnight, before `off`
      expect(drawsAt(6)).toBe(off); // `off` itself is exclusive
    });

    it('does not draw a cell parked far beyond the far plane', async () => {
      const engine = await bootedEngine();
      engine.cells.load('far', cellBytes({ bounds: [0, 0, 0, 10], origin: [100000, 0, 0] }));

      gpu.reset();
      engine.frame(camera());

      expect(cellBundles()).toBe(0);
    });

    it('unloading a cell releases its GPU resources — the ledger returns to its prior line', async () => {
      const engine = await bootedEngine();
      const before = engine.ledger();

      engine.cells.load('0,0', cellBytes());
      const loaded = engine.ledger();
      expect(loaded.cellVertex.bytes).toBeGreaterThan(before.cellVertex.bytes);

      engine.cells.unload('0,0');
      const after = engine.ledger();
      expect(after.cellVertex).toEqual(before.cellVertex);
      expect(after.cellIndex).toEqual(before.cellIndex);
      expect(after.uniform).toEqual(before.uniform);
    });
  });

  describe('positive cases', () => {
    it('runs its passes in the fixed order the frame graph declares', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', cellBytes());

      gpu.reset();
      engine.frame(camera());

      const labels = gpu.passes.map((pass) => pass.label);
      const world = labels.findIndex((label) => label.includes('world'));
      const post = labels.findIndex((label) => label.includes('post'));

      expect(world).toBeGreaterThanOrEqual(0);
      expect(post).toBeGreaterThan(world); // post composites the world, never before it
    });

    it('splits its BOOT by phase, so a 2.6 s init has a breakdown rather than a total (201/4-03)', async () => {
      const engine = await bootedEngine();

      const named = engine.bootPhases.byName.map(([name]) => name);

      expect(named).toEqual(
        expect.arrayContaining(['init:device', 'init:canvas', 'init:pipelines', 'init:sky-lut', 'init:targets']),
      );
    });

    it('splits its FIRST frames by phase and then stops paying for the split (201/4-03)', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', cellBytes());

      for (let i = 0; i < 5; i += 1) {
        engine.frame(camera());
      }

      // Three frames split, and no more — the fourth and fifth add nothing.
      expect(engine.firstFrames).toHaveLength(3);
      const named = engine.firstFrames[0].byName.map(([name]) => name);
      expect(named).toEqual(
        expect.arrayContaining(['frame:targets', 'frame:sky-lut', 'frame:probe', 'frame:cull', 'frame:record']),
      );
    });

    it('executes a loaded cell bundle in the world pass', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', cellBytes());

      gpu.reset();
      engine.frame(camera());

      const world = gpu.passes.find((pass) => pass.label.includes('world'));
      expect(world?.bundles.length).toBeGreaterThan(0);
    });

    it('counts every loaded cell and drops it again on unload', async () => {
      const engine = await bootedEngine();
      expect(engine.cells.count).toBe(0);

      engine.cells.load('0,0', cellBytes());
      engine.cells.load('1,0', cellBytes({ origin: [250, 0, 0] }));
      expect(engine.cells.count).toBe(2);

      engine.cells.unload('0,0');
      expect(engine.cells.count).toBe(1);
    });

    it('reports total and VISIBLE cells separately in the frame stats', async () => {
      const engine = await bootedEngine();
      engine.cells.load('near', cellBytes());
      engine.cells.load('far', cellBytes({ bounds: [0, 0, 0, 10], origin: [100000, 0, 0] }));

      const stats = engine.frame(camera());
      expect(stats.cellsTotal).toBe(2);
      expect(stats.cellsVisible).toBe(1); // the distant one is culled, not merely skipped at draw time
    });

    it('counts the triangles of VISIBLE cells only', async () => {
      const engine = await bootedEngine();
      // Two groups of one triangle each — the sum, not the group count, is what the bench reports.
      const twoTriangles = cellBytes({
        groups: [
          { bounds: [0, 0, 0, 50], indexCount: 3, indexOffset: 0, pipelineClass: 0, side: 0, textureArrayRef: 0 },
          { bounds: [0, 0, 0, 50], indexCount: 3, indexOffset: 0, pipelineClass: 0, side: 0, textureArrayRef: 0 },
        ],
      });
      engine.cells.load('near', twoTriangles);
      engine.cells.load('far', cellBytes({ bounds: [0, 0, 0, 10], origin: [100000, 0, 0] }));

      expect(engine.frame(camera()).trianglesRecorded).toBe(2);
    });

    it('counts the roadsign glyph quads of VISIBLE cells only', async () => {
      // The reading plan 100/03 could not take by eye: a 2.4 m plate at LOD range is ~8 px, so whether a
      // far cell still carries its text has to be a NUMBER. It must fall to zero when the cell carrying it
      // is culled, or standing back from a sign would read as "still drawn".
      const engine = await bootedEngine();
      engine.cells.load('near', cellBytes({ roadsignQuads: 12 }));
      engine.cells.load('far', cellBytes({ bounds: [0, 0, 0, 10], origin: [100000, 0, 0], roadsignQuads: 900 }));

      expect(engine.frame(camera()).roadsignQuadsRecorded).toBe(12);
    });

    it('keeps drawing a cell as the camera moves within range, and stops beyond it', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', cellBytes());

      gpu.reset();
      engine.frame(camera([0, 0, 30]));
      const near = cellBundles();

      gpu.reset();
      engine.frame(camera([50000, 0, 30]));
      const away = cellBundles();

      expect(near).toBeGreaterThan(0);
      expect(away).toBe(0);
    });

    it('survives a cell being loaded and unloaded between frames', async () => {
      const engine = await bootedEngine();

      engine.cells.load('0,0', cellBytes());
      engine.frame(camera());
      engine.cells.unload('0,0');

      expect(() => engine.frame(camera())).not.toThrow();
      expect(engine.cells.count).toBe(0);
    });
  });
});

/** A cell whose single object is a TIMED UV-scroller (kind 5, minor 7): slot 0, visible in [on, off). */
function timedScrollCellBytes(on: number, off: number): Uint8Array {
  return cellBytes({
    objects: [
      {
        groupCount: 1,
        groupStart: 0,
        kind: 5,
        params: 0 | (on << 16) | (off << 24),
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      },
    ],
  });
}

describe('kind-5 timed UV-scroll (085 row D / minor 7)', () => {
  describe('negative cases', () => {
    it('draws NOTHING outside the window — the minor-6 double-row wrote the scroll around the clock', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', timedScrollCellBytes(22, 5));
      engine.environment.hour = 14;

      gpu.reset();
      engine.frame(camera());

      expect(worldDraws()).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('draws inside the window, with the scroll uniform refreshed from the animation slot', async () => {
      const engine = await bootedEngine();
      engine.setUvAnimations([{ duration: 2, keyframes: [{ time: 0, uv: [0, 1, 1, 0, 0.5, 0] }], name: 'stripes' }]);
      engine.cells.load('0,0', timedScrollCellBytes(22, 5));
      engine.environment.hour = 23;

      gpu.reset();
      engine.frame(camera());

      expect(worldDraws()).toBeGreaterThan(0);
      // The per-object cell uniform got the live uvAnim vec4 at offset 16 (the kind-4 contract, shared).
      const scrollWrites = gpu.writes.filter((write) => write.label?.includes('uvscroll') && write.offset === 16);
      expect(scrollWrites.length).toBeGreaterThan(0);
    });
  });
});

/**
 * The water gate (plan 094/07). The sea is the only surface a map inspector needs to look UNDER, so the
 * toggle is a DRAW gate: the mesh stays uploaded and switching it back on costs nothing.
 */
describe('water', () => {
  /** One quad at sea level, the layout `setWater` takes: [x, y, z, shoreDistance, class] per vertex. */
  const seaQuad = (): Float32Array =>
    new Float32Array([-50, 0, -50, 120, 0, 50, 0, -50, 120, 0, -50, 0, 50, 120, 0, 50, 0, 50, 120, 0]);
  const seaIndices = (): Uint32Array => new Uint32Array([0, 1, 2, 2, 1, 3]);
  const waterDraws = (): number => gpu.draws.filter((draw) => draw.pipeline === 'water').length;

  describe('negative cases', () => {
    it('draws nothing before a surface is installed', async () => {
      const engine = await bootedEngine();

      gpu.reset();
      engine.frame(camera());

      expect(waterDraws()).toBe(0);
    });

    it('stops drawing when the gate is off, without dropping the mesh', async () => {
      const engine = await bootedEngine();
      engine.setWater(seaQuad(), seaIndices(), null, null);
      engine.waterEnabled = false;

      gpu.reset();
      engine.frame(camera());
      expect(waterDraws()).toBe(0);

      // Back on: no re-upload, the same buffers draw again — that is what makes it a live toggle.
      engine.waterEnabled = true;
      gpu.reset();
      engine.frame(camera());
      expect(waterDraws()).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('draws the installed surface once per frame', async () => {
      const engine = await bootedEngine();
      engine.setWater(seaQuad(), seaIndices(), null, null);

      gpu.reset();
      engine.frame(camera());

      expect(waterDraws()).toBe(1);
    });
  });
});
