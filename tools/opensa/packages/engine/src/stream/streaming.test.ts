import type { OspakManifest } from '@opensa/engine-formats';

import { describe, expect, it } from 'vitest';

import type { CameraState, Engine } from '../engine';
import type { ResidencyView } from './residency';

import { StreamingDriver, type StreamingRadii } from './streaming';

/** What a pak states for the screen-error rule — one height for every cell keeps the fixtures readable. */
interface ResidencyProfile {
  aabbY?: [number, number];
  geometricError?: Record<string, number>;
  lodPixelThreshold?: number;
}

function harness(
  cells: string[],
  radii: StreamingRadii = {},
  fogCutDistance = 2400,
  /** Per-cell texture-array refs (003 phase 4). Omit to model a pre-`textures` pak (eager, legacy). */
  cellTextures?: Record<string, number[]>,
  /** Per-cell TRUE geometry XZ AABBs (plan 087). Omit to model a pre-`aabb` pak (grid-rect fallback). */
  cellAabbs?: Record<string, [number, number, number, number]>,
  /** Drain calls an array needs before its last write lands — >1 models an upload the budget splits
   *  across frames (the 15-85 ms hitch fix). 1 keeps the pre-split single-frame behaviour. */
  uploadSteps = 1,
  /** What the pak states about screen error (201/1-05). Omit to model every pak built so far. */
  residency?: ResidencyProfile,
): {
  deliver: (key: string) => void;
  driver: StreamingDriver;
  liveArrays: () => number[];
  loaded: string[];
  loadedArrays: string[];
  requested: string[];
  unloaded: string[];
  unloadedArrays: number[];
} {
  const loaded: string[] = [];
  const unloaded: string[] = [];
  const requested: string[] = [];
  const loadedArrays: string[] = [];
  const unloadedArrays: number[] = [];
  const live = new Set<number>();
  /** Array ref → drain calls left before it goes live (the fake's resumable-upload cursor). */
  const draining = new Map<number, number>();
  const engine = {
    cells: {
      load: (key: string): void => {
        loaded.push(key);
      },
      unload: (key: string): void => {
        unloaded.push(key);
      },
    },
    environment: { fogCutDistance },
    // The real one keeps an array a live rigid model still binds; this fake has no models, so it always
    // unloads — mirroring `textures.unload` below.
    releaseWorldArray: (ref: number): boolean => {
      draining.delete(ref);
      live.delete(ref);
      unloadedArrays.push(ref);

      return true;
    },
    textures: {
      beginLoad: (ref: number): void => {
        if (live.has(ref) || draining.has(ref)) {
          return;
        }
        draining.set(ref, uploadSteps);
        loadedArrays.push(`array-${ref}`);
        // The handler's remaining share (decode + `createTexture`) still runs between frames. The fake
        // burns a millisecond so that cost stays a NUMBER the accounting test can hold.
        const until = performance.now() + 1;
        while (performance.now() < until) {
          /* spin: the cost is the point */
        }
      },
      drainUploads: (): number => {
        if (draining.size === 0) {
          return 0;
        }
        for (const [ref, left] of draining) {
          if (left <= 1) {
            draining.delete(ref);
            live.add(ref);
          } else {
            draining.set(ref, left - 1);
          }
        }
        // The drain writes texture data — burn a millisecond so `uploadMs` is a number too.
        const started = performance.now();
        while (performance.now() < started + 1) {
          /* spin */
        }

        return performance.now() - started;
      },
      has: (ref: number): boolean => live.has(ref),
      unload: (ref: number): void => {
        draining.delete(ref);
        live.delete(ref);
        unloadedArrays.push(ref);
      },
    },
  } as unknown as Engine;
  let onMessage: ((event: { data: unknown }) => void) | null = null;
  const worker = {
    addEventListener: (_type: string, listener: (event: { data: unknown }) => void): void => {
      onMessage = listener;
    },
    postMessage: (message: { key: string }): void => {
      requested.push(message.key);
    },
  } as unknown as Worker;
  const driver = new StreamingDriver(engine, manifestWith(cells, cellTextures, cellAabbs, residency), worker, radii);

  return {
    deliver: (key: string): void => {
      onMessage?.({ data: { buffer: new ArrayBuffer(4), key, type: 'blob' } });
    },
    driver,
    liveArrays: (): number[] => [...live].sort((a, b) => a - b),
    loaded,
    loadedArrays,
    requested,
    unloaded,
    unloadedArrays,
  };
}

