/**
 * Branch-agnostic emit machinery shared by the rig branches (car, bike, boat): the Emit accumulator,
 * vanilla-local bone emission with shim frames, atomic/geometry dedupe, hierarchy recomputation and
 * the adoption vocabulary — plus the shared "body + parts subtree" conversion the wheel-less branches
 * (bike, boat) are: one body bone under the skeleton root, template parts matched by canonical name,
 * everything else adopted. The emit model itself — vanilla locals as the anims' bind pose, un-animated
 * `_pv` shims absorbing the donor deltas, whole-shell adoption — is documented at the top of
 * `rig/car.ts`, where it was field-won (plan 002 gates 4 and 7).
 */
import { readRw, writeRw } from '@opensa/rw-codec/chunk';

import type { SeatPoint } from '../seats';

import { ensureModulateMaterialColour, geometryBodyHasWindowPane } from '../materials';
import { canonicalPartName, type CsPartTemplate } from '../template';
import { bakeGeometryBody, isIdentityDelta } from './bake';
import {
  type ClumpAtomic,
  type ClumpFrame,
  type ClumpModel,
  type HierarchyNode,
  type OpaqueChunk,
  readClump,
} from './clump-io';
import { compose, IDENTITY_ROTATION, invert, type Transform, transformPoint } from './matrix';
import { splitMixedAtomics } from './split';

/** Frame-list matrix-flags words, mirrored from every vanilla cutscene model. */
export const TOP_FRAME_FLAGS = 0x00020003;
export const FRAME_FLAGS = 0x00000003;
/** Mod meshes NEVER adopted: damage twins and LOD copies. Everything else the game renders in gameplay. */
export const ORPHAN_SKIP_RE = /_dam$|_vlo$/;
/** IVF-style VARIANT containers: the runtime plugin shows ONE variant per container. */
export const VARIANT_CONTAINER_RE = /^f_(?:extras|class)/;
/** Year-variant subtrees (`_[1991]:2`, with the mod's own `}` typo tolerated): ALTERNATIVES to base
 *  parts the rig already carries — never adopted at all (the taxi stacked three door sets). */
export const YEAR_VARIANT_RE = /\[\d{4}[\]}]/;
/** Shim frame name suffix — must never collide with an anim channel name (vanilla frame names). */
export const SHIM_SUFFIX = '_pv';
/** Rename suffix EVERY adopted frame gets. An adopted mesh is un-animated by definition, and anim
 *  binding is by NAME against a per-scene channel table that is unknowable at convert time — scenes
 *  even carry channels for frames NO vanilla model has (DESERT9 drives `windscreen_ok` on a rig
 *  without one; plan 004 round 2), and a duplicate of a bound name is NOT skipped as "second match":
 *  it binds too and double-transforms (round 1, the GMC's nested door-glass `door_lf_ok` floating
 *  midair). The only safe adopted name is an unbindable one; a renamed frame simply rides its
 *  parent. */
export const ADOPT_SUFFIX = '_ad';

export interface BoneSpec {
  boneId: number;
  /** The VANILLA local — what the anims replay. */
  local: { position: readonly number[]; rotation: readonly number[] };
  name: string;
  parentFrame: number;
  /** Where the bone must LAND (body-parent-relative world) — the donor's placement, ground-lifted. */
  targetWorld: Transform;
}

export interface ConvertReport {
  /** Visible mod parts the template has no slot for, carried with fresh bone ids (shell, glass, misc). */
  adoptedFromMod: string[];
  /** Mod meshes with no place in the template (damage twins, LOD copies, surplus variants). */
  droppedFromMod: string[];
  /** Template parts the mod does not ship — their bones drop out of the emitted hierarchy. */
  missingInMod: string[];
  /** Canonical names of the emitted template parts. */
  parts: string[];
  /** Where the DONOR says a person sits, in cutscene space (plan 005) — empty when it states nothing,
   *  which is the fallback: the scene's own authored placement then stands. */
  seats: SeatPoint[];
  /** The vertical rebase applied to the donor. */
  shiftZ: number;
  /** Bones that needed a shim frame (non-identity donor-vs-vanilla placement delta). */
  shimmed: string[];
}

