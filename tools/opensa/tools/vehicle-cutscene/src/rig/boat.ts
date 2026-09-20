/**
 * The boat branch (plan 002 step 9, csdinghy): the shared "body + parts subtree" pass (`rig/emit.ts`)
 * with the boat vocabulary — body `boat_hi` (bone 1) under the root, transom flaps
 * `boat_rearflap_right/left` (bones 2/3) as parts. The mod's propellers (`moving_prop*`/`static_prop*`),
 * steering (`movsteer*`) and detail meshes adopt under their nearest carried ancestor — a propeller
 * rides its flap, exactly like the donor authors it.
 *
 * No vertical shift: cars/bikes align ground planes because the anims put the root at ground level and
 * the wheels must touch; a boat has no wheel radius to anchor, NO stock scene plays csdinghy at all
 * (001 research + the 148-IFP scan of step 8), and the donor's own placement is the gameplay-correct
 * hull. The stock golden pair validates this: donor and vanilla author identical frame positions.
 */
import { type CsBoatTemplate } from '../template';
import { writeClump } from './clump-io';
import {
  analyzePartsRig,
  buildHierarchy,
  collectDropped,
  type ConvertReport,
  emitPartsRig,
  emptyEmit,
  finalizeAtomics,
} from './emit';

export type BoatConvertReport = ConvertReport;

/** Convert one mod boat DFF into its cutscene counterpart. Throws when the mod has no boat_hi frame —
 *  a boat without a hull is an error, not a silent skip. */
export function convertBoat(
  modDff: Uint8Array,
  template: CsBoatTemplate,
): { dff: Uint8Array; report: BoatConvertReport } {
  const analysis = analyzePartsRig(modDff, 'boat_hi');
  const emit = emptyEmit({ nextBoneId: nextFreeBoneId(template), rootName: template.rootName });
  const report: BoatConvertReport = {
    adoptedFromMod: [],
    droppedFromMod: [],
    missingInMod: [],
    parts: [],
    seats: [],
    shiftZ: 0,
    shimmed: [],
  };

  emitPartsRig(
    emit,
    {
      bodyBoneId: template.bodyBoneId,
      bodyCanonical: 'boat_hi',
      bodyLocal: template.bodyLocal,
      bodyName: template.bodyName,
      parts: template.parts,
    },
    analysis,
    0,
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

/** One past the template's highest bone id — where shim + adopted bones' fresh ids start. */
function nextFreeBoneId(template: CsBoatTemplate): number {
  let max = template.bodyBoneId;
  for (const part of template.parts.values()) {
    max = Math.max(max, part.boneId);
  }

  return max + 1;
}
