/**
 * The car branch: a mod's gameplay DFF → its cutscene counterpart, shaped by the vanilla template.
 *
 * THE EMIT MODEL (v3, after gate 7's door/wheelbase round, 2026-08-12): cutscene animations bind by
 * frame NAME (`CAnimBlendAssociation`, gta-reversed `CCutsceneMgr`) and drive every animated bone's
 * LOCAL — relative to its PARENT — to the vanilla model's values. So each template-matched bone keeps
 * the VANILLA local (the anims' bind pose), and the donor's differing placement is absorbed by an
 * un-animated SHIM frame inserted between the bone and its parent: `shim = inv(W_parent) ∘ shift_z ∘
 * W_donor ∘ inv(L_vanilla)`. The anim then swings a door around the MOD's hinge (the shim moved the
 * pivot), wheels stand on the MOD's corners including the wheelbase, and geometry is carried UNBAKED —
 * closed pose AND animated pose are both exact, which the earlier vertex-bake could not do (a door
 * opened around the vanilla hinge with a baked mesh detached by the hinge delta — the gate-7 field
 * round). Stock donors yield identity shims, i.e. none at all.
 *
 * Still true from the earlier rounds:
 *   - part set = template ∩ mod by canonical name — EXCEPT `extra*`, never matched (the '92 extras
 *     are scene furniture the anims pose; a mod's spawn variants are unrelated — plan 004 round 2) —
 *     and every other visible mod mesh is ADOPTED under its nearest carried ancestor (fresh bone ids,
 *     RENAMED `_ad` so no scene channel can bind it — plan 004 rounds 1–2) — only `_dam`/`_vlo` and
 *     f_wheel variant containers stay out, the chosen selector path per `f_extras`/`f_class`
 *     container (VehFuncs-style `<name>:K` groups — see chosenVariantFrames; plan 004 round 11) and
 *     ONE `extra*` per model;
 *   - a `<part>_ok/_dam` frame under its own dummy carries junk the game destroys — the hinge is the
 *     dummy; every OTHER mesh frame (stock copcarla's junk-space chassis) keeps its transform;
 *   - LEFT wheels on identity-rotation templates (cscopcarla/cstaxi92 style) get a MIRRORED geometry
 *     copy (x flipped, triangles rewound) — the shared unmirrored wheel showed its inner barrel
 *     outward; z-180 templates (bobcat style) mirror through their own bind rotation;
 *   - `shift = (tplNodeZ − tplRadius) − (modDummyZ − modRadius)` aligns the donor's ground plane.
 *
 * The branch-agnostic emit machinery lives in `rig/emit.ts` (shared with the bike branch).
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { resolveSeatPoints } from '../seats';
import { canonicalPartName, type CsTemplate, geometryZHalfExtent, toArrayBuffer, type WheelCorner } from '../template';
import { mirrorGeometryBodyX } from './bake';
import { type ClumpAtomic, type ClumpModel, type OpaqueChunk, readClump, writeClump } from './clump-io';
import {
  adoptedFrameName,
  buildHierarchy,
  childrenByFrame,
  collectDropped,
  type ConvertReport,
  type Emit,
  emitAtomic,
  emitBone,
  emitTargetedAtomic,
  emptyEmit,
  finalizeAtomics,
  hingeFactory,
  inYearVariantSubtree,
  lift,
  nearestCarriedAncestor,
  ORPHAN_SKIP_RE,
  pushFrame,
  VARIANT_CONTAINER_RE,
  variantContainerOf,
  worldTransforms,
  YEAR_VARIANT_RE,
} from './emit';
import { IDENTITY_ROTATION, invert, type Transform, transformPoint } from './matrix';

/** The game rig's wheel dummies (mirrors `build-vehicle-model.ts`'s WHEEL_DUMMY_RE; `m` = 3-axle middles,
 *  which no cutscene template has — they land in `droppedFromMod`). */
const WHEEL_DUMMY_RE = /^wheel_([lr])([fmb])_dummy$/;
/** `f_wheel_<mask>` container frames — the IVF-style wheel sub-model some real mods ship (mirrors the
 *  engine builder's WHEEL_CONTAINER_RE + first-atomic pick). Takes precedence over a dummy-child mesh:
 *  when both exist the dummy child is the stock fallback VehFuncs replaces (FINAL2B round 13). */
