/**
 * The `.osm` `SKEL` section (plan opensa-pack/003 phase 5): a clump's FRAME TREE.
 *
 * SA's animated map objects — garage doors, windmills, spinning signs — are not skinned meshes: the DFF is a
 * multi-frame clump and the IFP's "bones" are its FRAMES, matched by name. Everything the runtime derives
 * for one (which frames the clip moves, the sampler bones, the resolved tracks, the part→frame map) comes
 * from those frames and nothing else, so baking the tree replaces the clump entirely.
 *
 * The IFP is deliberately NOT baked in. A clip is a separate, moddable asset resolved by name at runtime,
 * and burning it into the model would freeze that binding — the same mistake the manifest made with timecyc.
 *
 * What a frame carries here is everything `RWFrame` holds that a rigid consumer can use: `name`, `position`,
 * the full 3×3 `rotation`, `parentIndex`, and `boneId` when the frame has an HAnim plugin. The HAnim
 * *hierarchy table* is not here — it belongs to skinned models, whose skeleton is a different shape (skin
 * order, real inverse binds) and will be its own section.
 */
import { ByteReader, ByteWriter } from './binary';

export interface OsmFrame {
  /** HAnim bone id, or -1 when the frame carries no HAnim plugin. */
  boneId: number;
  name: string;
  /** Index of the parent frame, or -1 for a root. */
  parentIndex: number;
  position: [number, number, number];
  /** Row-major 3×3, flattened (9 floats) — verbatim from the clump. */
  rotation: number[];
}

export interface OsmSkeleton {
  frames: OsmFrame[];
}

export function decodeOsmSkeleton(bytes: Uint8Array): OsmSkeleton {
  const r = new ByteReader(bytes);
  const count = r.u32();
  const frames: OsmFrame[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = new TextDecoder().decode(r.raw(r.u16()));
    const parentIndex = r.i32();
    const boneId = r.i32();
    const position: [number, number, number] = [r.f32(), r.f32(), r.f32()];
    const rotation: number[] = [];
    for (let at = 0; at < 9; at += 1) {
      rotation.push(r.f32());
    }
    frames.push({ boneId, name, parentIndex, position, rotation });
  }

  return { frames };
}

export function encodeOsmSkeleton(skeleton: OsmSkeleton): Uint8Array {
  const w = new ByteWriter(16 + skeleton.frames.length * 96);
  w.u32(skeleton.frames.length);
  for (const frame of skeleton.frames) {
    const name = new TextEncoder().encode(frame.name);
    w.u16(name.length);
    w.raw(name);
    w.i32(frame.parentIndex);
    w.i32(frame.boneId);
    for (const value of frame.position) {
      w.f32(value);
    }
    if (frame.rotation.length !== 9) {
      throw new Error(`frame '${frame.name}' rotation must be 9 floats, got ${frame.rotation.length}`);
    }
    for (const value of frame.rotation) {
      w.f32(value);
    }
  }

  return w.bytes();
}
