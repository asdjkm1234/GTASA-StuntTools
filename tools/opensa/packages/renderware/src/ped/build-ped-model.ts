import type { IfpAnimation, RWClump, RWFrame, RWSkin } from '../index';

import { groupTrianglesByMaterial } from '../mesh/prepare-clump';
import { parseTxd } from '../parsers/binary/txd';
import { decodeDxt } from '../textures/dxt';

/**
 * A skinned character, built from a DFF + its TXDs into a plain, serializable struct — the ped twin of
 * `buildVehicleModel`/`VehicleModelData`.
 *
 * Renderer-agnostic and browser-callable BY DESIGN (plan 074/13 phase 4 + 074/14): the character viewer and
 * opensa-pack's ped conversion build the exact same thing, and this struct is what the ped `.osm` serializes.
 * Nothing here knows about GPU buffers, byte offsets or the engine.
 *
 * Coordinates stay native GTA (Z-up); the SA bind mesh lies along X and the skeleton stands it up, which
 * is why {@link PedModelData.minZ} is measured on the POSED mesh rather than the bind one.
 */

/** Local bind = frame transform; inverse bind = skin plugin (pad rows fixed). */
export interface PedBone {
  bindPosition: [number, number, number];
  bindRotation: [number, number, number, number];
  boneId: number;
  /** 16 floats, column-major. */
  inverseBind: number[];
  name: string;
  /** Skin-order index of the nearest ancestor that is also a skin bone; −1 for the root. */
  parent: number;
}

/** One animation, resolved against a model's bones — the shape `IfpSampler` consumes. */
export interface PedClip {
  duration: number;
  name: string;
  /** Per SKIN-ORDER bone; empty tracks mean "hold the bind pose". */
  tracks: { quats: number[]; times: number[] }[];
}

export interface PedModelData {
  /** Skin order; `parent` indexes this same array (−1 for the root). */
  bones: PedBone[];
  indices: Uint16Array;
  /** 4 bone indices per vertex. */
  joints: Uint8Array;
  /**
   * Lowest POSED vertex — the FEET level. Hosts align it to the physics capsule bottom so ANY player
   * model stands exactly on the surface, with no per-model lift constants.
   */
  minZ: number;
  name: string;
  normals: Float32Array;
  positions: Float32Array;
  submeshes: PedSubmesh[];
  textures: PedTexture[];
  uvs: Float32Array;
  /** unorm8, four per vertex, summing to exactly 255. */
  weights: Uint8Array;
}

export interface PedSubmesh {
  indexCount: number;
  indexOffset: number;
  texture: string;
}

export interface PedTexture {
  height: number;
  name: string;
  rgba: Uint8Array;
  width: number;
}

/** Seconds per raw ANP3 time unit. */
const IFP_TIME_SCALE = 1 / 60;

/**
 * A converted ped's `DESC` payload (opensa-pack 003 phase 5) — the twin of `VehicleFixture`.
 *
 * A ped is NOT a rigid model: it has no vertex colours, no `meta` paint/lamp slots and no reflection slots,
 * but it does carry four bone indices and four weights per vertex, a skeleton in SKIN ORDER with real
 * inverse binds, and a posed `minZ` the host stands it on. Sharing `VehicleFixture` would mean carrying
 * seven fields that are always empty and dropping the four that matter.
 *
 * `submeshes` address their texture as (array, layer) rather than by name: `TEXS` may hold several arrays
 * because a ped's textures can disagree on size, and resolving a name at spawn is work the converter has
 * already done. The NAME is kept alongside so a human (and a mod diff) can still read it.
 */
export interface PedFixture {
  bones: PedBone[];
  indexCount: number;
  layout: { indices: number; joints: number; normals: number; positions: number; uvs: number; weights: number };
  /** Lowest POSED vertex — the feet level the host aligns to the capsule bottom. */
  minZ: number;
  name: string;
  submeshes: PedFixtureSubmesh[];
  vertexCount: number;
}

export interface PedFixtureSubmesh {
  /** Index into the `TEXS` arrays. */
  array: number;
  indexCount: number;
  indexOffset: number;
  /** Layer within that array. */
  layer: number;
  /** The RW texture name, kept for readability — binding uses `array`/`layer`. */
  texture: string;
}

/** The authored root travel of an IFP clip, in ped-local metres (x right, y forward, z up). */
export interface RootMotionTrack {
  /** Track length in seconds (the last translated keyframe's time). */
  duration: number;
  /** x,y,z per keyframe, parallel to `times`. */
  positions: number[];
  /** Keyframe times in seconds, ascending. */
  times: number[];
}