const WHEEL_CONTAINER_RE = /^f_wheel/;
/** SA's mutually-exclusive spawn variants: never template-matched (the '92 extras are hand-authored
 *  SCENE FURNITURE the anims pose — a mod's spawn variants are semantically unrelated; DESERT9 swung
 *  a whole GMC bed rack 50° through the air, plan 004 round 2), and adopted ONE like a variant
 *  container. The unbound scene channels are field-proven safe (zr350 shipped missing extras). */
const EXTRA_RE = /^extra\d+$/;

export type CarConvertReport = ConvertReport;

interface ModAnalysis {
  atomicByFrame: Map<number, ClumpAtomic>;
  chassisIndex: number;
  chassisTransform: Transform;
  /** Frames on the chosen path of every `f_extras`/`f_class` container — see chosenVariantFrames. */
  chosenVariants: ReadonlySet<number>;
  /** The space the frame's GEOMETRY is authored in: the dummy's for a `<part>_ok/_dam` under its own
   *  dummy (the game destroys that junk), the frame's own full world otherwise. */
  hingeOf: (frameIndex: number) => Transform;
  model: ClumpModel;
  /** frame transform relative to the mod's root frame. */
  relativeToRoot: (frameIndex: number) => Transform;
  /** The wheel's meshes — ONE for dummy-child/named wheels, the chosen tire+cap set for container
   *  wheels (the burrito's whole wheel is three meshes; one alone was a hollow tyre, round 11). */
  wheelAtomics: ClumpAtomic[];
  /** Frames inside `f_wheel_*` containers — never adopted as parts. */
  wheelContainerFrames: ReadonlySet<number>;
  wheelDummies: Map<WheelCorner, number>;
  /** Every frame inside a wheel dummy's subtree — wheel furniture, never adopted as a part. */
  wheelDummySubtreeFrames: ReadonlySet<number>;
  wheelMeshIndices: ReadonlySet<number>;
  wheelRadius: number;
}

/** Convert one mod car DFF into its cutscene counterpart. Throws when the mod has no usable chassis,
 *  wheel dummies or wheel mesh — a car that cannot stand is an error, not a silent skip.
 *  `suppressWindowPanes`: drop the window-glass class entirely (per-SLOT, plan 004 round 17 —
 *  `docs/hacks/retired/cutscene-window-pane-suppression.md`). */
export function convertCar(
  modDff: Uint8Array,
  template: CsTemplate,
  suppressWindowPanes = false,
): { dff: Uint8Array; report: CarConvertReport } {
  const analysis = analyzeMod(modDff, template);
  const shiftZ = groundShift(template, analysis);
  const emit = emptyEmit({
    intermediate: template.intermediate,
    nextBoneId: nextFreeBoneId(template),
    rootName: template.rootName,
  });
  const report: CarConvertReport = {
    adoptedFromMod: [],
    droppedFromMod: [],
    missingInMod: [],
    parts: [],
    seats: resolveSeatPoints(analysis.model, analysis.relativeToRoot, shiftZ),
    shiftZ,
    shimmed: [],
  };

  emitBody(emit, template, analysis, shiftZ, report);
  emit.frames[1].hierarchy = buildHierarchy(emit.frames);
  collectDropped(emit, analysis.model, report);
  finalizeAtomics(emit, analysis.model.version, suppressWindowPanes);

  const dff = writeClump({
    atomics: emit.atomics,
    frames: emit.frames,
    geometries: emit.geometries,
    version: analysis.model.version,
  });

  return { dff, report };
}

/** Carry every remaining mod mesh (the game renders them all in gameplay) as a child of its nearest
 *  CARRIED ancestor — door glass swings with its door; body/interior shells ride the chassis. */