/** Minimal manifest: one 250 u cell at grid (3,3) with both levels (engine rect x[750,1000] z[−1000,−750]). */
function manifestWith(
  cells: string[],
  cellTextures?: Record<string, number[]>,
  cellAabbs?: Record<string, [number, number, number, number]>,
  residency?: ResidencyProfile,
): OspakManifest {
  const entries: OspakManifest['cells'] = {};
  const arrays: OspakManifest['textures'] = {};
  for (const key of cells) {
    const refs = cellTextures?.[key];
    const aabb = cellAabbs?.[key];
    const error = residency?.geometricError?.[key];
    entries[key] = {
      hash: 0,
      length: 4,
      offset: 0,
      ...(aabb ? { aabb } : {}),
      ...(residency?.aabbY ? { aabbY: residency.aabbY } : {}),
      ...(error !== undefined ? { geometricError: error } : {}),
      ...(refs ? { textures: refs } : {}),
    };
    for (const ref of refs ?? []) {
      arrays[`array-${ref}`] = { format: 0, hash: 0, height: 4, layers: 1, length: 4, offset: 0, width: 4 };
    }
  }

  return {
    byteLength: 4096,
    cells: entries,
    cellSize: 250,
    ...(residency?.lodPixelThreshold !== undefined ? { lodPixelThreshold: residency.lodPixelThreshold } : {}),
    textures: arrays,
    version: 1,
  };
}

/** A view over the origin looking down −Z from 400 u up: the console's own shape, minus its chrome. */
function mapView(overrides: Partial<CameraState> = {}): ResidencyView {
  return {
    camera: {
      aspect: 1.6,
      eye: [0, 400, 400],
      far: 5000,
      fovYRad: Math.PI / 3,
      near: 0.1,
      target: [0, 0, 0],
      up: [0, 1, 0],
      ...overrides,
    },
    pixelHeight: 800,
  };
}

describe('StreamingDriver rings (074/21 P1)', () => {
  describe('negative cases', () => {
    it('does not request a cell whose rect sits outside the LOD ring', () => {
      // Rect closest point (750, −750) → 1060.7 from origin; ring 1000 leaves it out.
      const h = harness(['3,3,lod'], { lodRadius: 1000 });
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual([]);
    });

    it('creates at most two cells per update even when more are delivered (the adaptive budget cap)', () => {
      const h = harness(['3,3,lod', '4,3,lod', '5,3,lod'], { lodRadius: 2000 });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.deliver('4,3,lod');
      h.deliver('5,3,lod');
      h.driver.update([0, 0, 0]);

      // Test creates are ~0 ms, so the time budget admits the second — never a third.
      expect(h.loaded).toHaveLength(2);

      h.driver.update([0, 0, 0]);

      expect(h.loaded).toHaveLength(3);
    });

    it('does not prefetch ahead of a STATIC focus (velocity decays to zero)', () => {
      // Rect closest point from (100, −100) → 919.2; ring 800 leaves it out while nothing moves.
      const h = harness(['3,3,lod'], { lodRadius: 800 });
      for (let step = 0; step < 30; step += 1) {
        h.driver.update([100, 0, -100]);
      }

      expect(h.requested).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('requests a cell whose CENTRE is outside the ring but whose rect is inside (the half-diagonal guarantee)', () => {
      // Centre (875, −875) → 1237.4 > 1200; rect closest point → 1060.7 < 1200. The old centre test
      // would leave this cell unloaded with its corner geometry ~140 u inside the ring.
      const h = harness(['3,3,lod'], { lodRadius: 1200 });
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual(['3,3,lod']);
    });

    it('honors a custom lodRadius (the drawDistance knob)', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1400 });
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual(['3,3,lod']);
    });

    it('creates a delivered cell and evicts it once the rect leaves ring + margin', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);

      expect(h.loaded).toEqual(['3,3,lod']);

      // Teleport far away: rect distance ≫ 1200 + 150 → unload.
      h.driver.update([10000, 0, 0]);

      expect(h.unloaded).toEqual(['3,3,lod']);
    });

    it('promotes to HD by centre distance when the focus stands in the cell', () => {
      const h = harness(['3,3,hd', '3,3,lod']);
      h.driver.update([875, 0, -875]);

      expect(h.requested).toEqual(['3,3,hd']);
    });

    it('prefetches a cell ahead of a MOVING focus before the true ring reaches it (074/21 P3)', () => {
      // Same spot as the static test — but arrived at speed: the smoothed velocity biases the request
      // focus ahead, and the cell is fetched while the TRUE rect distance (919) is still outside 800.
      const h = harness(['3,3,lod'], { lodRadius: 800 });
      for (let step = 0; step <= 10; step += 1) {
        h.driver.update([step * 10, 0, -step * 10]);
      }

      expect(h.requested).toEqual(['3,3,lod']);
    });

    it('counts a create inside the fog cut as LATE — but graces boot and teleports (074/21 P3)', () => {
      // fogCut 2000 > the cell's 1060 rect distance: this create is inside the visible zone.
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2000);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);

      // Boot grace: the initial fill is not a pop.
      expect(h.driver.update([0, 0, 0]).lateCreates).toBe(0);

      // Teleport far away (evicts), then teleport BACK: the recreate is graced too.
      h.driver.update([10000, 0, 0]);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);

      expect(h.driver.update([0, 0, 0]).lateCreates).toBe(0);
    });

    it('counts a late create once steady streaming resumes after the grace closes', () => {
      // Two cells; the far one (5,3 — rect 1600) stays outside the 1200 ring until the focus WALKS
      // toward it in sub-teleport steps; with fogCut 2000 its create then lands inside the visible zone.
      const h = harness(['3,3,lod', '5,3,lod'], { lodRadius: 1200 }, 2000);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);
      h.driver.update([0, 0, 0]); // grace closes here (nothing pending)
      for (let step = 1; step <= 2; step += 1) {
        h.driver.update([step * 200, 0, 0]); // 200 u steps — motion, not teleports
      }
      h.deliver('5,3,lod');
      const stats = h.driver.update([400, 0, 0]);

      expect(stats.lateCreates).toBe(1);
    });
  });
});

