import {
  encodeOscell,
  encodeOstex,
  type Oscell,
  OSCELL_VERTEX_STRIDE,
  OscellChannel,
  OstexFormat,
  ostexLayerBytes,
} from '@opensa/engine-formats';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FakeGpu, RecordedWrite } from '../test/fake-device';

import { Engine } from '../engine';
import { installFakeWebGpu } from '../test/fake-device';

/**
 * The cell store's own invariants (plan 077 phase 3), asserted through the recording device.
 *
 * The three that a field bug has already cost us: the bundle is recorded ONCE and a break therefore has to go
 * through the index BUFFER's bytes (neighbours intact, offset 4-byte aligned), a smashed prop's coronas must
 * die with it, and unload must return the residency ledger to exactly its prior line.
 */

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

const BREAK_KEY = 0xabcdef;

/** Booted engine with texture array 0 present — cells reference it and `load` throws without it. */
async function bootedEngine(): Promise<Engine> {
  const engine = new Engine();
  await engine.init(harness.canvas);
  engine.textures.load(0, textureArrayBytes());

  return engine;
}

/** A cell with a smashable placement: six u16 indices, of which indices 1..3 belong to the prop. */
function breakableCellBytes(overrides: Partial<Oscell> = {}): Uint8Array {
  return cellBytes({
    breakables: [{ indexCount: 3, indexOffset: 1, keyHash: BREAK_KEY }],
    index16: true,
    indexCount: 6,
    indexData: new Uint8Array(new Uint16Array([1, 2, 3, 4, 5, 6]).buffer),
    ...overrides,
  });
}

