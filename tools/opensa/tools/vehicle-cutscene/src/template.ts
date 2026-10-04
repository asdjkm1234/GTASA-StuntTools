import type { RWClump, RWGeometry } from '@opensa/renderware/parsers/binary/types';

/**
 * The per-slot conversion TEMPLATE, read from the vanilla cutscene model at run time — never generated.
 * Bone ids, the root frame name, part frame names (`door_lf_hi_ok` vs `door_lf_ok`), wheel-node names
 * (`Box01` / `wheel_lf_node` / `axis_lf` / `wheelLFNode` / `dummywheel_rr`) and the vertical convention
 * are all hand-authored and inconsistent across the 23 vanilla models (001's research record + the
 * step-3 full-fleet run); the cutscene animations target exactly those bone ids, so the vanilla file is
 * the only honest source.
 *
 * Styles the extractor handles (all measured on the real fleet):
 *   - wheels as node+mesh pairs (bobcat's `Box01`→`wheel`) or as ONE mesh frame at the corner
 *     (bravura/glendale/sadler/washington);
 *   - the chassis directly under the skeleton root, or under an intermediate body frame
 *     (csmonster's `COG`, carried into the template);
 *   - parts NESTED under other parts (csfirela's `misc_c` under `misc_b`);
 *   - vanilla's own `winscreen_ok` typo (cssadler), canonicalised to `windscreen_ok`.
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { compose } from './rig/matrix';

/** The bike-branch template (plan 002 step 8): the vanilla bike rig has NO wheel corners — every part
 *  (wheel_rear, chainset, pedal_l/r, handlebars, forks_front, wheel_front) is a bone in the chassis
 *  subtree, so the template is the part map plus the rear-wheel ground reference. */
export interface CsBikeTemplate {
  chassisBoneId: number;
  /** The chassis frame's VANILLA local transform (relative to the skeleton root). */
  chassisLocal: { position: [number, number, number]; rotation: number[] };
  chassisName: string;
  /** `wheel_rear`'s z in skeleton-root space — one side of the ground-plane formula. */
  groundZ: number;
  /** Canonical part name → template info, in the template's DFS order (= vanilla bone-id order). */
  parts: Map<string, CsPartTemplate>;
  rootName: string;
  /** Vanilla wheel radius: the `wheel_rear` mesh geometry's z half-extent. */
  wheelRadius: number;
}

/** The boat-branch template (plan 002 step 9): body `boat_hi` under the root, transom flaps as parts.
 *  No ground/waterline formula — the donor's own placement is the gameplay-correct one, and no stock
 *  scene plays csdinghy to anchor anything else. */
export interface CsBoatTemplate {
  bodyBoneId: number;
  /** The `boat_hi` frame's VANILLA local transform (relative to the skeleton root). */
  bodyLocal: { position: [number, number, number]; rotation: number[] };
  bodyName: string;
  /** Canonical part name → template info, in the template's DFS order (= vanilla bone-id order). */
  parts: Map<string, CsPartTemplate>;
  rootName: string;
}

/** The intermediate body frame some templates put between the root and the chassis (csmonster's COG). */
export interface CsIntermediateTemplate {
  boneId: number;
  frameName: string;
  position: [number, number, number];
  rotation: number[];
}

export interface CsPartTemplate {
  boneId: number;
  /** The template's exact frame name (keeps the `_hi` spelling / vanilla typos where they exist). */
  frameName: string;
  /** Canonical name of the template parent (`chassis` for direct children; a part for nested ones). */
  parentCanonical: string;
  /** The VANILLA local transform — the anims' bind pose the emitted frame must carry (gate-4 lesson). */
  position: [number, number, number];
  rotation: number[];
}

export interface CsTemplate {
  chassisBoneId: number;
  /** The chassis frame's VANILLA local transform (relative to its body parent). */
  chassisLocal: { position: [number, number, number]; rotation: number[] };
  /** The template's chassis frame name (`chassis` on every vanilla style — kept for fidelity). */
  chassisName: string;
  /** Present when the chassis + wheels hang under an intermediate frame instead of the root. */
  intermediate?: CsIntermediateTemplate;
  /** Canonical part name → template info, in the template's DFS order (= vanilla bone-id order). */
  parts: Map<string, CsPartTemplate>;
  /** Skeleton root frame name (`bobcat_dummy` / `taxi` / `remingtn` / `Monster92` — per-car). */
  rootName: string;
  /** Vanilla wheel radius: the wheel mesh geometry's z half-extent (bobcat: 0.349, byte-equal to gta3). */
  wheelRadius: number;
  wheels: Map<WheelCorner, CsWheelTemplate>;
}