export interface Emit {
  atomics: ClumpAtomic[];
  /** Dedupe map for derived geometry copies (the mirrored left wheel). */
  bakedGeometryIndex: Map<OpaqueChunk, number>;
  /** Frame index the parts hang off (the skeleton root, or the intermediate body frame). */
  bodyParentIndex: number;
  /** Source geometry indexes carried in ANY form (original or derived) — `collectDropped`'s ledger. */
  carriedSources: Set<number>;
  frames: ClumpFrame[];
  geometries: OpaqueChunk[];
  /** Fresh bone ids for shims + adopted parts, allocated past the template's. */
  nextBoneId: number;
  /** Dedupe map for source geometries. */
  sourceGeometryIndex: Map<number, number>;
  /** Root-space transform of each emitted frame (parallel to `frames`). */
  worlds: Transform[];
}

/** The mod-side analysis every "body + parts subtree" branch (bike, boat) shares. */
export interface PartsRigAnalysis {
  atomicByFrame: Map<number, ClumpAtomic>;
  bodyIndex: number;
  /** Frames inside non-chosen variant subtrees — never adopted (see `excludedVariantFrames`). */
  excludedVariants: ReadonlySet<number>;
  hingeOf: (frameIndex: number) => Transform;
  model: ClumpModel;
  relativeToRoot: (frameIndex: number) => Transform;
}

/** The template side of a "body + parts subtree" branch, in branch-neutral terms. */
export interface PartsRigTemplate {
  bodyBoneId: number;
  /** The body's canonical name (`chassis` on bikes, `boat_hi` on boats) — the part-map parent key. */
  bodyCanonical: string;
  bodyLocal: { position: readonly number[]; rotation: readonly number[] };
  bodyName: string;
  parts: ReadonlyMap<string, CsPartTemplate>;
}

/** An adopted frame's emitted name: the mod's own + {@link ADOPT_SUFFIX}, ALWAYS — no anim channel
 *  may ever bind an adopted mesh (see the suffix's comment for the two field rounds behind this). */
export function adoptedFrameName(name: string): string {
  return `${name}${ADOPT_SUFFIX}`;
}

/** Every remaining visible mod mesh rides its nearest CARRIED ancestor (a wheel mesh spins with its
 *  wheel bone; brake calipers ride the forks; a propeller rides its transom flap). */
