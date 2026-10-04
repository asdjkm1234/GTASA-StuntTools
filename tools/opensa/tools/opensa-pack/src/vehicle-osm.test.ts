/**
 * The `.osm` ROUND TRIP on a real car (opensa-pack 003 phase 3): opensa-pack writes it, the runtime's
 * `readVehicleOsm` reads it back. Writer and reader are in different packages and can only drift silently,
 * so the contract is pinned here, on a stock `admiral.dff`/`admiral.txd` rather than a hand-built blob —
 * the strides, the section split and the collision shape all come from the real asset.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { decodeOsmTextures } from '@opensa/engine-formats';
import { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import { readVehicleOsm } from '@opensa/game/adapters/vehicle-osm';
import { parseDff, parseVehicleDefs } from '@opensa/renderware';
import { parseDffCollision } from '@opensa/renderware/parsers/binary/col';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildVehicleOsm } from './vehicle-osm';

const FIXTURES = join(process.cwd(), 'fixtures', 'original');

/** A committed real-asset fixture as a fresh ArrayBuffer. */
function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

const fs = fsFrom(
  new Map<string, ArrayBuffer>([
    ['admiral.dff', fileOf('vehicles/admiral.dff')],
    ['admiral.txd', fileOf('vehicles/admiral.txd')],
    ['models/generic/vehicle.txd', fileOf('models/generic/vehicle.txd')],
  ]),
);

/** Built ONCE: the real admiral takes seconds under coverage instrumentation, and rebuilding it per
 *  assertion pushed the file past vitest's per-test timeout (a flaky test is worse than no test). */
let cached: null | ReturnType<typeof buildVehicleOsm> = null;
const built = (): ReturnType<typeof buildVehicleOsm> =>
  (cached ??= buildVehicleOsm(fs, 'admiral', { wheelScale: [0.7, 0.7] }));