export interface CsWheelTemplate {
  meshBoneId: number;
  meshName: string;
  /** The wheel MESH frame position (usually 0; cscopcarla92 authors a -0.02 x). */
  meshPosition: [number, number, number];
  /** The wheel MESH frame rotation — identity on the right side, 180° about z on the left (measured). */
  meshRotation: number[];
  nodeBoneId: number;
  nodeName: string;
  /** The node's VANILLA position, relative to its body parent — emitted verbatim (the anims' pose). */
  nodePosition: [number, number, number];
  /** The node's z in SKELETON-ROOT space — one side of the ground-plane formula (plan 002 step 2a). */
  nodeZ: number;
  /** `pair` = node frame + mesh child; `single` = one mesh frame at the corner. */
  style: 'pair' | 'single';
}

/** Wheel corner key: `r`/`l` side + `f`/`b` end, matching the game rig's `wheel_<corner>_dummy` names. */
export type WheelCorner = 'lb' | 'lf' | 'rb' | 'rf';

/** Canonical part name: strip the taxi-style `_hi` segment, fix vanilla's `winscreen` typo (cssadler). */
export function canonicalPartName(name: string): string {
  return name.trim().toLowerCase().replace('_hi_', '_').replace('winscreen', 'windscreen');
}

/**
 * Extract the bike template from a vanilla cutscene DFF (csmtbike92 is the only stock bike slot).
 * Throws when the model is not a cutscene bike rig: no HAnim skeleton root, no chassis directly under
 * it, or no `wheel_rear` mesh (the ground-plane reference — a bike that cannot stand is an error).
 */