function adoptOrphanParts(
  emit: Emit,
  analysis: ModAnalysis,
  shiftZ: number,
  chassisFrame: number,
  carriedFrames: ReadonlyMap<number, number>,
  report: CarConvertReport,
): void {
  let extraTaken = false;
  for (const atomic of analysis.model.atomics) {
    const index = atomic.frameIndex;
    const canonical = canonicalPartName(analysis.model.frames[index].name);
    const container = variantContainerOf(analysis.model, index);
    const skip =
      carriedFrames.has(index) ||
      analysis.wheelMeshIndices.has(index) ||
      analysis.wheelContainerFrames.has(index) ||
      // Anything under a wheel dummy is wheel furniture: when a f_wheel container won the pick, the
      // dummy-child fallback wheel must DROP, not ride the chassis as a static orphan (round 13).
      analysis.wheelDummySubtreeFrames.has(index) ||
      ORPHAN_SKIP_RE.test(canonical) ||
      // Outside a selector container a year subtree is an unadoptable ALTERNATIVE; inside one the
      // chosen path governs (the burrito's tail lamps live in version[1983]:1 — round 12).
      (container < 0 && inYearVariantSubtree(analysis.model, index));
    if (skip) {
      continue;
    }
    if (container >= 0 && !analysis.chosenVariants.has(index)) {
      continue; // not on the container's chosen path — see chosenVariantFrames
    }
    // `extra1..extraN` are SA's mutually-exclusive spawn variants (contracts §3): the game shows at
    // most ONE, so the conversion carries one — the GMC ships five whole-bed rack variants, and all
    // five stacked (plan 004 round 2). First by atomic order, like the containers above.
    if (EXTRA_RE.test(canonical)) {
      if (extraTaken) {
        continue;
      }
      extraTaken = true;
    }
    const parentFrame = nearestCarriedAncestor(analysis.model, carriedFrames, index) ?? chassisFrame;
    const target = lift(analysis.hingeOf(index), shiftZ);
    // Identity rotation like every un-animated frame (round 15) — the hinge rotation bakes into
    // the vertices via the residual in emitTargetedAtomic.
    const frameIndex = pushFrame(emit, {
      boneId: emit.nextBoneId++,
      name: adoptedFrameName(analysis.model.frames[index].name.trim()),
      parentIndex: parentFrame,
      position: transformPoint(invert(emit.worlds[parentFrame]), [...target.position] as never),
      rotation: [...IDENTITY_ROTATION],
    });
    emitTargetedAtomic(emit, analysis.model.geometries, atomic, frameIndex, target);
    report.adoptedFromMod.push(canonical);
  }
}

function analyzeMod(modDff: Uint8Array, template: CsTemplate): ModAnalysis {
  const model = readClump(modDff);
  const children = childrenByFrame(model);
  const atomicByFrame = new Map(model.atomics.map((atomic) => [atomic.frameIndex, atomic]));
  const relativeToRoot = worldTransforms(model);
  const hingeOf = hingeFactory(model, relativeToRoot);

  const chassisIndex = model.frames.findIndex(
    (frame, index) => canonicalPartName(frame.name) === 'chassis' && atomicByFrame.has(index),
  );
  if (chassisIndex < 0) {
    throw new Error('mod has no chassis mesh');
  }

  const wheelDummies = findWheelDummies(model, template);
  const wheelMeshIndices = findWheelMeshes(model, children, atomicByFrame, wheelDummies);
  const wheelAtomics = [...wheelMeshIndices].map((index) => atomicByFrame.get(index)!);
  const wheelDummySubtreeFrames = new Set<number>();
  const collectSubtree = (index: number): void => {
    wheelDummySubtreeFrames.add(index);
    for (const child of children[index]) {
      collectSubtree(child);
    }
  };
  for (const dummy of wheelDummies.values()) {
    collectSubtree(dummy);
  }
  const analysis = parseDff(toArrayBuffer(modDff));

  return {
    atomicByFrame,
    chassisIndex,
    chassisTransform: hingeOf(chassisIndex),
    chosenVariants: chosenVariantFrames(model, children, carriedCanonicalSet(template)),
    hingeOf,
    model,
    relativeToRoot,
    wheelAtomics,
    wheelContainerFrames: wheelContainerFrameSet(model),
    wheelDummies,
    wheelDummySubtreeFrames,
    wheelMeshIndices,
    wheelRadius: Math.max(
      ...wheelAtomics.map((atomic) => geometryZHalfExtent(analysis.geometries[atomic.geometryIndex])),
    ),
  };
}

