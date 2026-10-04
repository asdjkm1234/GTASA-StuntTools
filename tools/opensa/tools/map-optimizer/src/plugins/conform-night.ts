import type { NightVerdict } from '../adapters/gta-sa/prelit-context';
import type { MapPlugin } from '../core/asset';

import { tailGuard } from './apply-prelit-level';

/** Cap every vertex's night luma at `max` (hue preserved): dims ONLY the glow — dark walls stay untouched
 *  (only-mode `nightMax`; a uniform scale blackens the walls before the windows come down). Exported for tests. */
export function capNightSet(night: Uint8Array, max: number): void {
  for (let i = 0; i < night.length; i += 4) {
    const luma = (night[i] + night[i + 1] + night[i + 2]) / 3;
    if (luma <= max) {
      continue;
    }
    const factor = max / luma;
    night[i] = clamp(night[i] * factor);
    night[i + 1] = clamp(night[i + 1] * factor);
    night[i + 2] = clamp(night[i + 2] * factor);
  }
}

/**
 * Apply the world-context **night** verdicts (plan 019 — replaces `synthesize-night` of plan 013 and adds the
 * repair that pass never had):
 *
 * - `synthesize` — a model with **no** night set gets one derived from its (already level-corrected) day
 *   prelit at the **neighbourhood's** night/day ratio — not a global scale, so a bright gas pump doesn't glow
 *   4× its street. Alpha is forced opaque (the engine ignores night alpha).
 * - `repair` — an existing night set whose median is off the neighbourhood ratio is scaled toward it; when
 *   the scale **darkens**, it fades out across the model's own bright night tail (`protectFrom → protectTo`)
 *   so lit windows / floodlights keep glowing while the walls come down to the street's night level.
 *
 * Ordered LAST of the prelight passes — the night set must derive from the final (welded + levelled) day.
 */
export function createConformNight(verdicts: ReadonlyMap<string, NightVerdict>): MapPlugin {
  return {
    name: 'conform-night',
    transform(asset, context): void {
      const verdict = verdicts.get(asset.name);
      if (!verdict) {
        return;
      }
      let synthesized = 0;
      let repaired = 0;
      for (const mesh of asset.ir.meshes) {
        if (!mesh.prelitColors) {
          continue;
        }
        if (verdict.kind === 'synthesize') {
          if (!mesh.nightColors) {
            mesh.nightColors = synthesizeNightSet(mesh.prelitColors, verdict.ratio);
            synthesized += 1;
          }
        } else if (mesh.nightColors) {
          if (verdict.kind === 'cap') {
            capNightSet(mesh.nightColors, verdict.max);
          } else {
            scaleNightSet(mesh.nightColors, verdict);
          }
          repaired += 1;
        }
      }
      if (synthesized + repaired > 0) {
        asset.dirty = true;
        const what = verdict.kind === 'synthesize' ? `synthesized ${synthesized}` : `repaired ${repaired}`;
        context.log(asset, 'conform-night', `${what} night set(s)`);
      }
    },
  };
}

/** Scale an existing night set's RGB in place (tail-guarded when darkening). Exported for tests. */
export function scaleNightSet(
  night: Uint8Array,
  verdict: { protectFrom: number; protectTo: number; scale: number },
): void {
  for (let i = 0; i < night.length; i += 4) {
    const luma = (night[i] + night[i + 1] + night[i + 2]) / 3;
    // tailGuard = 1 below the tail (full effect) → protection = 1 − guard rises across the bright tail.
    const protection = verdict.scale < 1 ? 1 - tailGuard(luma, verdict.protectFrom, verdict.protectTo) : 0;
    const scale = verdict.scale + (1 - verdict.scale) * protection; // protected vertices keep their value
    night[i] = clamp(night[i] * scale);
    night[i + 1] = clamp(night[i + 1] * scale);
    night[i + 2] = clamp(night[i + 2] * scale);
  }
}

/** Derive a night RGBA set from day prelit at the given ratio; alpha forced opaque. Exported for tests. */
export function synthesizeNightSet(prelit: Uint8Array, ratio: number): Uint8Array {
  const night = new Uint8Array(prelit.length);
  for (let i = 0; i < prelit.length; i += 4) {
    night[i] = clamp(prelit[i] * ratio);
    night[i + 1] = clamp(prelit[i + 1] * ratio);
    night[i + 2] = clamp(prelit[i + 2] * ratio);
    night[i + 3] = 255;
  }

  return night;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
