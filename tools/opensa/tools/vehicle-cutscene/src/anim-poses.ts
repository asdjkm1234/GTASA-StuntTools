/**
 * Wheel poses from the scene animations (`anim/cuts.img`, plan 004 round 16). The runtime replays a
 * NAME-bound channel for every bone, so the ANIM's frame-0 value — not the DFF bind — is where a bone
 * really stands in a scene. R*'s own csglendale92 binds its LEFT wheels crossed front-to-rear versus
 * what every scene drives (SMOKE1B: each left wheel sat 0.21 m off its arch after the bind-classified
 * shim met the anim pose). The template therefore takes wheel corners from the anims when a pose is
 * known; the bind stays the fallback for models no scene animates.
 *
 * The cutscene IFPs are the old ANPK format (see `scripts/debug/cutscene-anim-channels.ts`, the
 * instrument this parser mirrors): chunks 4-byte aligned, `NAME` = the object the following `DGAN`
 * drives, each `ANIM` = one bone channel (28-char name + frame count), its keyframe block (`KRT0` =
 * rot+trans rows of 8×f32, `KR00` = rot-only) follows as a sibling.
 */
import { openArchive } from '@opensa/renderware/archive/img-archive';

export type WheelPose = readonly [number, number, number];

/** Per cutscene model (lowercased): each `wheel*`/`box*` bone's frame-0 KRT0 translation. The first
 *  scene that poses a bone wins — the poses are static corner placements, identical across scenes. */
export function wheelAnimPoses(cutsImgBytes: Uint8Array): Map<string, Map<string, WheelPose>> {
  const archive = openArchive(cutsImgBytes);
  const poses = new Map<string, Map<string, WheelPose>>();
  for (const entry of archive.names) {
    if (!entry.endsWith('.ifp')) {
      continue;
    }
    const buf = archive.get(entry);
    if (buf) {
      collectFromIfp(new Uint8Array(buf), poses);
    }
  }

  return poses;
}

const WHEEL_BONE_RE = /^(?:wheel|box)/i;

function collectFromIfp(data: Uint8Array, poses: Map<string, Map<string, WheelPose>>): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (at: number): string => String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]);
  const cstr = (at: number, max: number): string => {
    let out = '';
    for (let i = 0; i < max && data[at + i] !== 0; i += 1) {
      out += String.fromCharCode(data[at + i]);
    }

    return out;
  };
  const align = (value: number): number => (value + 3) & ~3;

  let pos = 8; // inside the ANPK container
  let object = '';
  while (pos + 8 <= data.length) {
    const kind = tag(pos);
    const size = view.getUint32(pos + 4, true);
    if (kind === 'NAME') {
      object = cstr(pos + 8, size).toLowerCase();
      pos = align(pos + 8 + size);
    } else if (kind === 'DGAN' || kind === 'CPAN') {
      pos += 8; // containers: descend
    } else if (kind === 'ANIM') {
      const bone = cstr(pos + 8, 28)
        .trim()
        .toLowerCase();
      const keyframesAt = align(pos + 8 + size);
      if (WHEEL_BONE_RE.test(bone) && keyframesAt + 40 <= data.length && tag(keyframesAt) === 'KRT0') {
        let model = poses.get(object);
        if (!model) {
          model = new Map();
          poses.set(object, model);
        }
        if (!model.has(bone)) {
          const at = keyframesAt + 8 + 16; // past chunk header + frame-0 quaternion
          model.set(bone, [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)]);
        }
      }
      pos = keyframesAt;
    } else {
      pos = align(pos + 8 + size); // INFO / keyframe blocks / unknowns
    }
  }
}