/** The canonical part names the template will carry — the year-alternative guard's reference set. */
function carriedCanonicalSet(template: CsTemplate): Set<string> {
  return new Set(['chassis', ...template.parts.keys()]);
}

/**
 * The chosen path of every top-level `f_extras`/`f_class` variant container, VehFuncs-style (measured
 * on the burrito, plan 004 rounds 10–12): a `<name>:K` frame shows K of its children; a bare name
 * shows one. At every level the FIRST eligible child is taken in atomic order (`_dam`/`_vlo` children
 * never count) — that is the author's default: a leading meshless `no*` child (`nofogs`, `noadd`)
 * deliberately selects NOTHING from its group. A YEAR-bracketed child is an ordinary selector option
 * (the burrito's tail lamps + grille live ONLY in `version[1983/1985]:1` — dropping both years left
 * holes, round 12) — UNLESS its subtree re-offers a part the rig already carries (the taxi's
 * `_[1991]:2` door sets duplicate the matched base door): those are ALTERNATIVES, never picked.
 * `+` containers are additive: the whole subtree is chosen. Replaces the earlier
 * one-mesh-per-container rule, which starved multi-group containers (the burrito's rear-door
 * f_extras:4 lost its window to a logo).
 */
function chosenVariantFrames(
  model: ClumpModel,
  children: readonly number[][],
  carriedCanonicals: ReadonlySet<string>,
): Set<number> {
  const chosen = new Set<number>();
  model.frames.forEach((frame, index) => {
    const name = frame.name.trim().toLowerCase();
    const parent = frame.parentIndex;
    if (VARIANT_CONTAINER_RE.test(name) && (parent < 0 || variantContainerOf(model, parent) < 0)) {
      for (const picked of pickVariantPath(model, children, index, carriedCanonicals)) {
        chosen.add(picked);
      }
    }
  });

  return chosen;
}

/**
 * The game keys a component by its DUMMY, not the mesh child's name — a mod that misnames the child
 * still works in gameplay (the taxi ships `door_lr_ok` under `door_rr_dummy`). Mirror it: for a missing
 * `<base>_ok`, take the `<base>_dummy`'s `_ok`-suffixed mesh child, whatever it is called.
 */
function dummyChildFallback(analysis: ModAnalysis, canonical: string): number {
  if (!canonical.endsWith('_ok')) {
    return -1;
  }
  const dummyName = `${canonical.slice(0, -3)}_dummy`;
  const dummyIndex = analysis.model.frames.findIndex((frame) => frame.name.trim().toLowerCase() === dummyName);
  if (dummyIndex < 0) {
    return -1;
  }

  return analysis.model.frames.findIndex(
    (frame, index) =>
      frame.parentIndex === dummyIndex &&
      analysis.atomicByFrame.has(index) &&
      frame.name.trim().toLowerCase().endsWith('_ok'),
  );
}

/** Wheel nodes + chassis under the body parent, in template bone order (vanilla interleaves per style). */
function emitBody(
  emit: Emit,
  template: CsTemplate,
  analysis: ModAnalysis,
  shiftZ: number,
  report: CarConvertReport,
): void {
  const order: { boneId: number; corner?: WheelCorner }[] = [
    ...[...template.wheels.entries()].map(([corner, wheel]) => ({ boneId: wheel.nodeBoneId, corner })),
    { boneId: template.chassisBoneId },
  ];
  order.sort((a, b) => a.boneId - b.boneId);
  const mirrored = mirroredLeftWheel(template, analysis);
  for (const entry of order) {
    if (entry.corner) {
      emitWheel(emit, template, analysis, shiftZ, entry.corner, mirrored, report);
    } else {
      emitChassisAndParts(emit, template, analysis, shiftZ, report);
    }
  }
}

