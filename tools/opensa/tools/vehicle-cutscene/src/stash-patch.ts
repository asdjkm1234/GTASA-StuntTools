/**
 * The wheel-stash sink (plan 004 round 20, SYND_4A). R* hides a repair-scene's wheels by animating
 * the wheel BONES from their corner binds to the model origin, where the VANILLA body and the ground
 * conceal them (the axes stay at the corners — the authored bare-hub look). A converted mod leaks
 * the trick: fatter wheels and corner shims poke the clump out between ground and floor, and no
 * static model data can fix it (one shim must serve both the driving pose and the stash pose).
 *
 * So the fix patches the SCENE VALUE instead, preserving the authored intent for any body: every
 * cutscene wheel channel whose frame-0 translation is ~zero while the model's bind local is a real
 * corner (>= 0.5 m) is a STASH — its z sinks to {@link STASH_SINK_Z}, fully underground for any mod
 * wheel radius. Measured fleet-wide: exactly ONE site matches in all 148 scenes (synd_4a.ifp,
 * cswashington, four channels) — the patch is surgical by construction, and the rule stays general
 * for future scene data. Driving scenes never trip it (their wheel channels carry corner values).
 *
 * The ANPK walk mirrors `anim-poses.ts`; the write is in-place (12 bytes per channel), everything
 * else byte-verbatim.
 */
import { buildVer2Buffer, openArchive } from '@opensa/renderware/archive/img-archive';

/** Below any mod wheel's radius (fleet max ~0.4) with margin — the whole wheel ends underground. */
export const STASH_SINK_Z = -0.6;

export interface StashPatchResult {
  bytes: null | Uint8Array;
  /** One `<scene.ifp> <model> <bone>` row per sunk channel (empty = nothing matched, bytes null). */
  patched: string[];
}

/**
 * Return a rebuilt `cuts.img` with every wheel-stash channel sunk, or `bytes: null` when no channel
 * matches. `wheelCornerBinds`: per cs model (lowercased), each wheel bone's bind-local DISTANCE from
 * its parent origin — the corner test's reference (built by the caller from the vanilla cs DFFs).
 */
export function patchWheelStashes(
  cutsImgBytes: Uint8Array,
  wheelCornerBinds: ReadonlyMap<string, ReadonlyMap<string, number>>,
): StashPatchResult {
  const archive = openArchive(cutsImgBytes);
  const patched: string[] = [];
  const entries: { data: Uint8Array; name: string }[] = [];
  for (const name of archive.names) {
    const buf = archive.get(name);
    if (!buf) {
      continue;
    }
    const data = new Uint8Array(buf.slice(0));
    if (name.endsWith('.ifp')) {
      for (const hit of sinkStashChannels(data, wheelCornerBinds)) {
        patched.push(`${name} ${hit}`);
      }
    }
    entries.push({ data, name });
  }

  return patched.length === 0 ? { bytes: null, patched } : { bytes: buildVer2Buffer(entries), patched };
}

/** Sink matching channels in ONE ANPK ifp in place; returns `<model> <bone>` per patched channel. */
function sinkStashChannels(
  data: Uint8Array,
  wheelCornerBinds: ReadonlyMap<string, ReadonlyMap<string, number>>,
): string[] {
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

  const hits: string[] = [];
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
      const bindDistance = wheelCornerBinds.get(object)?.get(bone);
      if (
        bindDistance !== undefined &&
        bindDistance >= 0.5 &&
        keyframesAt + 40 <= data.length &&
        tag(keyframesAt) === 'KRT0'
      ) {
        const frames = view.getUint32(pos + 36, true);
        const transAt = keyframesAt + 8 + 16; // past chunk header + the frame-0 quaternion
        const t = [0, 1, 2].map((i) => view.getFloat32(transAt + i * 4, true));
        if (Math.hypot(t[0], t[1], t[2]) < 0.05) {
          // Sink EVERY frame of the channel (KRT0 rows are 32 B) — a stash pose may hold >1 frame.
          for (let f = 0; f < frames; f += 1) {
            view.setFloat32(keyframesAt + 8 + f * 32 + 24, STASH_SINK_Z, true);
          }
          hits.push(`${object} ${bone}`);
        }
      }
      pos = keyframesAt;
    } else {
      pos = align(pos + 8 + size); // INFO / keyframe blocks / unknowns
    }
  }

  return hits;
}