interface SkinBone {
  frame: RWFrame;
  frameIndex: number;
  parent: number;
}

/**
 * @param txds raw TXD bytes, searched in order for the materials' textures.
 * @param poseWith an optional clip used to measure {@link PedModelData.minZ}; the bind pose otherwise.
 * @returns null when the clump carries no skin (i.e. it is not a character).
 */
export function buildPedModel(
  clump: RWClump,
  txds: readonly ArrayBuffer[],
  options: { name?: string; poseWith?: PedClip } = {},
): null | PedModelData {
  const geometry = clump.geometries.find((entry) => entry.skin);
  const skin = geometry?.skin;
  if (!geometry || !skin) {
    return null;
  }

  const vertexCount = geometry.positions.length / 3;
  const skinBones = skinOrderBones(clump, skin);
  const bones = skinBones.map((bone, skinIndex) => toBone(bone, skin, skinIndex));

  const indices: number[] = [];
  const submeshes: PedSubmesh[] = [];
  const usedTextures: string[] = [];
  groupTrianglesByMaterial(geometry.triangles, geometry.materials.length).forEach((tris, materialIndex) => {
    if (tris.length === 0) {
      return;
    }
    const texture = geometry.materials[materialIndex]?.texture?.name.toLowerCase() ?? '';
    if (texture && !usedTextures.includes(texture)) {
      usedTextures.push(texture);
    }
    submeshes.push({ indexCount: tris.length * 3, indexOffset: indices.length, texture });
    for (const tri of tris) {
      indices.push(tri.a, tri.b, tri.c);
    }
  });

  const data: PedModelData = {
    bones,
    indices: new Uint16Array(indices),
    joints: skin.boneIndices.slice(0, vertexCount * 4),
    minZ: 0, // needs the assembled bones — filled below
    name: options.name ?? '',
    normals: geometry.normals ?? computeNormals(geometry.positions, indices),
    positions: geometry.positions,
    submeshes,
    textures: decodeTextures(txds, usedTextures),
    uvs: geometry.uvLayers[0] ?? new Float32Array(vertexCount * 2),
    weights: quantizeWeights(skin.boneWeights, vertexCount),
  };
  data.minZ = posedMinZ(data, skin, options.poseWith);

  return data;
}

/**
 * Resolve IFP animations against a model's bones, matched by bone id first and trimmed name second
 * (prod matched by name alone — the id is the stronger signal when both exist).
 */
export function pedClip(animation: IfpAnimation, bones: readonly PedBone[]): PedClip {
  const byBoneId = new Map(animation.bones.map((bone) => [bone.boneId, bone]));
  const byBoneName = new Map(animation.bones.map((bone) => [bone.name.trim().toLowerCase(), bone]));
  let duration = 0;

  const tracks = bones.map((bone) => {
    const track = (bone.boneId >= 0 ? byBoneId.get(bone.boneId) : undefined) ?? byBoneName.get(bone.name.toLowerCase());
    if (!track || track.frames.length === 0) {
      return { quats: [], times: [] };
    }
    const times = track.frames.map((frame) => frame.time * IFP_TIME_SCALE);
    duration = Math.max(duration, times[times.length - 1]);

    return { quats: track.frames.flatMap((frame) => frame.rotation), times };
  });

  return { duration, name: animation.name, tracks };
}

/**
 * Extract a clip's ROOT translation track (plan 088/09a), or null when the clip carries none. The ped
 * pipeline deliberately drops root translation (locomotion is in-place — gameplay owns position), but
 * the vehicle enter/exit clips author the WHOLE body path in it (doorway dip, drop into the seat);
 * the enter system replays it so the climb stops looking like a constant-speed float. The first
 * translated bone track is the root by ANP3 convention (frame-type-4 tracks; `ped.ifp` has one).
 */
export function rootMotion(animation: IfpAnimation): null | RootMotionTrack {
  const track = animation.bones.find((bone) => bone.frames.some((frame) => frame.translation));
  if (!track) {
    return null;
  }
  const frames = track.frames.filter((frame) => frame.translation);
  const times = frames.map((frame) => frame.time * IFP_TIME_SCALE);
  const positions = frames.flatMap((frame) => frame.translation ?? [0, 0, 0]);

  return { duration: times[times.length - 1] ?? 0, positions, times };
}