function emitChassisAndParts(
  emit: Emit,
  template: CsTemplate,
  analysis: ModAnalysis,
  shiftZ: number,
  report: CarConvertReport,
): void {
  const chassisTarget = lift(analysis.chassisTransform, shiftZ);
  const chassisFrame = emitBone(
    emit,
    {
      boneId: template.chassisBoneId,
      local: template.chassisLocal,
      name: template.chassisName,
      parentFrame: emit.bodyParentIndex,
      targetWorld: chassisTarget,
    },
    report,
  );
  emitTargetedAtomic(
    emit,
    analysis.model.geometries,
    analysis.atomicByFrame.get(analysis.chassisIndex)!,
    chassisFrame,
    chassisTarget,
  );

  const emittedByCanonical = new Map<string, { frameIndex: number; modIndex: number }>([
    ['chassis', { frameIndex: chassisFrame, modIndex: analysis.chassisIndex }],
  ]);
  for (const [canonical, part] of template.parts) {
    if (EXTRA_RE.test(canonical)) {
      report.missingInMod.push(canonical); // by policy — see EXTRA_RE; the bone drops out like a hole

      continue;
    }
    let modIndex = analysis.model.frames.findIndex(
      (frame, index) => canonicalPartName(frame.name) === canonical && analysis.atomicByFrame.has(index),
    );
    if (modIndex < 0) {
      modIndex = dummyChildFallback(analysis, canonical);
    }
    const parent = emittedByCanonical.get(part.parentCanonical);
    if (modIndex < 0 || modIndex === analysis.chassisIndex || !parent) {
      if (modIndex < 0 || !parent) {
        report.missingInMod.push(canonical);
      }
      continue;
    }
    const partTarget = lift(analysis.hingeOf(modIndex), shiftZ);
    const frameIndex = emitBone(
      emit,
      {
        boneId: part.boneId,
        local: { position: part.position, rotation: part.rotation },
        name: part.frameName,
        parentFrame: parent.frameIndex,
        targetWorld: partTarget,
      },
      report,
    );
    emitTargetedAtomic(emit, analysis.model.geometries, analysis.atomicByFrame.get(modIndex)!, frameIndex, partTarget);
    emittedByCanonical.set(canonical, { frameIndex, modIndex });
    report.parts.push(canonical);
  }
  const carriedFrames = new Map([...emittedByCanonical.values()].map((entry) => [entry.modIndex, entry.frameIndex]));
  // A matched part's DUMMY also maps to the part's bone: the game keys the component by its dummy, so
  // mods hang door-attached variants (the burrito's rear-door windows) under `door_*_dummy`, beside the
  // `_ok` mesh — without this they resolved to the chassis and stayed put while the door swung
  // (plan 004 round 10). The `_dam` children never adopt anyway (ORPHAN_SKIP_RE).
  for (const entry of emittedByCanonical.values()) {
    const parentIndex = analysis.model.frames[entry.modIndex]?.parentIndex ?? -1;
    if (
      parentIndex >= 0 &&
      analysis.model.frames[parentIndex].name.trim().toLowerCase().endsWith('_dummy') &&
      !carriedFrames.has(parentIndex)
    ) {
      carriedFrames.set(parentIndex, entry.frameIndex);
    }
  }
  adoptOrphanParts(emit, analysis, shiftZ, chassisFrame, carriedFrames, report);
}

/** Wheels: the node bone lands on the MOD's corner (shim absorbs track/wheelbase/height deltas), the
 *  mesh keeps the template's local. LEFT corners take the mirrored copy on identity-rotation templates. */