describe('readVehicleOsm', () => {
  describe('negative cases', () => {
    it('throws when a section is missing rather than returning a half-model', () => {
      const truncated = built().bytes.subarray(0, 16);

      expect(() => readVehicleOsm('admiral', truncated)).toThrow();
    });
  });

  describe('positive cases', () => {
    it('recovers the geometry the writer packed, buffer for buffer', () => {
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);
      const model = read.model;

      expect(model.vertexCount).toBe(source.fixture.vertexCount);
      expect(model.indexCount).toBe(source.fixture.indexCount);
      // The strides are the reader's own constants — if either side changes one, these lengths diverge.
      expect(model.positions.byteLength).toBe(model.vertexCount * 12);
      expect(model.normals.byteLength).toBe(model.vertexCount * 12);
      expect(model.uvs.byteLength).toBe(model.vertexCount * 8);
      expect(model.colors.byteLength).toBe(model.vertexCount * 4);
      expect(model.indices.byteLength).toBe(model.indexCount * 2);
    });

    it('carries the texture dictionary in the container, uncompressed by nobody', () => {
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);
      const arrays = decodeOsmTextures(source.ostex).arrays;

      expect(read.model.textures.length).toBe(arrays.length);
      read.model.textures.forEach((texture, index) => {
        expect(texture.kind).toBe('ostex');
        expect(texture.kind === 'ostex' && texture.bytes).toEqual(arrays[index]);
      });
    });

    it('buckets the dictionary by native size instead of upscaling every layer to the largest', () => {
      // The admiral's chain mixes sizes (its own 256² body set against the shared vehicle.txd's smaller
      // rasters), so the bake must come out as one array per size — the single max-size array taxed every
      // layer with the largest one's footprint, and a 32-layer 2048² mod dictionary hit the VER2 archive's
      // 128 MB entry ceiling that way.
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);

      expect(read.model.textures.length).toBeGreaterThan(1);
      expect(source.warnings).toEqual([]);
      // Every submesh names an array that exists — the runtime binds by this index.
      const arrays = new Set(read.model.submeshes.map((submesh) => submesh.array ?? 0));
      for (const array of arrays) {
        expect(array).toBeLessThan(read.model.textures.length);
      }
    });

    it('bakes the collision the runtime would otherwise parse at spawn', () => {
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);
      const col = parseDffCollision(fs.get('admiral.dff')!)!;

      expect(source.hasCollision).toBe(true);
      expect(read.colliders).not.toBeNull();
      expect(read.colliders?.shape.vertices).toEqual(col.vertices);
      expect(read.colliders?.shape.indices.length).toBe(col.faces.length * 3);
      expect(read.colliders?.shape.spheres.length).toBe(col.spheres.length);
    });

    it('keeps the articulation the handle animates (doors, wheels, submeshes)', () => {
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);

      expect(read.rig.submeshes).toEqual(source.fixture.submeshes);
      expect(read.rig.doors).toEqual(source.fixture.doors);
      expect(read.wheels.length).toBe(source.fixture.wheels.length);
      expect(read.wheels.every((wheel) => wheel.radius > 0)).toBe(true);
    });

    it('agrees with the unoptimized build it replaces — same vertices, same submeshes', () => {
      const source = built();
      const read = readVehicleOsm('admiral', source.bytes);
      const clump = parseDff(fs.get('admiral.dff')!);

      // The writer used the runtime's own builder, so a drift here means the FORMAT lost something.
      expect(clump.atomics.length).toBeGreaterThan(0);
      expect(read.model.parts.length).toBe(source.fixture.parts.length);
      expect(read.model.submeshes.length).toBe(source.fixture.submeshes.length);
    });

    it('carries the pop-up headlight pod through the format — the DESC is where it survives', () => {
      const zr350 = fsFrom(
        new Map<string, ArrayBuffer>([
          ['models/generic/vehicle.txd', fileOf('models/generic/vehicle.txd')],
          ['zr350.dff', fileOf('vehicles/zr350.dff')],
          ['zr350.txd', fileOf('vehicles/zr350.txd')],
        ]),
      );
      const source = buildVehicleOsm(zr350, 'zr350', { wheelScale: [0.7, 0.7] });

      const read = readVehicleOsm('zr350', source.bytes);

      expect(source.fixture.popUpLights).toBeDefined();
      expect(read.rig.popUpLights).toEqual(source.fixture.popUpLights);
      expect(read.rig.parts[read.rig.popUpLights!.part].name).toBe('misc_a');
    });

    it('carries the license-plate tags through the format (082/02)', () => {
      const read = readVehicleOsm('admiral', built().bytes);
      const plates = read.model.submeshes.filter((submesh) => submesh.plate);

      // After conversion the material NAME is gone and the texture layer is model-local, so this tag is
      // the only thing that can still say "this quad is a plate" — it has to survive the DESC round trip.
      expect(new Set(plates.map((submesh) => submesh.plate))).toEqual(new Set(['back', 'face']));
      expect(new Set(plates.map((submesh) => submesh.indexCount))).toEqual(new Set([6]));
    });
  });
});

/**
 * The phase-3 GATE, end-to-end through the real adapter: a converted build spawns a car with NO `.dff`
 * anywhere, and an UNCONVERTED one is refused rather than parsed at spawn.
 *
 * This lives in opensa-pack rather than in `packages/game`'s own integration test because the test needs
 * the WRITER, and the nx boundary (`type:engine` may not depend on `type:tool`) forbids that direction —
 * correctly: the runtime must never reach for the converter.
 */