/** Linearly sample a root-motion track at `time` (seconds), clamped to its ends. */
export function sampleRootMotion(track: RootMotionTrack, time: number): [number, number, number] {
  const { positions, times } = track;
  const last = times.length - 1;
  if (last < 0) {
    return [0, 0, 0];
  }
  if (time <= times[0]) {
    return [positions[0], positions[1], positions[2]];
  }
  if (time >= times[last]) {
    return [positions[last * 3], positions[last * 3 + 1], positions[last * 3 + 2]];
  }
  let high = 1;
  while (times[high] < time) {
    high += 1;
  }
  const low = high - 1;
  const t = (time - times[low]) / (times[high] - times[low] || 1);

  return [0, 1, 2].map((axis) => {
    const a = positions[low * 3 + axis];

    return a + (positions[high * 3 + axis] - a) * t;
  }) as [number, number, number];
}

/** Skinning palette for the bind pose (slot 0 = model matrix, bones from slot 1) — identity model. */
function bindPalette(bones: readonly PedBone[], clip?: PedClip): Float32Array {
  const palette = new Float32Array((1 + bones.length) * 16);
  palette.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
  const world: Float32Array[] = [];

  bones.forEach((bone, index) => {
    const rotation = firstFrameRotation(clip, index) ?? bone.bindRotation;
    const local = composeTrs(rotation, bone.bindPosition);
    const matrix = bone.parent >= 0 ? multiply(world[bone.parent], local) : local;
    world.push(matrix);
    palette.set(multiply(matrix, bone.inverseBind), (1 + index) * 16);
  });

  return palette;
}

/** T(position) × R(quat), column-major. */
function composeTrs(quat: readonly number[], position: readonly number[]): Float32Array {
  const [x, y, z, w] = quat;
  const out = new Float32Array(16);
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y + z * w);
  out[2] = 2 * (x * z - y * w);
  out[4] = 2 * (x * y - z * w);
  out[5] = 1 - 2 * (x * x + z * z);
  out[6] = 2 * (y * z + x * w);
  out[8] = 2 * (x * z + y * w);
  out[9] = 2 * (y * z - x * w);
  out[10] = 1 - 2 * (x * x + y * y);
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];
  out[15] = 1;

  return out;
}

/** Flat-shaded fallback normals for the rare ped geometry without stored normals. */
function computeNormals(positions: Float32Array, indices: readonly number[]): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let tri = 0; tri + 2 < indices.length; tri += 3) {
    const [a, b, c] = [indices[tri] * 3, indices[tri + 1] * 3, indices[tri + 2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const vertex of [a, b, c]) {
      normals[vertex] += nx;
      normals[vertex + 1] += ny;
      normals[vertex + 2] += nz;
    }
  }
  for (let vertex = 0; vertex < normals.length; vertex += 3) {
    const length = Math.hypot(normals[vertex], normals[vertex + 1], normals[vertex + 2]) || 1;
    normals[vertex] /= length;
    normals[vertex + 1] /= length;
    normals[vertex + 2] /= length;
  }

  return normals;
}

/** Decode the referenced textures to plain RGBA8 (no mips, no arrays — the ped path uploads one image). */
function decodeTextures(txds: readonly ArrayBuffer[], wanted: readonly string[]): PedTexture[] {
  const found = new Map<string, PedTexture>();

  for (const bytes of txds) {
    for (const texture of parseTxd(bytes).textures) {
      const name = texture.name.toLowerCase();
      if (!wanted.includes(name) || found.has(name)) {
        continue;
      }
      const base = texture.mipmaps[0];
      found.set(name, {
        height: base.height,
        name,
        rgba:
          texture.format === 'rgba8888'
            ? new Uint8Array(base.data)
            : decodeDxt(texture.format, base.data, base.width, base.height),
        width: base.width,
      });
    }
  }

  return wanted.map((name) => found.get(name)).filter((texture): texture is PedTexture => texture !== undefined);
}

function firstFrameRotation(clip: PedClip | undefined, bone: number): [number, number, number, number] | null {
  const track = clip?.tracks[bone];
  if (!track || track.quats.length < 4) {
    return null;
  }

  return [track.quats[0], track.quats[1], track.quats[2], track.quats[3]];
}

/** out = a × b, column-major. */
function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = sum;
    }
  }

  return out;
}

/**
 * The lowest vertex once the skeleton has stood the mesh up. Skinned by hand rather than through the
 * engine's sampler so this module stays renderer-free: bind pose only, which is what the feet level
 * needs (an idle clip's first frame differs by millimetres).
 */