function emitWheel(
  emit: Emit,
  template: CsTemplate,
  analysis: ModAnalysis,
  shiftZ: number,
  corner: WheelCorner,
  mirrored: null | OpaqueChunk[],
  report: CarConvertReport,
): void {
  const wheel = template.wheels.get(corner)!;
  const dummyWorld = lift(analysis.relativeToRoot(analysis.wheelDummies.get(corner)!), shiftZ);
  const useMirror = corner.startsWith('l') && mirrored !== null;
  let meshIndex: number;
  if (wheel.style === 'single') {
    meshIndex = emitBone(
      emit,
      {
        boneId: wheel.meshBoneId,
        local: { position: wheel.nodePosition, rotation: wheel.meshRotation },
        name: wheel.meshName,
        parentFrame: emit.bodyParentIndex,
        targetWorld: { position: dummyWorld.position, rotation: [...wheel.meshRotation] },
      },
      report,
    );
  } else {
    const nodeIndex = emitBone(
      emit,
      {
        boneId: wheel.nodeBoneId,
        local: { position: wheel.nodePosition, rotation: IDENTITY_ROTATION },
        name: wheel.nodeName,
        parentFrame: emit.bodyParentIndex,
        targetWorld: dummyWorld,
      },
      report,
    );
    meshIndex = pushFrame(emit, {
      boneId: wheel.meshBoneId,
      name: wheel.meshName,
      parentIndex: nodeIndex,
      position: [...wheel.meshPosition],
      rotation: [...wheel.meshRotation],
    });
  }
  analysis.wheelAtomics.forEach((atomic, at) => {
    emitAtomic(emit, analysis.model.geometries, atomic, meshIndex, useMirror ? mirrored[at] : undefined);
  });
}

function findWheelDummies(model: ClumpModel, template: CsTemplate): Map<WheelCorner, number> {
  const dummies = new Map<WheelCorner, number>();
  model.frames.forEach((frame, index) => {
    const match = WHEEL_DUMMY_RE.exec(frame.name.trim().toLowerCase());
    if (match && match[2] !== 'm') {
      dummies.set(`${match[1]}${match[2]}` as WheelCorner, index);
    }
  });
  for (const corner of template.wheels.keys()) {
    if (!dummies.has(corner)) {
      throw new Error(`mod has no wheel_${corner}_dummy`);
    }
  }

  return dummies;
}

function findWheelMeshes(
  model: ClumpModel,
  children: readonly number[][],
  atomicByFrame: ReadonlyMap<number, ClumpAtomic>,
  wheelDummies: ReadonlyMap<WheelCorner, number>,
): Set<number> {
  // A `f_wheel_*` container WINS over a dummy-child mesh: when a mod ships both, the dummy child is
  // the stock fallback wheel VehFuncs replaces in gameplay (the bravura's is a bare brake disc —
  // picking it also sank the whole body via groundShift's radius, FINAL2B round 13).
  const container = wheelContainerMeshes(model, children, atomicByFrame);
  if (container.size > 0) {
    return container;
  }
  for (const dummyIndex of wheelDummies.values()) {
    const mesh = children[dummyIndex].find((index) => atomicByFrame.has(index));
    if (mesh !== undefined) {
      return new Set([mesh]);
    }
  }
  const named = model.frames.findIndex(
    (frame, index) => frame.name.trim().toLowerCase() === 'wheel' && atomicByFrame.has(index),
  );
  if (named >= 0) {
    return new Set([named]);
  }
  throw new Error('mod has no wheel mesh under its wheel dummies');
}

/** `shift = (tplNodeZ − tplRadius) − (modDummyZ − modRadius)` — both ground planes meet (plan 002/2a). */
function groundShift(template: CsTemplate, analysis: ModAnalysis): number {
  const corner: WheelCorner = template.wheels.has('rf') ? 'rf' : [...template.wheels.keys()][0];
  const templateGround = template.wheels.get(corner)!.nodeZ - template.wheelRadius;
  const dummy = analysis.relativeToRoot(analysis.wheelDummies.get(corner)!);

  return templateGround - (dummy.position[2] - analysis.wheelRadius);
}

/** Mirrored wheel copies for the LEFT side of identity-rotation templates: their anims replay identity
 *  (no z-180 mirror), so the shared wheel geometry showed its inner barrel outward (gate-7 field).
 *  One derived copy per wheel mesh, parallel to `wheelAtomics`. */
function mirroredLeftWheel(template: CsTemplate, analysis: ModAnalysis): null | OpaqueChunk[] {
  const leftHasFlip = [...template.wheels.entries()].some(
    ([corner, wheel]) => corner.startsWith('l') && wheel.meshRotation[0] < 0,
  );
  if (leftHasFlip) {
    return null; // bobcat-style: the bind rotation mirrors, and the anims replay it
  }

  return analysis.wheelAtomics.map((atomic) => mirrorGeometryBodyX(analysis.model.geometries[atomic.geometryIndex]));
}