/**
 * Geometry-AABB rings (plan 087): the manifest `aabb` is where the cell's TRUE geometry is — an instance
 * welds into the cell of its PIVOT, so meshes reach past the grid rect (gostown mean 141 u, max 799 u).
 * The ring must test the geometry, not the grid; pre-`aabb` paks keep the grid-rect behaviour (the whole
 * suite above runs without aabbs).
 */
/**
 * The baked 3D city map (201/6-01): a pak whose world is the cell LOD tier and nothing else.
 *
 * The runtime needs no mode for it and gets none — a level is chosen from what the CELL HAS, so a pak that
 * carries no `hd` key resolves to its `lod` one at every distance inside the ring. That was already true
 * when the mode was decided, which is exactly why it is pinned here: the build half of 6/01 rests on it, and
 * an unpinned "it already works" is one refactor away from a district that renders nothing up close.
 */
describe('StreamingDriver with a LOD-only world (201/6-01)', () => {
  describe('negative cases', () => {
    it('never asks for an HD key the pak does not carry, however close the focus is', () => {
      const h = harness(['3,3,lod'], { lodRadius: 2000 });
      h.driver.update([875, 0, -875]); // the cell's own centre

      expect(h.requested.some((key) => key.endsWith(',hd'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('streams the LOD tier at point-blank range when it is the only tier there is', () => {
      const h = harness(['3,3,lod'], { lodRadius: 2000 });
      h.driver.update([875, 0, -875]);

      expect(h.requested).toEqual(['3,3,lod']);
    });

    it("still prefers HD where the pak carries both — the difference is the PAK's, not the radius's", () => {
      const h = harness(['3,3,hd', '3,3,lod'], { lodRadius: 2000 });
      h.driver.update([875, 0, -875]);

      expect(h.requested).toEqual(['3,3,hd']);
    });
  });
});

describe('StreamingDriver geometry-AABB rings (plan 087)', () => {
  describe('negative cases', () => {
    it('does not request a cell whose geometry sits outside the ring even though its grid rect is inside', () => {
      // Grid rect closest point 1060.7 < 1200 (the old test would request); the actual geometry is a far
      // corner sliver at 1400 — fetching it would waste the create budget on invisible content.
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2400, undefined, {
        '3,3,lod': [990, 1000, -1000, -990],
      });
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('requests a cell whose grid rect is outside the ring but whose geometry reaches inside (the bridge case)', () => {
      // Grid rect closest point 1060.7 > 1000 — the grid-rect ring skipped this; the welded mesh (a
      // pivot-welded bridge) reaches to (600, −600) → 848.5, well inside the ring.
      const h = harness(['3,3,lod'], { lodRadius: 1000 }, 2400, undefined, {
        '3,3,lod': [600, 1000, -1000, -600],
      });
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual(['3,3,lod']);
    });

    it('the HD↔LOD swap trades the WHOLE slot — footprint equality is the BAKE side of the contract (087)', () => {
      // hd and lod carry DIFFERENT aabbs here (the pre-087 split-bake shape): promoting to HD still
      // unloads the slot's lod even though its geometry reached elsewhere. Per-slot atomicity is the
      // driver's contract; the bake guarantees both levels share a footprint by running on the SAME grid
      // (pmb config.test pins lodCellSize === CELL_SIZE — the gostown missing-bridge regression).
      const h = harness(['3,3,hd', '3,3,lod'], { lodRadius: 2000 }, 2400, undefined, {
        '3,3,hd': [750, 1000, -1000, -750],
        '3,3,lod': [750, 1500, -1500, -750],
      });
      h.driver.update([2000, 0, -875]); // far: lod desired (its aabb reaches to 500 u from the focus)
      h.deliver('3,3,lod');
      h.driver.update([2000, 0, -875]);
      expect(h.loaded).toEqual(['3,3,lod']);

      h.driver.update([875, 0, -875]); // stand at the slot centre: HD desired
      h.deliver('3,3,hd');
      h.driver.update([875, 0, -875]);

      expect(h.loaded).toEqual(['3,3,lod', '3,3,hd']);
      expect(h.unloaded).toEqual(['3,3,lod']); // the whole slot swapped — no half-footprint residue
    });

    it('evicts by the geometry rect: keeps the cell in the margin band, drops it past ring + margin', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1000 }, 2400, undefined, {
        '3,3,lod': [600, 1000, -1000, -600],
      });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);
      expect(h.loaded).toEqual(['3,3,lod']);

      // Geometry at 1131: outside the desire edge (1060 with hysteresis) but inside ring + margin (1150).
      h.driver.update([-200, 0, 200]);
      expect(h.unloaded).toEqual([]);

      // Geometry at 1273 > 1150 — now it goes.
      h.driver.update([-300, 0, 300]);
      expect(h.unloaded).toEqual(['3,3,lod']);
    });
  });
});

/**
 * Per-ring texture residency (003 phase 4). The invariant that matters: a cell is never recorded against an
 * array that is not uploaded — `CellStore` binds `textures.get(ref)` while building the bundle and throws
 * on a miss — and an array outlives exactly as long as some loaded cell still draws with it.
 */
describe('StreamingDriver texture residency', () => {
  describe('negative cases', () => {
    it('does not create a cell whose arrays have not arrived yet', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2400, { '3,3,lod': [7] });
      h.driver.update([0, 0, 0]); // requests the cell AND array-7
      h.deliver('3,3,lod'); // the cell blob lands first

      h.driver.update([0, 0, 0]);

      expect(h.loaded).toEqual([]); // still waiting on array-7
      expect(h.requested).toContain('array-7');
    });

    it('loads nothing up-front — an array arrives only with the cell that needs it', () => {
      const h = harness(['3,3,lod', '9,9,lod'], { lodRadius: 1200 }, 2400, {
        '3,3,lod': [1],
        '9,9,lod': [2], // far away: its array must never be fetched
      });

      h.driver.update([0, 0, 0]);

      expect(h.requested).toContain('array-1');
      expect(h.requested).not.toContain('array-2');
    });

    it('keeps an array a second loaded cell still draws with', () => {
      const h = harness(['3,3,lod', '4,3,lod'], { lodRadius: 1600 }, 2400, {
        '3,3,lod': [5],
        '4,3,lod': [5], // shared
      });
      for (const key of ['3,3,lod', '4,3,lod']) {
        h.driver.update([0, 0, 0]);
        h.deliver(key);
        h.deliver('array-5');
        h.driver.update([0, 0, 0]);
      }
      expect(h.loaded).toEqual(['3,3,lod', '4,3,lod']);

      h.driver.update([10000, 0, 0]); // evicts BOTH — but only after both are gone may the array die

      expect(h.unloadedArrays).toEqual([5]);
      expect(h.liveArrays()).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('creates the cell once its arrays are uploaded', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2400, { '3,3,lod': [7] });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.deliver('array-7');

      h.driver.update([0, 0, 0]);

      expect(h.loaded).toEqual(['3,3,lod']);
      expect(h.liveArrays()).toEqual([7]);
    });

    it('releases the array when the last cell drawing with it is evicted', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2400, { '3,3,lod': [7] });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.deliver('array-7');
      h.driver.update([0, 0, 0]);

      h.driver.update([10000, 0, 0]); // far outside the ring + evict margin

      expect(h.unloaded).toEqual(['3,3,lod']);
      expect(h.unloadedArrays).toEqual([7]);
      expect(h.liveArrays()).toEqual([]);
    });

    it('keeps a shared array alive across an HD↔LOD swap instead of destroying and refetching it', () => {
      // The claim-before-release rule: both levels of one cell draw with array-3, so the swap must not
      // let its user count touch zero.
      const h = harness(['3,3,hd', '3,3,lod'], { hdRadius: 1200, lodRadius: 1600 }, 2400, {
        '3,3,hd': [3],
        '3,3,lod': [3],
      });
      // Stand IN the cell (centre 875, −875) so HD is the desired level.
      h.driver.update([875, 0, -875]);
      h.deliver('3,3,hd');
      h.deliver('array-3');
      h.driver.update([875, 0, -875]);
      expect(h.loaded).toEqual(['3,3,hd']);

      // Move out past the HD edge + hysteresis (centre 1400 > 1260) while the rect (1275) holds the LOD ring.
      const away: [number, number, number] = [2275, 0, -875];
      h.driver.update(away);
      h.deliver('3,3,lod');
      h.driver.update(away);

      expect(h.loaded).toEqual(['3,3,hd', '3,3,lod']);
      expect(h.unloadedArrays).toEqual([]); // never released mid-swap
      expect(h.loadedArrays).toEqual(['array-3']); // and therefore never re-fetched
    });

    it('still works on a pre-`textures` pak — nothing to wait for, nothing to release', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 });
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');

      h.driver.update([0, 0, 0]);

      expect(h.loaded).toEqual(['3,3,lod']);
      expect(h.requested.filter((key) => key.startsWith('array-'))).toEqual([]);
    });
  });
});

