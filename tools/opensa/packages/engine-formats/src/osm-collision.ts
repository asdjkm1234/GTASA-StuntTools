/**
 * The `.osm` `COLL` section (plan opensa-pack/003 phase 2): collision in the shape the ENGINE consumes,
 * not the shape RenderWare stores.
 *
 * Today a vehicle spawn walks the DFF chunk tree to find the embedded COL chunk, copies it, parses spheres/
 * boxes/vertices/faces, maps the faces into a flat index array and derives half-extents from the bounds —
 * all on the MAIN thread, per new car type (`gta-sa-world.adapter.ts:612-632`). Every one of those steps is
 * offline work wearing a runtime costume. Here it is a struct read.
 *
 * Lives in engine-formats because both sides need it: the converter writes it, the runtime reads it.
 */
import { ByteReader, ByteWriter } from './binary';

export interface OsmCollision {
  boxes: OsmCollisionBox[];
  /** Robust half-extents (from the COL bounds, not the mesh bbox — modded DFFs carry stray vertices). */
  halfExtents: [number, number, number];
  /** Flattened triangle indices into {@link vertices}. */
  indices: Uint32Array;
  spheres: OsmCollisionSphere[];
  /** Positions in GTA model space (Z-up), flattened (n × 3). */
  vertices: Float32Array;
}

export interface OsmCollisionBox {
  max: readonly [number, number, number];
  min: readonly [number, number, number];
}

export interface OsmCollisionSphere {
  center: readonly [number, number, number];
  radius: number;
}

export function decodeOsmCollision(bytes: Uint8Array): OsmCollision {
  const r = new ByteReader(bytes);
  const halfExtents: [number, number, number] = [r.f32(), r.f32(), r.f32()];
  const sphereCount = r.u32();
  const boxCount = r.u32();
  const vertexCount = r.u32();
  const indexCount = r.u32();

  const spheres: OsmCollisionSphere[] = [];
  for (let index = 0; index < sphereCount; index += 1) {
    const center: [number, number, number] = [r.f32(), r.f32(), r.f32()];
    spheres.push({ center, radius: r.f32() });
  }
  const boxes: OsmCollisionBox[] = [];
  for (let index = 0; index < boxCount; index += 1) {
    const min: [number, number, number] = [r.f32(), r.f32(), r.f32()];
    const max: [number, number, number] = [r.f32(), r.f32(), r.f32()];
    boxes.push({ max, min });
  }

  // Copy out: the source may be a view over a larger buffer at an unaligned offset.
  const vertices = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertices.length; index += 1) {
    vertices[index] = r.f32();
  }
  const indices = new Uint32Array(indexCount);
  for (let index = 0; index < indexCount; index += 1) {
    indices[index] = r.u32();
  }

  return { boxes, halfExtents, indices, spheres, vertices };
}

export function encodeOsmCollision(collision: OsmCollision): Uint8Array {
  const w = new ByteWriter(
    64 +
      collision.spheres.length * 16 +
      collision.boxes.length * 24 +
      collision.vertices.byteLength +
      collision.indices.byteLength,
  );
  w.f32(collision.halfExtents[0]);
  w.f32(collision.halfExtents[1]);
  w.f32(collision.halfExtents[2]);
  w.u32(collision.spheres.length);
  w.u32(collision.boxes.length);
  w.u32(collision.vertices.length / 3);
  w.u32(collision.indices.length);

  for (const sphere of collision.spheres) {
    w.f32(sphere.center[0]);
    w.f32(sphere.center[1]);
    w.f32(sphere.center[2]);
    w.f32(sphere.radius);
  }
  for (const box of collision.boxes) {
    w.f32(box.min[0]);
    w.f32(box.min[1]);
    w.f32(box.min[2]);
    w.f32(box.max[0]);
    w.f32(box.max[1]);
    w.f32(box.max[2]);
  }
  for (const value of collision.vertices) {
    w.f32(value);
  }
  for (const value of collision.indices) {
    w.u32(value);
  }

  return w.bytes();
}