/** A minimal but VALID cell: one opaque group over one triangle, at `origin`. */
function cellBytes(overrides: Partial<Oscell> = {}): Uint8Array {
  const vertexCount = 3;

  return encodeOscell({
    bounds: [0, 0, 0, 50],
    breakables: [],
    channelMask: 0,
    groups: [group(0)],
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

function group(pipelineClass: number): Oscell['groups'][number] {
  return { bounds: [0, 0, 0, 50], indexCount: 3, indexOffset: 0, pipelineClass, side: 0, textureArrayRef: 0 };
}

/** A 4x4 single-layer RGBA8 array — the reference every fixture group carries. */
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

/** The recorded writes against a buffer whose label ends with `suffix`. */
function writesTo(suffix: string): RecordedWrite[] {
  return gpu.writes.filter((write) => (write.label ?? '').endsWith(suffix));
}

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('CellStore', () => {
  describe('negative cases', () => {
    it('refuses to break a key no loaded cell owns', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', breakableCellBytes());

      expect(engine.cells.breakPlacement(0x1234)).toBe(false);
    });

    it('refuses to break the same placement twice — a break is not repeatable without a reload', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', breakableCellBytes());

      expect(engine.cells.breakPlacement(BREAK_KEY)).toBe(true);
      expect(engine.cells.breakPlacement(BREAK_KEY)).toBe(false);
    });

    it('keeps nothing to smash with: a cell without breakables retains no index copy', async () => {
      const engine = await bootedEngine();
      const handle = engine.cells.load('0,0', cellBytes());

      expect(handle.indexData.byteLength).toBe(0);
      expect(handle.breakables.size).toBe(0);
    });

    it('records NO blend bundle when every group is opaque', async () => {
      const engine = await bootedEngine();
      const handle = engine.cells.load('0,0', cellBytes());

      expect(handle.blendBundle).toBeNull();
    });

    it('ignores an unload of a key that was never loaded', async () => {
      const engine = await bootedEngine();

      expect(() => engine.cells.unload('nope')).not.toThrow();
      expect(engine.cells.count).toBe(0);
      expect(engine.cells.has('nope')).toBe(false);
    });

    it('returns the SAME handle for a repeated load instead of re-uploading the cell', async () => {
      const engine = await bootedEngine();
      const first = engine.cells.load('0,0', cellBytes());
      const uploads = writesTo(':vb').length;

      const second = engine.cells.load('0,0', cellBytes());

      expect(second).toBe(first);
      expect(writesTo(':vb').length).toBe(uploads);
      expect(engine.cells.count).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('degenerates only the prop triangles, preserving the neighbouring index dragged in by alignment', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', breakableCellBytes());
      gpu.reset();

      expect(engine.cells.breakPlacement(BREAK_KEY)).toBe(true);

      const erase = writesTo(':ib');
      expect(erase).toHaveLength(1);
      // Prop = u16 indices 1..3 → bytes [2, 8); the write widens to the 4-byte window [0, 8) and must carry
      // index 0's own bytes back verbatim rather than zeroing a neighbour's triangle.
      expect(erase[0].offset).toBe(0);
      expect(erase[0].offset % 4).toBe(0);
      expect(erase[0].byteLength % 4).toBe(0);
      expect([...erase[0].data]).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('degenerates a u32 placement at its natural stride — no alignment widening needed', async () => {
      const engine = await bootedEngine();
      engine.cells.load(
        '0,0',
        cellBytes({
          breakables: [{ indexCount: 3, indexOffset: 3, keyHash: BREAK_KEY }],
          indexCount: 6,
          indexData: new Uint8Array(new Uint32Array([1, 2, 3, 4, 5, 6]).buffer),
        }),
      );
      gpu.reset();

      expect(engine.cells.breakPlacement(BREAK_KEY)).toBe(true);

      const erase = writesTo(':ib');
      expect(erase[0].offset).toBe(12); // u32 stride: index 3 already sits on a 4-byte boundary
      expect([...erase[0].data]).toEqual(Array.from({ length: 12 }, () => 0));
    });

    it('takes the smashed prop OWN coronas down with it and leaves the rest of the cell lit', async () => {
      const engine = await bootedEngine();
      const handle = engine.cells.load(
        '0,0',
        breakableCellBytes({
          lights: [
            { color: [1, 1, 1, 1], farClip: 100, owner: BREAK_KEY, position: [1, 2, 3], size: 1 },
            { color: [1, 1, 1, 1], farClip: 100, owner: 0, position: [4, 5, 6], size: 1 },
          ],
          origin: [10, 20, 30],
        }),
      );
      expect(handle.lights).toHaveLength(2);

      engine.cells.breakPlacement(BREAK_KEY);

      expect(handle.lights).toHaveLength(1);
      expect(handle.lights[0].owner).toBe(0);
      // Surviving anchors stay in WORLD space (cell-local position shifted by the origin).
      expect([handle.lights[0].x, handle.lights[0].y, handle.lights[0].z]).toEqual([14, 25, 36]);
    });

    it('leaves unrelated coronas alone when the smashed prop owned none', async () => {
      const engine = await bootedEngine();
      const handle = engine.cells.load(
        '0,0',
        breakableCellBytes({
          lights: [{ color: [1, 1, 1, 1], farClip: 100, owner: 0, position: [1, 2, 3], size: 1 }],
        }),
      );

      engine.cells.breakPlacement(BREAK_KEY);

      expect(handle.lights).toHaveLength(1);
    });

    it('groups every index range of one placement under a single key', async () => {
      const engine = await bootedEngine();
      const handle = engine.cells.load(
        '0,0',
        breakableCellBytes({
          breakables: [
            { indexCount: 2, indexOffset: 0, keyHash: BREAK_KEY },
            { indexCount: 2, indexOffset: 2, keyHash: BREAK_KEY },
            { indexCount: 2, indexOffset: 4, keyHash: 0x99 },
          ],
        }),
      );

      expect(handle.breakables.get(BREAK_KEY)).toHaveLength(2);
      expect(handle.breakables.get(0x99)).toHaveLength(1);

      gpu.reset();
      engine.cells.breakPlacement(BREAK_KEY);
      expect(writesTo(':ib')).toHaveLength(2); // one aligned write per range
    });

    it('packs the cell uniform as origin + channel flag bits + an identity uvAnim', async () => {
      const engine = await bootedEngine();
      gpu.reset();
      engine.cells.load(
        '0,0',
        cellBytes({ channelMask: OscellChannel.SUN_VIS | OscellChannel.EMISSIVE, origin: [100, -200, 7] }),
      );

      const write = writesTo(':cell')[0];
      expect(write.byteLength).toBe(32);
      const floats = new Float32Array(write.data.buffer, write.data.byteOffset, 8);
      expect([...floats]).toEqual([100, -200, 7, 3, 0, 0, 1, 1]); // flags: bit 0 sunVis | bit 1 emissive
    });

    it('leaves the flag word at zero for a pak that carries neither baked channel', async () => {
      const engine = await bootedEngine();
      gpu.reset();
      engine.cells.load('0,0', cellBytes({ channelMask: OscellChannel.NIGHT_PRELIT }));

      const write = writesTo(':cell')[0];
      expect(new Float32Array(write.data.buffer, write.data.byteOffset, 8)[3]).toBe(0);
    });

    it('keeps the cell flag word to the BAKED-CHANNEL bits only', async () => {
      // Bit 2 used to carry the index width for the "Show Faces" wireframe, which read the index buffer as
      // raw words. That pass is gone (the viewers cover it), so the width reaches every remaining consumer
      // through `setIndexBuffer` and must not leak into the flags.
      const engine = await bootedEngine();
      gpu.reset();
      engine.cells.load(
        '0,0',
        cellBytes({
          channelMask: OscellChannel.SUN_VIS,
          index16: true,
          indexData: new Uint8Array(new Uint16Array([0, 1, 2]).buffer),
        }),
      );

      const write = writesTo(':cell')[0];
      expect(new Float32Array(write.data.buffer, write.data.byteOffset, 8)[3]).toBe(1); // sunVis alone
    });

    it('creates the cell buffers WITHOUT storage usage — it costs GPU time for nothing', async () => {
      // The "Show Faces" pass needed STORAGE on every cell's vertex AND index buffer to look a vertex up by
      // hand. It was paid on every cell in the world, always, for a debug view that is off in normal play,
      // and declaring a buffer storage-capable denies the driver fast paths for vertex/index fetch. The
      // field reported a broad day-and-night fps drop and this was the change that landed with it.
      const engine = await bootedEngine();
      engine.cells.load('0,0', cellBytes());

      expect(gpu.bufferUsage.get('0,0:vb')! & GPUBufferUsage.STORAGE).toBe(0);
      expect(gpu.bufferUsage.get('0,0:ib')! & GPUBufferUsage.STORAGE).toBe(0);
      // …while keeping the usages the ordinary draw path needs.
      expect(gpu.bufferUsage.get('0,0:vb')! & GPUBufferUsage.VERTEX).toBeTruthy();
      expect(gpu.bufferUsage.get('0,0:ib')! & GPUBufferUsage.INDEX).toBeTruthy();
    });

    it('records the index WIDTH each cell was decoded with', async () => {
      const engine = await bootedEngine();
      const wide = engine.cells.load('0,0', cellBytes({ index16: false }));
      const narrow = engine.cells.load(
        '1,0',
        cellBytes({ index16: true, indexCount: 3, indexData: new Uint8Array(new Uint16Array([0, 1, 2]).buffer) }),
      );

      expect(wide.index16).toBe(false);
      expect(narrow.index16).toBe(true);
    });

    it('pads an odd u16 index payload up to a 4-byte write', async () => {
      const engine = await bootedEngine();
      gpu.reset();
      engine.cells.load(
        '0,0',
        cellBytes({ index16: true, indexCount: 3, indexData: new Uint8Array(new Uint16Array([0, 1, 2]).buffer) }),
      );

      // 3 u16 indices = 6 bytes; writeBuffer REJECTS a non-multiple-of-4 length, so the upload must be 8.
      expect(writesTo(':ib')[0].byteLength).toBe(8);
    });

    it('splits blended groups into their own bundle and counts both towards the cell draws', async () => {
      const engine = await bootedEngine();
      const handle = engine.cells.load('0,0', cellBytes({ groups: [group(2), group(0), group(1)] }));

      expect(handle.blendBundle).not.toBeNull();
      expect(handle.draws).toBe(3);
      // Inside the opaque bundle the recorded order is opaque BEFORE cutout, whatever the pak's order was.
      const bundle = gpu.draws.filter((draw) => draw.pass === '0,0');
      expect(bundle).toHaveLength(2);
      expect(bundle.map((draw) => draw.indexCount)).toEqual([3, 3]);
      expect(gpu.draws.filter((draw) => draw.pass === '0,0:blend')).toHaveLength(1);
    });

    it('keeps ObjectTable groups OUT of the recorded bundle — the frame gates them per hour', async () => {
      const engine = await bootedEngine();
      const handle = engine.cells.load(
        '0,0',
        cellBytes({
          groups: [group(0), group(0)],
          objects: [
            {
              groupCount: 1,
              groupStart: 0,
              kind: 0,
              params: 0,
              transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
            },
          ],
        }),
      );

      expect(handle.draws).toBe(1); // two groups, one of them owned by the object
      expect(gpu.draws.filter((draw) => draw.pass === '0,0')).toHaveLength(1);
      expect(handle.objects[0].groups).toHaveLength(1);
      expect(handle.objects[0].uvAnimUniform).toBeNull();

      // Unload must not try to release a uniform a non-kind-4 object never owned.
      const before = engine.ledger().uniform;
      engine.cells.unload('0,0');
      expect(engine.ledger().uniform.count).toBeLessThan(before.count);
    });

    it('gives a kind-4 UV-scroll object its OWN cell uniform, released with the cell', async () => {
      const engine = await bootedEngine();
      const before = engine.ledger();
      const handle = engine.cells.load(
        '0,0',
        cellBytes({
          objects: [
            {
              groupCount: 1,
              groupStart: 0,
              kind: 4,
              params: 7,
              transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
            },
          ],
        }),
      );

      // It cannot ride the shared cell bind group: its uvAnim transform is rewritten every frame.
      expect(handle.objects[0].uvAnimUniform).not.toBeNull();
      expect(handle.objects[0].bindGroup).not.toBe(handle.cellBindGroup);
      expect(writesTo(':uvscroll:7')).toHaveLength(1);

      engine.cells.unload('0,0');

      expect(engine.ledger().uniform).toEqual(before.uniform);
    });

    it('returns the residency ledger to its prior line on unload', async () => {
      const engine = await bootedEngine();
      const before = engine.ledger();

      engine.cells.load('0,0', breakableCellBytes());
      expect(engine.cells.has('0,0')).toBe(true);

      engine.cells.unload('0,0');

      expect(engine.cells.has('0,0')).toBe(false);
      expect(engine.ledger().cellVertex).toEqual(before.cellVertex);
      expect(engine.ledger().cellIndex).toEqual(before.cellIndex);
      expect(engine.ledger().uniform).toEqual(before.uniform);
    });

    it('shifts light and particle anchors into world space by the cell origin', async () => {
      const engine = await bootedEngine();
      const handle = engine.cells.load(
        '0,0',
        cellBytes({
          lights: [{ color: [255, 128, 0, 255], farClip: 60, owner: 0, position: [1, 2, 3], size: 2 }],
          origin: [1000, 2000, 30],
          particles: [{ effectName: 'ws_factorysmoke', position: [4, 5, 6] }],
        }),
      );

      expect([handle.lights[0].x, handle.lights[0].y, handle.lights[0].z]).toEqual([1001, 2002, 33]);
      expect(handle.lights[0].color).toEqual([255, 128, 0, 255]); // u8 channels, carried through verbatim
      expect(handle.particles[0]).toEqual({ effectName: 'ws_factorysmoke', x: 1004, y: 2005, z: 36 });
      // Bounds follow the origin too — the ring test reads them in world space.
      expect(handle.bounds).toEqual([1000, 2000, 30, 50]);
    });

    it('enumerates every loaded cell through all()', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', cellBytes());
      engine.cells.load('1,0', cellBytes({ origin: [250, 0, 0] }));

      expect([...engine.cells.all()].map((cell) => cell.key)).toEqual(['0,0', '1,0']);
    });
  });
});

/** A cell whose mapper holds two boxed placements 100 u apart along +x, both at the origin's height. */
function mapperCellBytes(origin: [number, number, number] = [0, 0, 0], indexData?: Uint8Array): Uint8Array {
  return cellBytes({
    ...(indexData ? { indexCount: indexData.byteLength / 4, indexData } : {}),
    names: ['near_shop', 'shoptxd', 'far_shop'],
    origin,
    placements: [
      { bounds: [-5, -5, -5, 5, 5, 5], id: 111, indexCount: 3, indexOffset: 0, nameRef: 0, txdRef: 1 },
      { bounds: [95, -5, -5, 105, 5, 5], id: 222, indexCount: 3, indexOffset: 0, nameRef: 2, txdRef: 1 },
    ],
  });
}

describe('CellStore placement mapper (074/22 picking)', () => {
  describe('negative cases', () => {
    it('picks nothing while debug picking is off — the mapper is not even parsed', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', mapperCellBytes());

      expect(engine.cells.pick([-100, 0, 0], [1, 0, 0])).toBeNull();
    });

    it('misses when the ray passes beside every box', async () => {
      const engine = await bootedEngine();
      engine.cells.picking = true;
      engine.cells.load('0,0', mapperCellBytes());

      expect(engine.cells.pick([-100, 50, 0], [1, 0, 0])).toBeNull();
    });

    it('misses when every box is BEHIND the ray origin', async () => {
      const engine = await bootedEngine();
      engine.cells.picking = true;
      engine.cells.load('0,0', mapperCellBytes());

      expect(engine.cells.pick([200, 0, 0], [1, 0, 0])).toBeNull();
    });

    it('hides nothing for an id no loaded cell carries', async () => {
      const engine = await bootedEngine();
      engine.cells.picking = true;
      engine.cells.load('0,0', mapperCellBytes());

      expect(engine.cells.hidePlacement(999)).toBe(0);
    });

    it('costs NOTHING while the capability is off — neither the mapper nor the retained index bytes', async () => {
      const engine = await bootedEngine();
      engine.cells.load('0,0', mapperCellBytes());

      // A cell with nothing smashable drops its index bytes after upload, so the whole price is the flag's.
      expect(engine.cells.pickingBytes).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('returns the FRONTMOST placement, named, when the ray crosses both', async () => {
      const engine = await bootedEngine();
      engine.cells.picking = true;
      engine.cells.load('0,0', mapperCellBytes());

      const hit = engine.cells.pick([-100, 0, 0], [1, 0, 0]);

      expect(hit?.model).toBe('near_shop'); // the far box is also crossed — order is what is under test
      expect(hit?.txd).toBe('shoptxd');
      expect(hit?.id).toBe(111);
      expect(hit?.distance).toBeCloseTo(95, 5);
      expect(hit?.position).toEqual([0, 0, 0]);
    });

    it('resolves the mapper against the cell ORIGIN, not cell-local space', async () => {
      const engine = await bootedEngine();
      engine.cells.picking = true;
      engine.cells.load('0,0', mapperCellBytes([1000, 0, -500]));

      // The same box now lives at world (1000, 0, -500): a ray down cell-local x must MISS it...
      expect(engine.cells.pick([-100, 0, 0], [1, 0, 0])).toBeNull();
      // ...and one aimed at the shifted position must find it.
      expect(engine.cells.pick([900, 0, -500], [1, 0, 0])?.model).toBe('near_shop');
    });

    it('hits a box the ray STARTS inside, at distance zero', async () => {
      const engine = await bootedEngine();
      engine.cells.picking = true;
      engine.cells.load('0,0', mapperCellBytes());

      const hit = engine.cells.pick([0, 0, 0], [1, 0, 0]);

      expect(hit?.id).toBe(111);
      expect(hit?.distance).toBe(0);
    });

    it('hides a placement and stops picking it, leaving its neighbour alone', async () => {
      const engine = await bootedEngine();
      engine.cells.picking = true;
      engine.cells.load('0,0', mapperCellBytes());

      expect(engine.cells.hidePlacement(111)).toBe(1);

      expect(engine.cells.pick([-100, 0, 0], [1, 0, 0])?.id).toBe(222);
    });

    it('STATES what it costs, and gives every byte back when the cell unloads', async () => {
      const engine = await bootedEngine();
      engine.cells.picking = true;
      engine.cells.load('0,0', mapperCellBytes());

      // Two mapper rows plus the index bytes this cell would otherwise have dropped. 201/5-01 asks for the
      // number measured rather than estimated, and a capability whose price reads 0 is the failure it names.
      const cost = engine.cells.pickingBytes;
      const retainedIndexBytes = [...engine.cells.all()][0].indexData.byteLength;

      // BOTH halves, or the number is not the capability's price: the index bytes this cell would have
      // dropped after upload, AND the mapper rows on top of them. Counting one and calling it the cost is
      // the same lie as reporting zero, only harder to notice.
      expect(retainedIndexBytes).toBeGreaterThan(0);
      expect(cost).toBeGreaterThan(retainedIndexBytes);

      engine.cells.load('1,0', mapperCellBytes([250, 0, 0]));

      expect(engine.cells.pickingBytes).toBe(2 * cost);

      engine.cells.unload('1,0');

      expect(engine.cells.pickingBytes).toBe(cost);
    });

    it('counts the RETAINED INDEX BYTES too, not only the mapper rows', async () => {
      const engine = await bootedEngine();
      engine.cells.picking = true;
      // The same two placements, one cell carrying 40 more index bytes than the other. Everything else is
      // identical, so the difference in the reported cost can only be the geometry the capability retained.
      engine.cells.load('0,0', mapperCellBytes());
      const lean = engine.cells.pickingBytes;
      engine.cells.unload('0,0');
      // 13 indices where the lean cell has 3 — the group still draws the first three of them.
      engine.cells.load('0,0', mapperCellBytes([0, 0, 0], new Uint8Array(new Uint32Array(13).buffer)));

      expect(engine.cells.pickingBytes - lean).toBe(40);
    });
  });
});