describe('StreamingDriver manual cells (the map inspector, 074/22)', () => {
  describe('negative cases', () => {
    it('does not load a cell outside the pinned set even when it sits under the focus', () => {
      const h = harness(['3,3,lod', '4,3,lod'], { lodRadius: 2000 });
      h.driver.setManualCells([[4, 3]], true);
      h.driver.update([875, 0, -875]); // standing inside cell 3,3

      expect(h.requested).toEqual(['4,3,lod']);
    });

    it('does not offer a level the pinned cell lacks', () => {
      const h = harness(['3,3,lod'], { lodRadius: 2000 });
      h.driver.setManualCells([[3, 3]]); // asks for HD; the pak has LOD only
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('loads exactly the pinned cell, ignoring the rings entirely', () => {
      // Rect closest point is 1060.7 away — outside this ring, so only the pin can bring it in.
      const h = harness(['3,3,lod'], { lodRadius: 1000 });
      h.driver.setManualCells([[3, 3]], true);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);

      expect(h.loaded).toEqual(['3,3,lod']);
    });

    it('keeps a pinned cell loaded on every later update — the pin is not a one-frame request', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1000 });
      h.driver.setManualCells([[3, 3]], true);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.driver.update([0, 0, 0]);
      h.driver.update([0, 0, 0]);
      h.driver.update([0, 0, 0]);

      expect(h.unloaded).toEqual([]);
    });

    it('evicts a deselected cell even while it sits well inside the ring', () => {
      const h = harness(['3,3,lod'], { lodRadius: 2000 });
      h.driver.setManualCells([[3, 3]], true);
      h.driver.update([875, 0, -875]);
      h.deliver('3,3,lod');
      h.driver.update([875, 0, -875]);

      h.driver.setManualCells([], true);
      h.driver.update([875, 0, -875]);

      expect(h.unloaded).toEqual(['3,3,lod']);
    });

    it('returns to focus-driven streaming when the pin is cleared', () => {
      const h = harness(['3,3,lod'], { lodRadius: 2000 });
      h.driver.setManualCells([], true);
      h.driver.update([875, 0, -875]);
      expect(h.requested).toEqual([]);

      h.driver.setManualCells(null);
      h.driver.update([875, 0, -875]);

      expect(h.requested).toEqual(['3,3,lod']);
    });

    it('lists every cell the pak offers, once per grid coord', () => {
      const h = harness(['3,3,hd', '3,3,lod', '4,3,lod']);

      expect(h.driver.listCells().sort()).toEqual([
        [3, 3],
        [4, 3],
      ]);
    });
  });
});

