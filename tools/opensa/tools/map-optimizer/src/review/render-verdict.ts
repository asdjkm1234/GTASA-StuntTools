import type { PreviewImage } from '@opensa/lod-common/preview';
import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { buildClumpMesh } from '@opensa/lod-common/build-mesh';
import { renderMeshPreview } from '@opensa/lod-common/preview';

import type { PrelitVerdict } from '../adapters/gta-sa/prelit-context';

import { shiftPrelit } from '../plugins/apply-prelit-level';
import { capNightSet, scaleNightSet, synthesizeNightSet } from '../plugins/conform-night';

/**
 * Render the four review thumbnails for one model + verdict (plan 019 Phase 2): day and night, before and
 * after the verdict is applied **in memory** (the same exported applier maths the pipeline plugins use — the
 * report previews exactly what a run would do, without needing a completed run). Night images are null when
 * the model has no night set on that side. Textures are deliberately NOT sampled: prelit × white shows the
 * vertex colours directly, which is what the review judges.
 */
export interface VerdictThumbnails {
  dayAfter: PreviewImage;
  dayBefore: PreviewImage;
  nightAfter: null | PreviewImage;
  nightBefore: null | PreviewImage;
}

export function renderVerdictThumbnails(clump: RWClump, verdict: PrelitVerdict, size = 160): VerdictThumbnails {
  const mesh = buildClumpMesh(clump);
  const camera = frameCamera(mesh.positions);
  const render = (colors: Uint8Array): PreviewImage =>
    renderMeshPreview({ ...mesh, colors }, camera, { cull: 'none', height: size, width: size });

  const dayAfterColors = new Uint8Array(mesh.colors);
  if (verdict.level) {
    shiftPrelit(dayAfterColors, verdict.level);
  }

  let nightAfterColors: null | Uint8Array = mesh.nightColors ? new Uint8Array(mesh.nightColors) : null;
  if (verdict.night?.kind === 'repair' && nightAfterColors) {
    scaleNightSet(nightAfterColors, verdict.night);
  } else if (verdict.night?.kind === 'cap' && nightAfterColors) {
    capNightSet(nightAfterColors, verdict.night.max);
  } else if (verdict.night?.kind === 'synthesize') {
    nightAfterColors = synthesizeNightSet(dayAfterColors, verdict.night.ratio);
  }

  return {
    dayAfter: render(dayAfterColors),
    dayBefore: render(mesh.colors),
    nightAfter: nightAfterColors ? render(nightAfterColors) : null,
    nightBefore: mesh.nightColors ? render(mesh.nightColors) : null,
  };
}

/** Frame the mesh: look at the bounds centre from an upper-diagonal, distance from the bounding radius. */
function frameCamera(positions: Float32Array): {
  fovYDeg: number;
  position: [number, number, number];
  target: [number, number, number];
} {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const target: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  const distance = radius * 2.2; // fits a radius-r sphere in a 45° fov with margin

  return {
    fovYDeg: 45,
    position: [target[0] + distance * 0.62, target[1] - distance * 0.62, target[2] + distance * 0.48],
    target,
  };
}
