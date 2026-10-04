/**
 * The bike branch (plan 002 step 8, csmtbike92): the same emit model as cars — vanilla locals as the
 * anims' bind pose, un-animated shims absorbing donor deltas, whole-shell adoption (see `rig/car.ts`) —
 * with the bike vocabulary. The vanilla bike rig has NO wheel corners: every part (wheel_rear, chainset,
 * pedal_l/r, handlebars, forks_front, wheel_front) is a bone in the chassis subtree, so the conversion
 * is the shared "body + parts subtree" pass (`rig/emit.ts`), and there is no wheel duplication step.
 *
 * What the real corpus adds (probed on the Smooth Criminal Bicycles 3.0 MTB, 2026-08-13):
 *   - a template part may match a mod DUMMY: the mod's `chassis`/`wheel_rear`/`forks_front` carry no
 *     mesh — the geometry hangs in children (`wheel_pj=0-2c`, seat/frame sub-meshes). The bone is
 *     emitted meshless and the subtree meshes are ADOPTED under it, riding its channel (the wheel spins
 *     with its bone);
 *   - `f_extras:<n>`/`f_class:<n>` containers hold variant SUBTREES, not single meshes — the a/b
 *     handlebar sets carry brake levers and grips as sub-meshes. The first child subtree with a mesh is
 *     adopted WHOLE and the other children are dropped; the car branch's one-mesh rule would strip the
 *     levers off the bars. (The car branch keeps its field-frozen rule — gates 4+7.)
 *   - `f_extras:<n>+` containers are ADDITIVE (both wheel reflectors ship in one) — every child is kept.
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { resolveSeatPoints } from '../seats';
import { type CsBikeTemplate, geometryZHalfExtent, toArrayBuffer } from '../template';
import { writeClump } from './clump-io';
import {
  analyzePartsRig,
  buildHierarchy,
  collectDropped,
  type ConvertReport,
  emitPartsRig,
  emptyEmit,
  finalizeAtomics,
  firstAtomicInSubtree,
  matchPart,
  type PartsRigAnalysis,
} from './emit';

export type BikeConvertReport = ConvertReport;

/** Convert one mod bike DFF into its cutscene counterpart. Throws when the mod has no chassis frame or
 *  no rear-wheel mesh — a bike that cannot stand is an error, not a silent skip. */
export function convertBike(
  modDff: Uint8Array,
  template: CsBikeTemplate,
): { dff: Uint8Array; report: BikeConvertReport } {
  const analysis = analyzePartsRig(modDff, 'chassis');
  const shiftZ = groundShift(modDff, template, analysis);
  const emit = emptyEmit({ nextBoneId: nextFreeBoneId(template), rootName: template.rootName });
  const report: BikeConvertReport = {
    adoptedFromMod: [],
    droppedFromMod: [],
    missingInMod: [],
    parts: [],
    seats: resolveSeatPoints(analysis.model, analysis.relativeToRoot, shiftZ),
    shiftZ,
    shimmed: [],
  };

  emitPartsRig(
    emit,
    {
      bodyBoneId: template.chassisBoneId,
      bodyCanonical: 'chassis',
      bodyLocal: template.chassisLocal,
      bodyName: template.chassisName,
      parts: template.parts,
    },
    analysis,
    shiftZ,
    report,
  );
  emit.frames[1].hierarchy = buildHierarchy(emit.frames);
  collectDropped(emit, analysis.model, report);
  finalizeAtomics(emit, analysis.model.version);

  const dff = writeClump({
    atomics: emit.atomics,
    frames: emit.frames,
    geometries: emit.geometries,
    version: analysis.model.version,
  });

  return { dff, report };
}

/** `shift = (tplWheelRearZ − tplRadius) − (modWheelRearZ − modRadius)` — both ground planes meet.
 *  The mod wheel mesh is the first atomic in the matched `wheel_rear` subtree (the MTB ships the mesh
 *  as a `wheel_pj=0-2c` child of the dummy). */
function groundShift(modDff: Uint8Array, template: CsBikeTemplate, analysis: PartsRigAnalysis): number {
  const wheelRearIndex = matchPart(analysis.model, analysis.atomicByFrame, 'wheel_rear');
  const wheelMesh = firstAtomicInSubtree(analysis.model, wheelRearIndex);
  if (wheelRearIndex < 0 || !wheelMesh) {
    throw new Error('mod has no wheel_rear mesh');
  }
  const parsed = parseDff(toArrayBuffer(modDff));
  const modRadius = geometryZHalfExtent(parsed.geometries[wheelMesh.geometryIndex]);
  const templateGround = template.groundZ - template.wheelRadius;
  const rear = analysis.relativeToRoot(wheelRearIndex);

  return templateGround - (rear.position[2] - modRadius);
}

/** One past the template's highest bone id — where shim + adopted bones' fresh ids start. */
function nextFreeBoneId(template: CsBikeTemplate): number {
  let max = template.chassisBoneId;
  for (const part of template.parts.values()) {
    max = Math.max(max, part.boneId);
  }

  return max + 1;
}