describe('StreamingDriver blob accounting (the between-frames cost, 2026-07-27)', () => {
  describe('positive cases', () => {
    it('attributes the worker handler to the frame that follows it, and clears it after', () => {
      // The upload runs in a `message` handler — outside every timer the host frame keeps — so the driver
      // has to carry the number itself, or a 20-250 ms frame has nothing to blame (see
      // `docs/performance/applied/texture-upload-budget.md`).
      const h = harness(['3,3,hd'], { hdRadius: 2000 }, 2400, { '3,3,hd': [7] });
      h.driver.update([875, 0, -875]); // requests the cell, which requests its array

      h.deliver('array-7'); // the upload lands between frames
      const withUpload = h.driver.update([875, 0, -875]);
      const next = h.driver.update([875, 0, -875]);

      expect(withUpload.blobMs).toBeGreaterThan(0);
      expect(withUpload.worstBlobMs).toBeGreaterThan(0);
      expect(withUpload.worstBlobMs).toBeLessThanOrEqual(withUpload.blobMs);
      expect(next.blobMs).toBe(0); // per-FRAME, like the host's own block timers
      expect(next.worstBlobMs).toBe(0);
    });

    it('reports the in-frame drain as uploadMs, zero once nothing is draining', () => {
      const h = harness(['3,3,hd'], { hdRadius: 2000 }, 2400, { '3,3,hd': [7] });
      h.driver.update([875, 0, -875]);

      h.deliver('array-7');
      const withUpload = h.driver.update([875, 0, -875]);
      const next = h.driver.update([875, 0, -875]);

      expect(withUpload.uploadMs).toBeGreaterThan(0);
      expect(next.uploadMs).toBe(0);
    });
  });
});