export function extractBikeTemplate(csDff: Uint8Array): CsBikeTemplate {
  const clump = parseDff(toArrayBuffer(csDff));
  const children = childrenByFrame(clump);
  const rootIndex = clump.frames.findIndex((frame) => frame.boneId === 0);
  if (rootIndex < 0) {
    throw new Error('cutscene template has no HAnim skeleton root (bone 0)');
  }
  const chassisIndex = clump.frames.findIndex((frame) => canonicalPartName(frame.name) === 'chassis');
  if (chassisIndex < 0 || clump.frames[chassisIndex].parentIndex !== rootIndex) {
    throw new Error('cutscene template has no chassis frame directly under the skeleton root');
  }

  const parts = extractParts(clump, children, chassisIndex, 'chassis');
  const wheelRear = parts.get('wheel_rear');
  if (!wheelRear) {
    throw new Error('cutscene template has no wheel_rear part');
  }
  const wheelRearIndex = clump.frames.findIndex((frame) => frame.name.trim() === wheelRear.frameName);
  const wheelAtomic = clump.atomics.find((atomic) => atomic.frameIndex === wheelRearIndex);
  if (!wheelAtomic) {
    throw new Error('cutscene template wheel_rear has no geometry');
  }
  const chassis = clump.frames[chassisIndex];
  // wheel_rear's transform in skeleton-root space, walking the real parent chain (vanilla nests it
  // directly under the chassis, but the formula must not assume that).
  let rearWorld = { position: [0, 0, 0] as [number, number, number], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const chain: number[] = [];
  for (let at = wheelRearIndex; at >= 0 && at !== rootIndex; at = clump.frames[at].parentIndex) {
    chain.unshift(at);
  }
  for (const at of chain) {
    rearWorld = compose(rearWorld, {
      position: [...clump.frames[at].position],
      rotation: [...clump.frames[at].rotation],
    });
  }

  return {
    chassisBoneId: requireBoneId(clump, chassisIndex),
    chassisLocal: { position: [...chassis.position], rotation: [...chassis.rotation] },
    chassisName: chassis.name.trim(),
    groundZ: rearWorld.position[2],
    parts,
    rootName: clump.frames[rootIndex].name.trim(),
    wheelRadius: geometryZHalfExtent(clump.geometries[wheelAtomic.geometryIndex]),
  };
}

/**
 * Extract the boat template from a vanilla cutscene DFF (csdinghy is the only stock boat slot).
 * Throws when the model is not a cutscene boat rig: no HAnim skeleton root, or no `boat_hi` frame
 * directly under it.
 */
export function extractBoatTemplate(csDff: Uint8Array): CsBoatTemplate {
  const clump = parseDff(toArrayBuffer(csDff));
  const children = childrenByFrame(clump);
  const rootIndex = clump.frames.findIndex((frame) => frame.boneId === 0);
  if (rootIndex < 0) {
    throw new Error('cutscene template has no HAnim skeleton root (bone 0)');
  }
  const bodyIndex = clump.frames.findIndex((frame) => canonicalPartName(frame.name) === 'boat_hi');
  if (bodyIndex < 0 || clump.frames[bodyIndex].parentIndex !== rootIndex) {
    throw new Error('cutscene template has no boat_hi frame directly under the skeleton root');
  }
  const body = clump.frames[bodyIndex];

  return {
    bodyBoneId: requireBoneId(clump, bodyIndex),
    bodyLocal: { position: [...body.position], rotation: [...body.rotation] },
    bodyName: body.name.trim(),
    parts: extractParts(clump, children, bodyIndex, 'boat_hi'),
    rootName: clump.frames[rootIndex].name.trim(),
  };
}

/**
 * Extract the car template from a vanilla cutscene DFF. Throws when the model is not a cutscene car rig
 * (no HAnim skeleton root, no chassis, or anything but four wheel corners).
 *
 * `animWheelPoses` (bone name, lowercased → the scene anim's frame-0 translation) overrides the BIND
 * positions for wheel corner classification and locals: the runtime replays the ANIM pose, and R*'s
 * own csglendale92 binds its left wheels crossed front-to-rear versus every scene (plan 004 round 16 —
 * each left wheel sat 0.21 m off its arch). Bind stays the fallback when no scene poses a bone.
 */
export function extractCarTemplate(
  csDff: Uint8Array,
  animWheelPoses?: ReadonlyMap<string, readonly [number, number, number]>,
): CsTemplate {
  const clump = parseDff(toArrayBuffer(csDff));
  const children = childrenByFrame(clump);
  const rootIndex = clump.frames.findIndex((frame) => frame.boneId === 0);
  if (rootIndex < 0) {
    throw new Error('cutscene template has no HAnim skeleton root (bone 0)');
  }

  const chassisIndex = clump.frames.findIndex((frame) => canonicalPartName(frame.name) === 'chassis');
  if (chassisIndex < 0) {
    throw new Error('cutscene template has no chassis frame');
  }
  const bodyParentIndex = clump.frames[chassisIndex].parentIndex;
  const wheels = extractWheels(clump, children, bodyParentIndex, chassisIndex, animWheelPoses);

  return {
    chassisBoneId: requireBoneId(clump, chassisIndex),
    chassisLocal: {
      position: [...clump.frames[chassisIndex].position],
      rotation: [...clump.frames[chassisIndex].rotation],
    },
    chassisName: clump.frames[chassisIndex].name.trim(),
    ...intermediateOf(clump, bodyParentIndex, rootIndex),
    parts: extractParts(clump, children, chassisIndex, 'chassis'),
    rootName: clump.frames[rootIndex].name.trim(),
    wheelRadius: wheelRadius(clump, wheels),
    wheels,
  };
}

/** A geometry's z half-extent — the wheel-radius measure both template and mod sides use. */
export function geometryZHalfExtent(geometry: RWGeometry): number {
  let min = Infinity;
  let max = -Infinity;
  for (let at = 2; at < geometry.positions.length; at += 3) {
    min = Math.min(min, geometry.positions[at]);
    max = Math.max(max, geometry.positions[at]);
  }

  return (max - min) / 2;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function childrenByFrame(clump: RWClump): number[][] {
  const children: number[][] = clump.frames.map(() => []);
  clump.frames.forEach((frame, index) => {
    if (frame.parentIndex >= 0) {
      children[frame.parentIndex].push(index);
    }
  });

  return children;
}

function cornerOf(position: readonly number[]): WheelCorner {
  return `${position[0] >= 0 ? 'r' : 'l'}${position[1] >= 0 ? 'f' : 'b'}`;
}

/** All descendant frames of the body, DFS in frame order — nested parts keep their template parent. */
function extractParts(
  clump: RWClump,
  children: readonly number[][],
  bodyIndex: number,
  bodyCanonical: string,
): Map<string, CsPartTemplate> {
  const parts = new Map<string, CsPartTemplate>();
  const visit = (index: number, parentCanonical: string): void => {
    for (const childIndex of children[index]) {
      const frame = clump.frames[childIndex];
      const canonical = canonicalPartName(frame.name);
      parts.set(canonical, {
        boneId: requireBoneId(clump, childIndex),
        frameName: frame.name.trim(),
        parentCanonical,
        position: [...frame.position],
        rotation: [...frame.rotation],
      });
      visit(childIndex, canonical);
    }
  };
  visit(bodyIndex, bodyCanonical);

  return parts;
}

function extractWheels(
  clump: RWClump,
  children: readonly number[][],
  bodyParentIndex: number,
  chassisIndex: number,
  animWheelPoses?: ReadonlyMap<string, readonly [number, number, number]>,
): Map<WheelCorner, CsWheelTemplate> {
  // Root-space z: the body parent is either the root (position 0) or the intermediate frame (COG's 1.20).
  const bodyParentZ = clump.frames[bodyParentIndex].position[2];
  const nodes: { nodeIndex: number; wheel: Omit<CsWheelTemplate, 'nodeZ'> }[] = [];
  for (const nodeIndex of children[bodyParentIndex]) {
    if (nodeIndex === chassisIndex) {
      continue;
    }
    const node = clump.frames[nodeIndex];
    const meshIndex = children[nodeIndex].find((index) => clump.atomics.some((atomic) => atomic.frameIndex === index));
    const wheel = meshIndex === undefined ? singleWheel(clump, nodeIndex) : pairWheel(clump, nodeIndex, meshIndex);
    if (!wheel) {
      throw new Error(`cutscene template wheel node '${node.name.trim()}' has no mesh`);
    }
    nodes.push({ nodeIndex, wheel });
  }
  // The ANIM pose is where the runtime puts a bone — corner and local follow it, not the bind
  // (csglendale92 binds its left wheels crossed front-to-rear, round 16). A pose only counts when
  // the four posed positions yield four DISTINCT corners: rigs nesting wheels under axle frames
  // (washington, savanna) animate the wheel channels near zero — those keep the bind.
  const posed = nodes.map(({ nodeIndex }) => animWheelPoses?.get(clump.frames[nodeIndex].name.trim().toLowerCase()));
  const posedCorners = new Set(posed.map((pose) => (pose ? cornerOf(pose) : undefined)));
  const usePoses = posed.every(Boolean) && posedCorners.size === 4;
  const wheels = new Map<WheelCorner, CsWheelTemplate>();
  nodes.forEach(({ nodeIndex, wheel }, at) => {
    const position: [number, number, number] = usePoses
      ? [posed[at]![0], posed[at]![1], posed[at]![2]]
      : clump.frames[nodeIndex].position;
    wheels.set(cornerOf(position), { ...wheel, nodePosition: position, nodeZ: bodyParentZ + position[2] });
  });
  if (wheels.size !== 4) {
    throw new Error(`cutscene template has ${wheels.size} wheel corner(s), expected 4`);
  }

  return wheels;
}

function intermediateOf(
  clump: RWClump,
  bodyParentIndex: number,
  rootIndex: number,
): { intermediate?: CsIntermediateTemplate } {
  if (bodyParentIndex === rootIndex) {
    return {};
  }
  const frame = clump.frames[bodyParentIndex];
  if (frame.parentIndex !== rootIndex) {
    throw new Error(`cutscene template body parent '${frame.name.trim()}' is not a direct child of the root`);
  }

  return {
    intermediate: {
      boneId: requireBoneId(clump, bodyParentIndex),
      frameName: frame.name.trim(),
      position: [...frame.position],
      rotation: [...frame.rotation],
    },
  };
}

function pairWheel(clump: RWClump, nodeIndex: number, meshIndex: number): Omit<CsWheelTemplate, 'nodeZ'> {
  const mesh = clump.frames[meshIndex];

  return {
    meshBoneId: requireBoneId(clump, meshIndex),
    meshName: mesh.name.trim(),
    meshPosition: [...mesh.position],
    meshRotation: [...mesh.rotation],
    nodeBoneId: requireBoneId(clump, nodeIndex),
    nodeName: clump.frames[nodeIndex].name.trim(),
    nodePosition: [...clump.frames[nodeIndex].position] as [number, number, number],
    style: 'pair',
  };
}

function requireBoneId(clump: RWClump, frameIndex: number): number {
  const boneId = clump.frames[frameIndex].boneId;
  if (boneId === undefined) {
    throw new Error(`cutscene template frame '${clump.frames[frameIndex].name.trim()}' has no HAnim bone id`);
  }

  return boneId;
}

function singleWheel(clump: RWClump, nodeIndex: number): null | Omit<CsWheelTemplate, 'nodeZ'> {
  if (!clump.atomics.some((atomic) => atomic.frameIndex === nodeIndex)) {
    return null;
  }
  const node = clump.frames[nodeIndex];
  const boneId = requireBoneId(clump, nodeIndex);

  return {
    meshBoneId: boneId,
    meshName: node.name.trim(),
    meshPosition: [0, 0, 0],
    meshRotation: [...node.rotation],
    nodeBoneId: boneId,
    nodeName: node.name.trim(),
    nodePosition: [...node.position] as [number, number, number],
    style: 'single',
  };
}

function wheelRadius(clump: RWClump, wheels: Map<WheelCorner, CsWheelTemplate>): number {
  const meshNames = new Set([...wheels.values()].map((wheel) => wheel.meshName));
  const meshIndex = clump.frames.findIndex((frame) => meshNames.has(frame.name.trim()));
  const atomic = clump.atomics.find((entry) => entry.frameIndex === meshIndex);
  if (!atomic) {
    throw new Error('cutscene template wheel mesh has no geometry');
  }

  return geometryZHalfExtent(clump.geometries[atomic.geometryIndex]);
}