export function adoptOrphans(
  emit: Emit,
  analysis: PartsRigAnalysis,
  shiftZ: number,
  fallbackFrame: number,
  carriedFrames: ReadonlyMap<number, number>,
  report: ConvertReport,
): void {
  for (const atomic of analysis.model.atomics) {
    const index = atomic.frameIndex;
    const canonical = canonicalPartName(analysis.model.frames[index].name);
    const skip =
      carriedFrames.has(index) ||
      ORPHAN_SKIP_RE.test(canonical) ||
      analysis.excludedVariants.has(index) ||
      inYearVariantSubtree(analysis.model, index);
    if (skip) {
      continue;
    }
    const parentFrame = nearestCarriedAncestor(analysis.model, carriedFrames, index) ?? fallbackFrame;
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

/** Read a mod clump and locate its body frame. Throws when the mod has no body frame at all. */
export function analyzePartsRig(modDff: Uint8Array, bodyCanonical: string): PartsRigAnalysis {
  const model = readClump(modDff);
  const atomicByFrame = new Map(model.atomics.map((atomic) => [atomic.frameIndex, atomic]));
  const relativeToRoot = worldTransforms(model);
  const bodyIndex = matchPart(model, atomicByFrame, bodyCanonical);
  if (bodyIndex < 0) {
    throw new Error(`mod has no ${bodyCanonical} frame`);
  }

  return {
    atomicByFrame,
    bodyIndex,
    excludedVariants: excludedVariantFrames(model),
    hingeOf: hingeFactory(model, relativeToRoot),
    model,
    relativeToRoot,
  };
}

/** DFS over the emitted tree; flags = (siblings follow ? 2 : 0) | (leaf ? 1 : 0) — the rule reproduced
 *  verbatim from all five vanilla cutscene rig styles (step-2 probe). */
export function buildHierarchy(frames: readonly ClumpFrame[]): HierarchyNode[] {
  const children: number[][] = frames.map(() => []);
  frames.forEach((frame, index) => {
    if (frame.parentIndex >= 0 && frames[frame.parentIndex].boneId !== undefined) {
      children[frame.parentIndex].push(index);
    }
  });
  const nodes: HierarchyNode[] = [];
  const visit = (index: number, siblingsFollow: boolean): void => {
    const kids = children[index];
    nodes.push({
      flags: (siblingsFollow ? 2 : 0) | (kids.length === 0 ? 1 : 0),
      id: frames[index].boneId!,
      index: nodes.length,
    });
    kids.forEach((kid, at) => visit(kid, at < kids.length - 1));
  };
  const skeletonRoot = frames.findIndex((frame) => frame.boneId === 0);
  visit(skeletonRoot, false);

  return nodes;
}

export function childrenByFrame(model: ClumpModel): number[][] {
  const children: number[][] = model.frames.map(() => []);
  model.frames.forEach((frame, index) => {
    if (frame.parentIndex >= 0) {
      children[frame.parentIndex].push(index);
    }
  });

  return children;
}

/** SA Pipeline Set atomic plugin (`0x253f2f3`) and its vehicle-pipeline id — on EVERY vanilla cs
 *  atomic (measured fleet-wide). A cutscene object is not a CVehicle, so nothing assigns the vehicle
 *  pipeline at load time the way it happens for gameplay cars — the plugin is the only carrier, and
 *  without it the mod's Reflection/Specular material plugins go unread (plan 004: the shine delta
 *  between a converted car and the same mod in gameplay). */
const RW_PIPELINE_SET = 0x253f2f3;
const VEHICLE_PIPELINE_ID = 0x53f2009a;

export function collectDropped(emit: Emit, model: ClumpModel, report: ConvertReport): void {
  for (const atomic of model.atomics) {
    if (!emit.carriedSources.has(atomic.geometryIndex)) {
      report.droppedFromMod.push(model.frames[atomic.frameIndex].name || `frame ${atomic.frameIndex}`);
    }
  }
}

/** Append an atomic; source geometries dedupe by index, derived copies (mirrored wheel) by identity. */
export function emitAtomic(
  emit: Emit,
  geometries: readonly OpaqueChunk[],
  source: ClumpAtomic,
  frameIndex: number,
  derived?: OpaqueChunk,
): void {
  let geometryIndex: number;
  if (derived) {
    // A derived copy NEVER aliases the source's dedupe slot — doing so handed the mirrored LEFT wheel
    // to the right side too (whichever side emitted first won; gate-7 "wheels splayed" round).
    const shared = emit.bakedGeometryIndex.get(derived);
    if (shared === undefined) {
      geometryIndex = emit.geometries.length;
      emit.geometries.push(derived);
      emit.bakedGeometryIndex.set(derived, geometryIndex);
    } else {
      geometryIndex = shared;
    }
    emit.carriedSources.add(source.geometryIndex);
  } else {
    const existing = emit.sourceGeometryIndex.get(source.geometryIndex);
    if (existing === undefined) {
      geometryIndex = emit.geometries.length;
      emit.geometries.push(geometries[source.geometryIndex]);
      emit.sourceGeometryIndex.set(source.geometryIndex, geometryIndex);
    } else {
      geometryIndex = existing;
    }
    emit.carriedSources.add(source.geometryIndex);
  }
  emit.atomics.push({ extension: source.extension, flags: source.flags, frameIndex, geometryIndex });
}

/**
 * Emit an anim-targeted bone: the VANILLA local (what the anims replay), with an un-animated SHIM frame
 * absorbing the donor's POSITION delta when the target placement differs. Returns the bone's frame index.
 *
 * The shim is TRANSLATION-ONLY (plan 004 round 15, HEIST8A): the runtime rewrites every frame's
 * rotation each tick — an animated frame gets the anim quaternion, an un-animated one gets IDENTITY
 * (`FrameUpdateCallBackNonSkinned` zero-sums the quat and `CQuaternion::Normalise` turns zero into
 * identity; only `FramePos`, the position snapshot, survives). A rotation stored in a shim is
 * therefore silently erased in game — the securica stood on its tail while every offline view looked
 * right. The bone's world ROTATION ends up `parentRot ∘ vanillaLocalRot`; whatever rotation the
 * donor target still needed is the caller's to bake into the part's VERTICES ({@link emitTargetedAtomic}).
 */
export function emitBone(emit: Emit, spec: BoneSpec, report: ConvertReport): number {
  const local: Transform = { position: [...spec.local.position] as never, rotation: [...spec.local.rotation] };
  const parentInverse = invert(emit.worlds[spec.parentFrame]);
  const targetInParent = transformPoint(parentInverse, [...spec.targetWorld.position] as never);
  const shimPosition: [number, number, number] = [
    targetInParent[0] - local.position[0],
    targetInParent[1] - local.position[1],
    targetInParent[2] - local.position[2],
  ];
  let parentIndex = spec.parentFrame;
  if (!isIdentityDelta({ position: shimPosition, rotation: [...IDENTITY_ROTATION] })) {
    parentIndex = pushFrame(emit, {
      boneId: emit.nextBoneId++,
      name: `${spec.name}${SHIM_SUFFIX}`,
      parentIndex: spec.parentFrame,
      position: shimPosition,
      rotation: [...IDENTITY_ROTATION],
    });
    report.shimmed.push(spec.name);
  }

  return pushFrame(emit, {
    boneId: spec.boneId,
    name: spec.name,
    parentIndex,
    position: local.position,
    rotation: local.rotation,
  });
}

/** The body bone (+ its atomic when the mod ships one), the template parts in template order, then
 *  the adoption pass. The whole conversion of a wheel-less branch. */
export function emitPartsRig(
  emit: Emit,
  template: PartsRigTemplate,
  analysis: PartsRigAnalysis,
  shiftZ: number,
  report: ConvertReport,
): void {
  const bodyTarget = lift(analysis.hingeOf(analysis.bodyIndex), shiftZ);
  const bodyFrame = emitBone(
    emit,
    {
      boneId: template.bodyBoneId,
      local: template.bodyLocal,
      name: template.bodyName,
      parentFrame: emit.bodyParentIndex,
      targetWorld: bodyTarget,
    },
    report,
  );
  const bodyAtomic = analysis.atomicByFrame.get(analysis.bodyIndex);
  if (bodyAtomic) {
    emitTargetedAtomic(emit, analysis.model.geometries, bodyAtomic, bodyFrame, bodyTarget);
  }

  const emittedByCanonical = new Map<string, { frameIndex: number; modIndex: number }>([
    [template.bodyCanonical, { frameIndex: bodyFrame, modIndex: analysis.bodyIndex }],
  ]);
  for (const [canonical, part] of template.parts) {
    const modIndex = matchPart(analysis.model, analysis.atomicByFrame, canonical);
    const parent = emittedByCanonical.get(part.parentCanonical);
    if (modIndex < 0 || modIndex === analysis.bodyIndex || !parent) {
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
    const atomic = analysis.atomicByFrame.get(modIndex);
    if (atomic) {
      emitTargetedAtomic(emit, analysis.model.geometries, atomic, frameIndex, partTarget);
    }
    emittedByCanonical.set(canonical, { frameIndex, modIndex });
    report.parts.push(canonical);
  }
  adoptOrphans(
    emit,
    analysis,
    shiftZ,
    bodyFrame,
    new Map([...emittedByCanonical.values()].map((entry) => [entry.modIndex, entry.frameIndex])),
    report,
  );
}

/**
 * Attach a part's atomic to its emitted bone, baking into the VERTICES whatever rotation the bone's
 * runtime world cannot carry (see {@link emitBone}): residual = inv(boneWorld) ∘ targetWorld — pure
 * rotation about the part's own hinge (positions match by the shim's construction). Identity residual
 * keeps the geometry byte-verbatim (the fast path every translation-only car stays on).
 */
export function emitTargetedAtomic(
  emit: Emit,
  geometries: readonly OpaqueChunk[],
  atomic: ClumpAtomic,
  frameIndex: number,
  targetWorld: Transform,
): void {
  const residual = compose(invert(emit.worlds[frameIndex]), targetWorld);
  emitAtomic(
    emit,
    geometries,
    atomic,
    frameIndex,
    isIdentityDelta(residual) ? undefined : bakeGeometryBody(geometries[atomic.geometryIndex], residual),
  );
}

/** The nameless top frame + the skeleton root (+ the intermediate body frame when the template has one). */
export function emptyEmit(shape: {
  intermediate?: { boneId: number; frameName: string; position: [number, number, number]; rotation: number[] };
  nextBoneId: number;
  rootName: string;
}): Emit {
  const emit: Emit = {
    atomics: [],
    bakedGeometryIndex: new Map(),
    bodyParentIndex: 1,
    carriedSources: new Set(),
    frames: [],
    geometries: [],
    nextBoneId: shape.nextBoneId,
    sourceGeometryIndex: new Map(),
    worlds: [],
  };
  pushFrame(emit, {
    flags: TOP_FRAME_FLAGS,
    name: '',
    parentIndex: -1,
    position: [0, 0, 0],
    rotation: [...IDENTITY_ROTATION],
  });
  pushFrame(emit, {
    boneId: 0,
    name: shape.rootName,
    parentIndex: 0,
    position: [0, 0, 0],
    rotation: [...IDENTITY_ROTATION],
  });
  if (shape.intermediate) {
    emit.bodyParentIndex = pushFrame(emit, {
      boneId: shape.intermediate.boneId,
      name: shape.intermediate.frameName,
      parentIndex: 1,
      position: [...shape.intermediate.position],
      rotation: [...shape.intermediate.rotation],
    });
  }

  return emit;
}

/**
 * Frames excluded by the variant-container policy of the wheel-less branches: inside an
 * `f_extras`/`f_class` container (name not ending `+`), the first direct child subtree containing a
 * mesh is CHOSEN and every later child subtree is excluded. `+` containers are additive — nothing
 * excluded. Containers with no meshed child (the MTB's `f_class:1` switch groups) exclude nothing.
 * (The car branch keeps its own field-frozen one-mesh rule — gates 4+7.)
 */
export function excludedVariantFrames(model: ClumpModel): Set<number> {
  const children = childrenByFrame(model);
  const atomicFrames = new Set(model.atomics.map((atomic) => atomic.frameIndex));
  const subtreeHasMesh = (index: number): boolean =>
    atomicFrames.has(index) || children[index].some((child) => subtreeHasMesh(child));
  const excludeSubtree = (index: number, excluded: Set<number>): void => {
    excluded.add(index);
    for (const child of children[index]) {
      excludeSubtree(child, excluded);
    }
  };

  const excluded = new Set<number>();
  model.frames.forEach((frame, index) => {
    const name = frame.name.trim().toLowerCase();
    if (!VARIANT_CONTAINER_RE.test(name) || name.endsWith('+')) {
      return;
    }
    let chosen = false;
    for (const child of children[index]) {
      if (chosen) {
        excludeSubtree(child, excluded);
      } else if (subtreeHasMesh(child)) {
        chosen = true;
      }
    }
  });

  return excluded;
}

/**
 * The shared final pass over the emitted atomic list, run by all three branches before writeClump:
 *  1. window-pane atomics move LAST (stable partition) — vanilla's own layout (windscreen_ok is the
 *     final atomic of every vanilla car): the cutscene path renders clump atomics in file order with
 *     z-write on, so a pane emitted before the interior erases everything behind it (BCESAR5, the
 *     see-through-the-car windscreen);
 *  2. every NON-PANE atomic's Extension gains the vehicle Pipeline Set plugin when missing, like
 *     vanilla — lamp lenses and decals included, which is how GAMEPLAY renders them. Only window
 *     PANES keep the default pipeline: stamped panes vanished at any alpha (rounds 5–8), so that
 *     exception is real and stays. Round 9 briefly widened it to every translucent atomic after the
 *     burrito's 210-alpha tail lenses vanished — but what that measured was OUR DFF PipelineSet
 *     stamp, not the runtime `CustomCarPipeAtomicSetup` (plan 001 step 4 found the two are not the
 *     same thing), and it cost the whole fleet its lamp shine for two days. Round 23 put the lenses
 *     back and the field passed 14 scenes covering all 21 affected models, the burrito's and the
 *     sabre's tail lamps visibly repaired.
 *
 * Before either pass, MIXED geometries (opaque paint + embedded panes/lenses in one mesh) split into
 * an opaque copy and a translucent twin (see `split.ts`) — the sabre's in-door glass cost the whole
 * painted door its pipeline and dragged it into the pane block (FINAL2B round 14).
 */
export function finalizeAtomics(emit: Emit, version: number, suppressWindowPanes = false): void {
  splitMixedAtomics(emit.geometries, emit.atomics);
  // A translucent geometry must say it modulates by material colour, or RW's default pipeline — the one
  // cutscene translucents render on — never reads the material alpha at all (see materials.ts).
  for (const geometry of emit.geometries) {
    ensureModulateMaterialColour(geometry.body);
  }
  const panes = new Map(emit.geometries.map((geometry, index) => [index, geometryBodyHasWindowPane(geometry.body)]));
  // Window-pane suppression (plan 004 round 17, `docs/hacks/retired/cutscene-window-pane-suppression.md`):
  // on a suppressed SLOT the whole window class drops — after the split it is exactly the pane
  // atomics, so lamp lenses and every opaque copy stay. The pane geometries stay in the list as
  // unreferenced entries (a few KB) — pruning would renumber every atomic for no visible gain.
  emit.atomics = suppressWindowPanes
    ? emit.atomics.filter((atomic) => !panes.get(atomic.geometryIndex))
    : [
        ...emit.atomics.filter((atomic) => !panes.get(atomic.geometryIndex)),
        ...emit.atomics.filter((atomic) => panes.get(atomic.geometryIndex)),
      ];
  for (const atomic of emit.atomics) {
    if (!panes.get(atomic.geometryIndex)) {
      atomic.extension = withVehiclePipeline(atomic.extension, version);
    }
  }
}

/** First atomic (in atomic order) whose frame sits in the given frame's subtree, if any. */
export function firstAtomicInSubtree(model: ClumpModel, rootIndex: number): ClumpAtomic | undefined {
  if (rootIndex < 0) {
    return undefined;
  }
  const inSubtree = (index: number): boolean => {
    for (let at = index; at >= 0; at = model.frames[at].parentIndex) {
      if (at === rootIndex) {
        return true;
      }
    }

    return false;
  };

  return model.atomics.find((atomic) => inSubtree(atomic.frameIndex));
}

/** The space a frame's GEOMETRY is authored in: the dummy's for a `<part>_ok/_dam` under its own dummy
 *  (the game destroys that junk — `PreprocessHierarchy`/`CollapseFramesCB`), the frame's own full world
 *  otherwise (stock copcarla's junk-space chassis KEEPS its transform; gate-4 rounds 1+3). */
export function hingeFactory(
  model: ClumpModel,
  relativeToRoot: (frameIndex: number) => Transform,
): (frameIndex: number) => Transform {
  return (frameIndex: number): Transform => {
    const frame = model.frames[frameIndex];
    const parentIndex = frame.parentIndex;
    const parentName = parentIndex >= 0 ? model.frames[parentIndex].name.trim().toLowerCase() : '';
    const name = frame.name.trim().toLowerCase();
    const isComponent = /_(?:ok|dam)$/.test(name);
    const base = name.replace(/_(?:ok|dam)$/, '');

    return isComponent && parentName === `${base}_dummy` ? relativeToRoot(parentIndex) : relativeToRoot(frameIndex);
  };
}

/** Whether the frame (or an ancestor) carries a year-variant tag — an alternative part set. */
export function inYearVariantSubtree(model: ClumpModel, frameIndex: number): boolean {
  for (let at = frameIndex; at >= 0; at = model.frames[at].parentIndex) {
    if (YEAR_VARIANT_RE.test(model.frames[at].name)) {
      return true;
    }
  }

  return false;
}

/** The donor transform lifted onto the template's ground plane. */
export function lift(transform: Transform, shiftZ: number): Transform {
  return {
    position: [transform.position[0], transform.position[1], transform.position[2] + shiftZ],
    rotation: transform.rotation,
  };
}

/** The mod frame for a template part: canonical name match, mesh-bearing frames preferred (the corpus
 *  ships both shapes — stock parts ARE meshes, the MTB mod's are dummies over mesh kids). */
export function matchPart(
  model: ClumpModel,
  atomicByFrame: ReadonlyMap<number, ClumpAtomic>,
  canonical: string,
): number {
  const meshed = model.frames.findIndex(
    (frame, index) => canonicalPartName(frame.name) === canonical && atomicByFrame.has(index),
  );
  if (meshed >= 0) {
    return meshed;
  }

  return model.frames.findIndex((frame) => canonicalPartName(frame.name) === canonical);
}

/** The emitted frame of the closest carried (template-matched) ancestor of a mod frame, if any. */
export function nearestCarriedAncestor(
  model: ClumpModel,
  carriedFrames: ReadonlyMap<number, number>,
  frameIndex: number,
): number | undefined {
  for (let at = model.frames[frameIndex].parentIndex; at >= 0; at = model.frames[at].parentIndex) {
    const emitted = carriedFrames.get(at);
    if (emitted !== undefined) {
      return emitted;
    }
  }

  return undefined;
}

export function pushFrame(emit: Emit, frame: Omit<ClumpFrame, 'flags'> & { flags?: number }): number {
  const full: ClumpFrame = { flags: FRAME_FLAGS, ...frame };
  emit.frames.push(full);
  const parentWorld =
    full.parentIndex >= 0
      ? emit.worlds[full.parentIndex]
      : { position: [0, 0, 0] as [number, number, number], rotation: [...IDENTITY_ROTATION] };
  emit.worlds.push(compose(parentWorld, { position: full.position, rotation: full.rotation }));

  return emit.frames.length - 1;
}

/** The closest `f_extras`/`f_class` VARIANT container above (or at) a mod frame, or -1. */
export function variantContainerOf(model: ClumpModel, frameIndex: number): number {
  for (let at = frameIndex; at >= 0; at = model.frames[at].parentIndex) {
    if (VARIANT_CONTAINER_RE.test(model.frames[at].name.trim().toLowerCase())) {
      return at;
    }
  }

  return -1;
}

/** Memoized frame transforms relative to the mod's root frame (the root's own transform excluded). */
export function worldTransforms(model: ClumpModel): (frameIndex: number) => Transform {
  const rootIndex = model.frames.findIndex((frame) => frame.parentIndex < 0);
  const memo = new Map<number, Transform>();
  const resolve = (index: number): Transform => {
    if (index === rootIndex || index < 0) {
      return { position: [0, 0, 0], rotation: [...IDENTITY_ROTATION] };
    }
    let transform = memo.get(index);
    if (!transform) {
      const frame = model.frames[index];
      transform = compose(resolve(frame.parentIndex), { position: frame.position, rotation: frame.rotation });
      memo.set(index, transform);
    }

    return transform;
  };

  return resolve;
}

function withVehiclePipeline(extension: null | OpaqueChunk, version: number): OpaqueChunk {
  const chunks = extension ? readRw(extension.body).chunks : [];
  if (chunks.some((chunk) => chunk.type === RW_PIPELINE_SET)) {
    return extension!;
  }
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, VEHICLE_PIPELINE_ID, true);
  chunks.push({ data: payload, type: RW_PIPELINE_SET, version: extension?.version ?? version });

  return {
    body: writeRw({ chunks, trailing: new Uint8Array(0) }),
    version: extension?.version ?? version,
  };
}