function posedMinZ(data: PedModelData, skin: RWSkin, clip?: PedClip): number {
  const palette = bindPalette(data.bones, clip);
  const { positions } = data;
  let minZ = Infinity;

  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const px = positions[vertex * 3];
    const py = positions[vertex * 3 + 1];
    const pz = positions[vertex * 3 + 2];
    let z = 0;
    let weightSum = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = skin.boneWeights[vertex * 4 + slot];
      if (weight <= 0) {
        continue;
      }
      const m = (1 + skin.boneIndices[vertex * 4 + slot]) * 16;
      z += weight * (palette[m + 2] * px + palette[m + 6] * py + palette[m + 10] * pz + palette[m + 14]);
      weightSum += weight;
    }
    if (weightSum > 0.5) {
      minZ = Math.min(minZ, z / weightSum);
    }
  }

  return Number.isFinite(minZ) ? minZ : 0;
}

/** unorm8 weights, renormalized so each vertex's four sum to exactly 255 (largest gets the remainder). */
function quantizeWeights(weights: Float32Array, vertexCount: number): Uint8Array {
  const out = new Uint8Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const at = vertex * 4;
    const sum = weights[at] + weights[at + 1] + weights[at + 2] + weights[at + 3] || 1;
    let total = 0;
    let largest = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      out[at + slot] = Math.round((weights[at + slot] / sum) * 255);
      total += out[at + slot];
      if (out[at + slot] > out[at + largest]) {
        largest = slot;
      }
    }
    out[at + largest] += 255 - total;
  }

  return out;
}

/** RW row-major 3×3 (right/up/at as rows) → quaternion (x, y, z, w). */
function rowMajorRotationToQuat(rotation: readonly number[]): [number, number, number, number] {
  const m00 = rotation[0];
  const m01 = rotation[3];
  const m02 = rotation[6];
  const m10 = rotation[1];
  const m11 = rotation[4];
  const m12 = rotation[7];
  const m20 = rotation[2];
  const m21 = rotation[5];
  const m22 = rotation[8];
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);

    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);

    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);

    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);

  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

function skinOrderBones(clump: RWClump, skin: RWSkin): SkinBone[] {
  const hierarchy = clump.frames.find((frame) => frame.boneHierarchy)?.boneHierarchy;
  const frameIndexByBoneId = new Map<number, number>();
  clump.frames.forEach((frame, index) => {
    if (frame.boneId !== undefined) {
      frameIndexByBoneId.set(frame.boneId, index);
    }
  });
  const order: number[] = Array.from({ length: skin.numBones }, (_, boneIndex) =>
    hierarchy ? (frameIndexByBoneId.get(hierarchy[boneIndex]) ?? boneIndex + 1) : boneIndex + 1,
  );
  const skinIndexByFrame = new Map<number, number>();
  order.forEach((frameIndex, skinIndex) => skinIndexByFrame.set(frameIndex, skinIndex));

  return order.map((frameIndex) => {
    // Parent = the nearest ancestor frame that is itself a skin bone.
    let ancestor = clump.frames[frameIndex].parentIndex;
    while (ancestor >= 0 && !skinIndexByFrame.has(ancestor)) {
      ancestor = clump.frames[ancestor].parentIndex;
    }

    return {
      frame: clump.frames[frameIndex],
      frameIndex,
      parent: ancestor >= 0 ? (skinIndexByFrame.get(ancestor) ?? -1) : -1,
    };
  });
}

/**
 * Skin-order bones with their parents.
 *
 * The ROOT bone is ANCHORED to the skin-bind translation (prod `anchorRootBone`, plan 052): IFP root
 * translation is dropped (in-place locomotion) and standard SA frames put the root at the ORIGIN while
 * the skin bind holds the real pelvis height — without the anchor the whole body sits ~0.9 too low.
 */
function toBone(bone: SkinBone, skin: RWSkin, skinIndex: number): PedBone {
  const inverseBind = [...skin.inverseBindMatrices.slice(skinIndex * 16, skinIndex * 16 + 16)];
  inverseBind[3] = 0;
  inverseBind[7] = 0;
  inverseBind[11] = 0;
  inverseBind[15] = 1;

  let bindPosition: [number, number, number] = [bone.frame.position[0], bone.frame.position[1], bone.frame.position[2]];
  if (bone.parent < 0) {
    // bind = inverse(inverseBind); for affine [R|t]: translation(bind) = −Rᵀ·t.
    const m = inverseBind;
    bindPosition = [
      -(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]),
      -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]),
      -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]),
    ];
  }

  return {
    bindPosition,
    bindRotation: rowMajorRotationToQuat(bone.frame.rotation),
    boneId: bone.frame.boneId ?? -1,
    inverseBind,
    name: bone.frame.name.trim(),
    parent: bone.parent,
  };
}