/**
 * Budgeted texture-array uploads (the 15-85 ms between-frames hitch, 2026-07-27): the worker handler only
 * BEGINS an upload; the (layer, mip) writes drain from `update` under UPLOAD_BUDGET_MS. The driver-side
 * contract pinned here: a cell keeps waiting exactly as it does for an array that has not arrived, and
 * creates the update whose drain lands the last write.
 */
describe('StreamingDriver budgeted texture uploads', () => {
  describe('negative cases', () => {
    it('does not create a cell while its array is still draining', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2400, { '3,3,lod': [7] }, undefined, 3);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.deliver('array-7');

      h.driver.update([0, 0, 0]); // write 1 of 3
      h.driver.update([0, 0, 0]); // write 2 of 3

      expect(h.loaded).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('creates the cell on the update whose drain lands the last write', () => {
      const h = harness(['3,3,lod'], { lodRadius: 1200 }, 2400, { '3,3,lod': [7] }, undefined, 2);
      h.driver.update([0, 0, 0]);
      h.deliver('3,3,lod');
      h.deliver('array-7');

      h.driver.update([0, 0, 0]); // write 1 of 2 — still waiting
      expect(h.loaded).toEqual([]);

      h.driver.update([0, 0, 0]); // last write lands at the TOP of this update — the cell creates in it

      expect(h.loaded).toEqual(['3,3,lod']);
      expect(h.liveArrays()).toEqual([7]);
    });
  });
});

