import type { LevelVerdict } from '../adapters/gta-sa/prelit-context';
import type { MapPlugin } from '../core/asset';

/**
 * Apply the world-context **day-level** verdicts (plan 019 — replaces the blind `condition-prelit` of plan
 * 012): an additive luma shift computed against the model's neighbourhood, contrast-preserving (the whole
 * distribution moves, the baked AO spread stays). When the shift **darkens**, it fades to zero across the
 * model's own bright tail (`protectFrom → protectTo`) so legitimately bright vertices — lit windows, signs —
 * keep their level while the median comes down. Alpha is never touched (wind sway / floodlight cones).
 */
export function createApplyPrelitLevel(verdicts: ReadonlyMap<string, LevelVerdict>): MapPlugin {
  return {
    name: 'apply-prelit-level',
    transform(asset, context): void {
      const verdict = verdicts.get(asset.name);
      if (!verdict || verdict.shift === 0) {
        return;
      }
      let touched = 0;
      for (const mesh of asset.ir.meshes) {
        if (mesh.prelitColors) {
          shiftPrelit(mesh.prelitColors, verdict);
          touched += 1;
        }
      }
      if (touched > 0) {
        asset.dirty = true;
        context.log(asset, 'apply-prelit-level', `shifted ${touched} mesh(es) by ${verdict.shift}`);
      }
    },
  };
}

/** Shift a prelit buffer's RGB in place (tail-guarded when darkening). Exported for tests. */
export function shiftPrelit(prelit: Uint8Array, verdict: LevelVerdict): void {
  for (let i = 0; i < prelit.length; i += 4) {
    const luma = (prelit[i] + prelit[i + 1] + prelit[i + 2]) / 3;
    const shift = verdict.shift * (verdict.shift < 0 ? tailGuard(luma, verdict.protectFrom, verdict.protectTo) : 1);
    prelit[i] = clamp(prelit[i] + shift);
    prelit[i + 1] = clamp(prelit[i + 1] + shift);
    prelit[i + 2] = clamp(prelit[i + 2] + shift);
  }
}

/** 1 below `from`, fading linearly to 0 at `to` — darkening never touches the model's own bright tail. */
export function tailGuard(luma: number, from: number, to: number): number {
  if (luma <= from) {
    return 1;
  }
  if (luma >= to) {
    return 0;
  }

  return (to - luma) / Math.max(1e-6, to - from);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