/** One past the template's highest bone id — where shim + adopted bones' fresh ids start. */
function nextFreeBoneId(template: CsTemplate): number {
  let max = template.chassisBoneId;
  if (template.intermediate) {
    max = Math.max(max, template.intermediate.boneId);
  }
  for (const part of template.parts.values()) {
    max = Math.max(max, part.boneId);
  }
  for (const wheel of template.wheels.values()) {
    max = Math.max(max, wheel.meshBoneId, wheel.nodeBoneId);
  }

  return max + 1;
}

/** The chosen path from one selector root down — the `<name>:K` / first-eligible-child walk shared by
 *  the variant containers and the `f_wheel` wheel sub-model (see chosenVariantFrames). Inside f_wheel
 *  a year bracket is a wheel STYLE name (the taxi's `wheel[1992]`/`wheelFS[1991]`), not a year-variant
 *  subtree — `skipYearVariants: false` there. */
function pickVariantPath(
  model: ClumpModel,
  children: readonly number[][],
  rootIndex: number,
  carriedCanonicals: ReadonlySet<string>,
): Set<number> {
  const chosen = new Set<number>();
  const atomicFrames = new Set(model.atomics.map((atomic) => atomic.frameIndex));
  const frameName = (index: number): string => model.frames[index].name.trim().toLowerCase();
  const reoffersCarried = (index: number): boolean => {
    if (atomicFrames.has(index) && carriedCanonicals.has(canonicalPartName(frameName(index)))) {
      return true;
    }

    return children[index].some((child) => reoffersCarried(child));
  };
  const eligible = (index: number): boolean =>
    !ORPHAN_SKIP_RE.test(canonicalPartName(frameName(index))) &&
    (!YEAR_VARIANT_RE.test(frameName(index)) || !reoffersCarried(index));
  const pickAll = (index: number): void => {
    chosen.add(index);
    for (const child of children[index]) {
      pickAll(child);
    }
  };
  const pick = (index: number): void => {
    chosen.add(index);
    const name = frameName(index);
    if (name.endsWith('+')) {
      pickAll(index);

      return;
    }
    const match = /:(\d+)$/.exec(name);
    const count = match ? Number(match[1]) : 1;
    for (const child of children[index].filter(eligible).slice(0, count)) {
      pick(child);
    }
  };
  pick(rootIndex);

  return chosen;
}

/** `f_wheel_*` container frames plus every descendant. */
function wheelContainerFrameSet(model: ClumpModel): Set<number> {
  const containers = new Set<number>();
  model.frames.forEach((frame, index) => {
    if (WHEEL_CONTAINER_RE.test(frame.name.trim().toLowerCase())) {
      containers.add(index);
    }
  });
  if (containers.size === 0) {
    return containers;
  }
  model.frames.forEach((frame, index) => {
    for (let at = frame.parentIndex; at >= 0; at = model.frames[at].parentIndex) {
      if (containers.has(at)) {
        containers.add(index);
        break;
      }
    }
  });

  return containers;
}

/**
 * The whole wheel inside an `f_wheel_*` container: the chosen-path selection (see chosenVariantFrames)
 * applied at the container root — the burrito's wheel is tire mesh + cap mesh + cap-style mesh, and
 * adopting only the first atomic left a hollow tyre ring (plan 004 round 11).
 */
function wheelContainerMeshes(
  model: ClumpModel,
  children: readonly number[][],
  atomicByFrame: ReadonlyMap<number, ClumpAtomic>,
): Set<number> {
  const meshes = new Set<number>();
  model.frames.forEach((frame, index) => {
    if (!WHEEL_CONTAINER_RE.test(frame.name.trim().toLowerCase()) || meshes.size > 0) {
      return;
    }
    for (const chosen of pickVariantPath(model, children, index, new Set())) {
      if (atomicByFrame.has(chosen)) {
        meshes.add(chosen);
      }
    }
  });

  return meshes;
}