describe('a converted vehicle through GtaSaWorldAdapter', () => {
  describe('negative cases', () => {
    it('refuses a car that was never converted instead of parsing its DFF at spawn', async () => {
      // The runtime DFF path is gone. What a car carries beyond raw geometry — its pop-up-light
      // declaration, its plate slots, its baked occlusion — is decided at BUILD time, so a car spawned
      // from a `.dff` would not be a slower car but a WRONG one.
      const adapter = new GtaSaWorldAdapter({ cellSize: 250, fs: fsFrom(baseFiles()) });

      await expect(adapter.loadVehicleData('admiral')).rejects.toThrow(/admiral\.osm/);
    });
  });

  describe('positive cases', () => {
    it('spawns from .osm/.ostex with no DFF present at all', async () => {
      const files = convertedFiles();
      const vehicle = await new GtaSaWorldAdapter({ cellSize: 250, fs: fsFrom(files) }).loadVehicleData('admiral');
      const written = readVehicleOsm('admiral', new Uint8Array(files.get('admiral.osm')!));

      expect(files.has('admiral.dff')).toBe(false); // nothing a DFF parser could be handed
      expect(vehicle.model.textures[0].kind).toBe('ostex');
      // Everything the game consumes comes out of the container the writer produced...
      expect(vehicle.model.vertexCount).toBe(written.model.vertexCount);
      expect(vehicle.model.indexCount).toBe(written.model.indexCount);
      expect(vehicle.model.positions).toEqual(written.model.positions);
      expect(vehicle.model.submeshes).toEqual(written.model.submeshes);
      expect(vehicle.halfExtents).toEqual(written.halfExtents);
      expect(vehicle.seat).toEqual(written.seat);
      expect(vehicle.wheels).toEqual(written.wheels);
      expect(vehicle.colliders?.shape.vertices).toEqual(written.colliders?.shape.vertices);
      // ...except the data rows, which the adapter still reads from the text files at spawn.
      expect(vehicle.handling.mass).toBeGreaterThan(0);
    });

    it('maps the WHOLE handling row, not the five columns it used to (081/02)', async () => {
      // Pinned against the stock fixture's real ADMIRAL line — the column order is verified by the DATA,
      // because the file's own legend lists a "(not used)" column the shipped rows do not carry. Every
      // value here is as authored: converting one into a force or a spring is the consuming plan's job.
      //
      // Three of these are what 081/01 blamed by name for the fleet driving alike: the authored
      // `centreOfMass` (the flip), `turnMass` (a 6.5 t truck answering the wheel faster than a supercar)
      // and `drive` — this car is FRONT-wheel drive and the engine drives all four of its wheels today.
      const adapter = new GtaSaWorldAdapter({ cellSize: 250, fs: fsFrom(convertedFiles()) });

      const { handling } = await adapter.loadVehicleData('admiral');

      expect(handling).toEqual({
        abs: false,
        // The stock ADMIRAL authors no axle bits at all (`modelFlags` 0) — 26 of the 210 rows do, and this
        // is not one of them, so both ends read as the default independent build (081/06 §3).
        axleFront: { reverse: false, type: 'independent' },
        axleRear: { reverse: false, type: 'independent' },
        brakeBias: 0.52,
        brakeDecel: 8.5,
        centreOfMass: [0, 0, -0.05],
        collisionDamageMult: 0.56,
        dragMult: 2,
        drive: 'F',
        engineAccel: 22,
        engineInertia: 8,
        engineType: 'P',
        gears: 5,
        mass: 1650,
        maxVelocity: 165,
        steeringLock: 30,
        suspAntiDive: 0.55,
        suspBias: 0.5,
        suspDamping: 0.15,
        suspForce: 1,
        suspHighSpeedDamp: 0,
        suspLower: -0.19,
        suspUpper: 0.27,
        tractionBias: 0.51,
        tractionLoss: 0.9,
        tractionMult: 0.65,
        turnMass: 3851.4,
      });
    });
  });
});

function baseFiles(): Map<string, ArrayBuffer> {
  return new Map<string, ArrayBuffer>([
    ['admiral.dff', fileOf('vehicles/admiral.dff')],
    ['admiral.txd', fileOf('vehicles/admiral.txd')],
    ['data/carcols.dat', fileOf('data/carcols.dat')],
    ['data/handling.cfg', fileOf('data/handling.cfg')],
    ['data/vehicles.ide', fileOf('data/vehicles.ide')],
    ['models/generic/vehicle.txd', fileOf('models/generic/vehicle.txd')],
  ]);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The archives as opensa-pack leaves them: the `.dff`/`.txd` deleted, the converted pair in their place. */
function convertedFiles(): Map<string, ArrayBuffer> {
  const files = baseFiles();
  // The def drives the build exactly as `packVehicles` does — hardcoding a wheelScale here made the two
  // paths disagree on wheel RADIUS, which is the test catching a fixture lie rather than a product bug.
  const def = parseVehicleDefs(new TextDecoder().decode(files.get('data/vehicles.ide'))).get('admiral')!;
  const osm = buildVehicleOsm(fsFrom(files), 'admiral', { txd: def.txd.toLowerCase(), wheelScale: def.wheelScale });
  files.delete('admiral.dff');
  files.delete('admiral.txd');
  files.set('admiral.osm', bufferOf(osm.bytes)); // the dictionary rides inside, in `TEXS`

  return files;
}

function fsFrom(files: Map<string, ArrayBuffer>): AssetFileSystem {
  return {
    get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
    getText: (name: string): null | string => {
      const file = files.get(name.toLowerCase());

      return file ? new TextDecoder().decode(file) : null;
    },
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}