describe('StreamingDriver residency (201/1-05)', () => {
  describe('negative cases', () => {
    it('ignores the view on a pak that states no cell heights — the rings stand', () => {
      // Same two cells, 750 u either side of the focus; without `aabbY` neither can be frustum-tested.
      const h = harness(['0,3,lod', '0,-4,lod'], { hdRadius: 100, lodRadius: 2000 });
      h.driver.update([0, 0, 0], mapView());

      expect(h.requested.sort()).toEqual(['0,-4,lod', '0,3,lod']);
    });

    it('does not request a cell behind the camera once the pak states heights', () => {
      const h = harness(['0,3,lod', '0,-4,lod'], { hdRadius: 100, lodRadius: 2000 }, 2400, undefined, undefined, 1, {
        aabbY: [0, 40],
      });
      h.driver.update([0, 0, 0], mapView());

      expect(h.requested).toEqual(['0,3,lod']);
    });

    it('does not evict a loaded cell for leaving the view — eviction stays radial', () => {
      const h = harness(['0,3,lod'], { hdRadius: 100, lodRadius: 2000 }, 2400, undefined, undefined, 1, {
        aabbY: [0, 40],
      });
      h.driver.update([0, 0, 0], mapView());
      h.deliver('0,3,lod');
      h.driver.update([0, 0, 0], mapView());

      expect(h.loaded).toEqual(['0,3,lod']);

      // Turn 180°: the cell is now behind the camera, and still inside the ring.
      h.driver.update([0, 0, 0], mapView({ target: [0, 0, 800] }));

      expect(h.unloaded).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('requests the nearest cell to the focus first, whatever order the manifest lists them in', () => {
      const h = harness(['0,5,lod', '0,3,lod', '0,1,lod'], { lodRadius: 2000 });
      h.driver.update([0, 0, 0]);

      expect(h.requested).toEqual(['0,1,lod', '0,3,lod', '0,5,lod']);
    });

    it('keeps everything inside the HD ring resident whichever way the view faces', () => {
      // The cell sits behind the camera, but 250 u from the focus — a turn is instant, a fetch is not.
      const h = harness(['0,-2,lod'], { hdRadius: 600, lodRadius: 2000 }, 2400, undefined, undefined, 1, {
        aabbY: [0, 40],
      });
      h.driver.update([0, 0, 0], mapView());

      expect(h.requested).toEqual(['0,-2,lod']);
    });

    it('takes HD when the cell LOD errs by more pixels than the bake promised', () => {
      // Closest point 1205 u from the eye → 1.74 u/px, so a 10 u error draws 5.7 px of it.
      const h = harness(['0,3,hd', '0,3,lod'], { hdRadius: 100, lodRadius: 2000 }, 2400, undefined, undefined, 1, {
        aabbY: [0, 40],
        geometricError: { '0,3,lod': 10 },
        lodPixelThreshold: 4,
      });
      h.driver.update([0, 0, 0], mapView());

      expect(h.requested).toEqual(['0,3,hd']);
    });

    it('keeps the LOD inside the HD radius when its error is under the budget', () => {
      const h = harness(['0,3,hd', '0,3,lod'], { hdRadius: 2000, lodRadius: 2000 }, 2400, undefined, undefined, 1, {
        aabbY: [0, 40],
        geometricError: { '0,3,lod': 10 },
        lodPixelThreshold: 8,
      });
      h.driver.update([0, 0, 0], mapView());

      expect(h.requested).toEqual(['0,3,lod']);
    });

    it('needs HD closer in on a taller drawing buffer — the same world on a phone at DPR 3', () => {
      const profile = { aabbY: [0, 40] as [number, number], geometricError: { '0,3,lod': 10 }, lodPixelThreshold: 8 };
      const short = harness(
        ['0,3,hd', '0,3,lod'],
        { hdRadius: 100, lodRadius: 2000 },
        2400,
        undefined,
        undefined,
        1,
        profile,
      );
      short.driver.update([0, 0, 0], mapView());

      expect(short.requested).toEqual(['0,3,lod']);

      const tall = harness(
        ['0,3,hd', '0,3,lod'],
        { hdRadius: 100, lodRadius: 2000 },
        2400,
        undefined,
        undefined,
        1,
        profile,
      );
      tall.driver.update([0, 0, 0], { ...mapView(), pixelHeight: 2400 });

      expect(tall.requested).toEqual(['0,3,hd']);
    });
  });
});
