/**
 * SA's ANIMATED MAP OBJECTS (074/08 B7·b) — garage doors, windmills, spinning signs — as data both renderers
 * can drive.
 *
 * The trick is that these are not skinned meshes: the DFF is a multi-frame CLUMP and the IFP's "bones" are its
 * FRAMES, matched by name. Each atomic rides one frame rigidly. So a frame hierarchy is just a skeleton where
 * every vertex has weight 1 on a single bone — which means the engine's existing IFP sampler drives it with no
 * new machinery, provided we hand it identity inverse-binds (we want the frame's WORLD matrix, not a skinning
 * matrix).
 *
 * Two SA facts this encodes, both learned the hard way in plan 041:
 * - the clip inside the IFP is named after the MODEL, not after the def or the IFP file;
 * - object clips KEEP their translation (a garage door slides). Ped clips drop it — locomotion is in-place.
 */
import type { IfpAnimation } from '../parsers/binary/ifp';
import type { RWFrame } from '../parsers/binary/types';

/**
 * The frame data these functions actually need — name, local transform, parent. `RWClump['frames']`
 * satisfies it, and so does a `SKEL` section decoded from a converted `.osm` (opensa-pack 003 phase 5),
 * which is how the optimized path drives an animated object with no clump at all.
 */
export type AnimFrame = Pick<RWFrame, 'name' | 'parentIndex' | 'position' | 'rotation'>;

/**
 * Structurally the own engine's `SamplerBone` / `SamplerClip` — declared here rather than imported, because
 * renderware sits BELOW the engine and must not depend on it (the three path uses this module too).
 */
export interface FrameBone {
  bindPosition: readonly [number, number, number];
  bindRotation: readonly [number, number, number, number];
  inverseBind: readonly number[];
  parent: number;
}

export interface FrameClip {
  duration: number;
  tracks: readonly { positions?: readonly number[]; quats: readonly number[]; times: readonly number[] }[];
}

/** ANP3 stores time in 1/60 s units. */
const TIME_SCALE = 1 / 60;

/** The frames an IFP clip actually moves — and every frame hanging off them, which moves with them. */
export function animatedFrames(frames: readonly AnimFrame[], animation: IfpAnimation): Set<number> {
  const moved = new Set<number>();
  const byName = new Map<string, number>();
  frames.forEach((frame, index) => byName.set(frame.name.trim().toLowerCase(), index));
  for (const bone of animation.bones) {
    const index = byName.get(bone.name.trim().toLowerCase());
    if (index !== undefined && bone.frames.length > 0) {
      moved.add(index);
    }
  }
  // A frame's children ride it: the windmill's blades are not in the clip, its hub is.
  let grew = true;
  while (grew) {
    grew = false;
    frames.forEach((frame, index) => {
      if (!moved.has(index) && frame.parentIndex >= 0 && moved.has(frame.parentIndex)) {
        moved.add(index);
        grew = true;
      }
    });
  }

  return moved;
}

/** The clip an animated model plays: the IFP entry named after the model itself. */
export function clipForModel(animations: readonly IfpAnimation[], modelName: string): IfpAnimation | undefined {
  return animations.find((animation) => animation.name.toLowerCase() === modelName.toLowerCase());
}

/**
 * The clump's frames as sampler bones. `inverseBind` is IDENTITY on purpose: a rigid frame carries its atomic
 * whole, so what we want out of the sampler is the frame's world matrix, not a skinning matrix.
 */
export function frameBones(frames: readonly AnimFrame[]): FrameBone[] {
  return frames.map((frame) => ({
    bindPosition: [frame.position[0], frame.position[1], frame.position[2]] as const,
    bindRotation: quatOfFrame(frame),
    inverseBind: IDENTITY,
    parent: frame.parentIndex,
  }));
}

/**
 * The clip, with one track per CLUMP FRAME (index-aligned with {@link frameBones}) — the IFP names its bones
 * after the frames. A frame the clip does not mention gets an empty track and holds its bind pose.
 */
export function frameClip(frames: readonly AnimFrame[], animation: IfpAnimation): FrameClip {
  const byName = new Map<string, IfpAnimation['bones'][number]>();
  for (const bone of animation.bones) {
    byName.set(bone.name.trim().toLowerCase(), bone);
  }
  let duration = 0;
  const tracks = frames.map((frame) => {
    const bone = byName.get(frame.name.trim().toLowerCase());
    if (!bone || bone.frames.length === 0) {
      return { quats: [], times: [] };
    }
    const times: number[] = [];
    const quats: number[] = [];
    const positions: number[] = [];
    let translated = false;
    for (const key of bone.frames) {
      times.push(key.time * TIME_SCALE);
      quats.push(...key.rotation);
      // A key with no translation holds the frame's bind position — mixing the two in one track is how a
      // partially-translated door ends up snapping back to the origin between keys.
      positions.push(...(key.translation ?? frame.position));
      translated ||= key.translation !== undefined;
    }
    duration = Math.max(duration, times[times.length - 1] ?? 0);

    return translated ? { positions, quats, times } : { quats, times };
  });

  return { duration, tracks };
}

const IDENTITY: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A frame's 3×3 (column-major, RW order) as a quaternion (x, y, z, w). */
function quatOfFrame(frame: AnimFrame): [number, number, number, number] {
  const m = frame.rotation;
  const trace = m[0] + m[4] + m[8];
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);

    return [(m[5] - m[7]) * s, (m[6] - m[2]) * s, (m[1] - m[3]) * s, 0.25 / s];
  }
  if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);

    return [0.25 * s, (m[3] + m[1]) / s, (m[6] + m[2]) / s, (m[5] - m[7]) / s];
  }
  if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);

    return [(m[3] + m[1]) / s, 0.25 * s, (m[7] + m[5]) / s, (m[6] - m[2]) / s];
  }
  const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);

  return [(m[6] + m[2]) / s, (m[7] + m[5]) / s, 0.25 * s, (m[1] - m[3]) / s];
}
