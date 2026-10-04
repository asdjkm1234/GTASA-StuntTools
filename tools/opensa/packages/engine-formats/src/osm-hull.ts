/**
 * The `.osm` `HULL` section (plan opensa-pack/003 phase 5): a topple prop's collider points.
 *
 * When a car knocks a lamppost over, the host builds a physics body from the mesh's own convex hull. That
 * hull is NOT stored — the host hands Rapier the raw vertex cloud and Rapier hulls it — so today the topple
 * path runs a SECOND `getClump` over every geometry just to collect positions
 * (`engine-props.ts:179-213`). Offline, that is a struct read.
 *
 * The points are DEDUPLICATED, which cannot change the result: a convex hull is determined by its point
 * SET, and RW geometry repeats the same position across faces heavily. `centre`/`half` are the bounding box
 * the host falls back to, with its 0.12 floor already applied (a lamppost's box is thin enough to make the
 * solver jitter).
 */
import { ByteReader, ByteWriter } from './binary';

export interface OsmHull {
  /** Bounding-box centre in model space — the topple impulse is applied above it. */
  centre: [number, number, number];
  /** Bounding-box half-extents, floored, as the fallback shape. */
  half: [number, number, number];
  /** Deduplicated vertex positions, flattened (points × 3) — the collider's hull cloud. */
  points: Float32Array;
}

export function decodeOsmHull(bytes: Uint8Array): OsmHull {
  const r = new ByteReader(bytes);
  const centre: [number, number, number] = [r.f32(), r.f32(), r.f32()];
  const half: [number, number, number] = [r.f32(), r.f32(), r.f32()];
  const pointCount = r.u32();

  // Copy out: the section is a view over the container at a possibly unaligned offset.
  const points = new Float32Array(pointCount * 3);
  for (let index = 0; index < points.length; index += 1) {
    points[index] = r.f32();
  }

  return { centre, half, points };
}

export function encodeOsmHull(hull: OsmHull): Uint8Array {
  const w = new ByteWriter(32 + hull.points.byteLength);
  for (const value of hull.centre) {
    w.f32(value);
  }
  for (const value of hull.half) {
    w.f32(value);
  }
  w.u32(hull.points.length / 3);
  for (const value of hull.points) {
    w.f32(value);
  }

  return w.bytes();
}
