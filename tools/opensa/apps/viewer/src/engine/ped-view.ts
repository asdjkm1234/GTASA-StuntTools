import type { DebugLineSetId, Engine, PedProbe } from '@opensa/engine';
import type { IfpAnimation } from '@opensa/renderware';
import type { PedBone, PedClip } from '@opensa/renderware/ped/build-ped-model';

import { IfpSampler } from '@opensa/engine';
import { readPedOsm } from '@opensa/game/adapters/ped-osm';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildPedModel, pedClip } from '@opensa/renderware/ped/build-ped-model';

/** The skinned geometry the ViewedPed overlays need — shared by the DFF (`PedModelData`) and `.osm` paths. */
export interface PedGeometry {
  bones: PedBone[];
  indices: Uint16Array;
  joints: Uint8Array;
  positions: Float32Array;
  weights: Uint8Array;
}

/**
 * One skinned character on the engine: DFF + TXD + IFP clips, sampled per frame into the ped probe's
 * bone palette.
 *
 * The engine holds ONE ped probe at a time (`setPedProbe` replaces the previous), which suits a viewer
 * exactly. Everything below the palette is `buildPedModel` — the same runtime builder the game uses, so
 * a bad bind pose here is a bad bind pose in the game.
 */

export interface ViewedPed {
  bounds: { center: [number, number, number]; radius: number };
  /** Clip names present in the loaded IFP, sorted. */
  clipNames: string[];
  data: PedGeometry;
  dispose(): void;
  play(name: string, loop: boolean): void;
  showSkeleton(visible: boolean): void;
  showWireframe(visible: boolean): void;
  /** Advance the animation and upload the palette. Call once per frame. */
  update(dtSeconds: number): void;
}

const SKELETON_COLOR: readonly [number, number, number, number] = [1, 0.35, 0.9, 1];
const WIREFRAME_COLOR: readonly [number, number, number, number] = [0.1, 0.1, 0.1, 1];

export function loadPed(
  engine: Engine,
  dff: ArrayBuffer,
  txds: readonly ArrayBuffer[],
  animations: readonly IfpAnimation[],
): null | ViewedPed {
  const data = buildPedModel(parseDff(dff), txds);
  if (!data) {
    return null; // not a skinned clump — the caller reports "no skeleton"
  }

  const probe: PedProbe = engine.setPedProbe({
    boneCount: data.bones.length,
    indexCount: data.indices.length,
    indices: bytesOf(data.indices),
    joints: data.joints,
    normals: bytesOf(data.normals),
    positions: bytesOf(data.positions),
    // Each texture becomes its own single-layer array, so a submesh's array index IS its texture's index.
    submeshes: data.submeshes.map((submesh) => ({
      ...submesh,
      array: Math.max(
        0,
        data.textures.findIndex((texture) => texture.name.toLowerCase() === submesh.texture.toLowerCase()),
      ),
      layer: 0,
    })),
    // Probe-grade, like the lab: peds are single-texture in practice; extras would need a texture array.
    // The viewer shows one ped at a time from a loose file; every texture becomes its own single-layer
    // array, so a ped whose textures disagree on size renders whole here too.
    textures: (data.textures.length > 0
      ? data.textures
      : [{ height: 1, rgba: new Uint8Array([255, 255, 255, 255]), width: 1 }]
    ).map((texture) => ({
      height: texture.height,
      kind: 'rgba' as const,
      layers: 1,
      rgba: texture.rgba,
      width: texture.width,
    })),
    uvs: bytesOf(data.uvs),
    weights: data.weights,
  });

  return viewPed(engine, data, probe, animations);
}

/**
 * A CONVERTED ped (`<name>.osm`) → on screen — the same `readPedOsm` decode the game/lab run, textures inside
 * as `.ostex`. The buffers are `Uint8Array` views, so reinterpret positions/indices for the overlay maths.
 */
export function loadPedFromOsm(
  engine: Engine,
  name: string,
  osm: ArrayBuffer,
  animations: readonly IfpAnimation[],
): ViewedPed {
  const { fixture, geometry, textureArrays } = readPedOsm(name, new Uint8Array(osm));
  const probe: PedProbe = engine.setPedProbe({
    boneCount: fixture.bones.length,
    indexCount: fixture.indexCount,
    indices: geometry.indices,
    joints: geometry.joints,
    normals: geometry.normals,
    positions: geometry.positions,
    submeshes: fixture.submeshes,
    textures: textureArrays.map((bytes) => ({ bytes, kind: 'ostex' as const })),
    uvs: geometry.uvs,
    weights: geometry.weights,
  });
  const geo: PedGeometry = {
    bones: fixture.bones,
    indices: new Uint16Array(geometry.indices.slice().buffer),
    joints: geometry.joints,
    positions: new Float32Array(geometry.positions.slice().buffer),
    weights: geometry.weights,
  };

  return viewPed(engine, geo, probe, animations);
}

/**
 * A bone's world position: the palette holds skinning matrices (world × inverseBind), so the joint itself
 * is that matrix applied to the bind position the inverse bind undoes — i.e. the bind translation.
 */
function boneOrigin(data: PedGeometry, palette: Float32Array, index: number): [number, number, number] {
  const inverse = data.bones[index].inverseBind;
  // translation(bind) = −Rᵀ·t of the inverse bind (affine).
  const bx = -(inverse[0] * inverse[12] + inverse[1] * inverse[13] + inverse[2] * inverse[14]);
  const by = -(inverse[4] * inverse[12] + inverse[5] * inverse[13] + inverse[6] * inverse[14]);
  const bz = -(inverse[8] * inverse[12] + inverse[9] * inverse[13] + inverse[10] * inverse[14]);
  const m = (1 + index) * 16;

  return [
    palette[m] * bx + palette[m + 4] * by + palette[m + 8] * bz + palette[m + 12],
    palette[m + 1] * bx + palette[m + 5] * by + palette[m + 9] * bz + palette[m + 13],
    palette[m + 2] * bx + palette[m + 6] * by + palette[m + 10] * bz + palette[m + 14],
  ];
}

function bytesOf(values: Float32Array | Uint16Array): Uint8Array {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
}

function edgeLines(skinned: Float32Array, edges: Uint32Array): Float32Array {
  const out = new Float32Array(edges.length * 3);
  for (let i = 0; i < edges.length; i += 1) {
    out.set(skinned.subarray(edges[i] * 3, edges[i] * 3 + 3), i * 3);
  }

  return out;
}

/** Deduplicated triangle edges as vertex-index pairs (built once; the positions change every frame). */
function edgePairs(indices: Uint16Array): Uint32Array {
  const seen = new Set<number>();
  const pairs: number[] = [];

  for (let i = 0; i + 2 < indices.length; i += 3) {
    for (const [a, b] of [
      [indices[i], indices[i + 1]],
      [indices[i + 1], indices[i + 2]],
      [indices[i + 2], indices[i]],
    ]) {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = low * 65_536 + high;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push(low, high);
      }
    }
  }

  return new Uint32Array(pairs);
}

/** Bone → parent segments, in MODEL space (the caller lifts them to world through slot 0). */
function skeletonLines(data: PedGeometry, palette: Float32Array): Float32Array {
  const out = new Float32Array(data.bones.length * 6);
  let at = 0;

  data.bones.forEach((bone, index) => {
    if (bone.parent < 0) {
      return;
    }
    const child = boneOrigin(data, palette, index);
    const parent = boneOrigin(data, palette, bone.parent);
    out.set(parent, at);
    out.set(child, at + 3);
    at += 6;
  });

  return out.subarray(0, at);
}

/** Apply the model matrix (palette slot 0) in place — model space → world space. */
function toWorld(points: Float32Array, palette: Float32Array): Float32Array {
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    points[i] = palette[0] * x + palette[4] * y + palette[8] * z + palette[12];
    points[i + 1] = palette[1] * x + palette[5] * y + palette[9] * z + palette[13];
    points[i + 2] = palette[2] * x + palette[6] * y + palette[10] * z + palette[14];
  }

  return points;
}

/** The shared ViewedPed over an uploaded ped probe — the DFF and `.osm` paths differ only in how the probe
 *  and `data` are built. */
function viewPed(engine: Engine, data: PedGeometry, probe: PedProbe, animations: readonly IfpAnimation[]): ViewedPed {
  const sampler = new IfpSampler(data.bones);
  const clips = new Map(animations.map((animation) => [animation.name, pedClip(animation, data.bones)]));
  const edges = edgePairs(data.indices);

  let clip: null | PedClip = clips.get('IDLE_stance') ?? clips.values().next().value ?? null;
  let looping = true;
  let time = 0;
  let skeleton: DebugLineSetId | null = null;
  let wireframe: DebugLineSetId | null = null;
  const skinned = new Float32Array(data.positions.length);

  /** Skin every vertex on the CPU — only the debug overlays need this; the mesh itself skins on the GPU. */
  const skinVertices = (): void => {
    const { joints, positions, weights } = data;
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      const px = positions[vertex * 3];
      const py = positions[vertex * 3 + 1];
      const pz = positions[vertex * 3 + 2];
      let x = 0;
      let y = 0;
      let z = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        const weight = weights[vertex * 4 + slot] / 255;
        if (weight <= 0) {
          continue;
        }
        const m = (1 + joints[vertex * 4 + slot]) * 16;
        x +=
          weight *
          (probe.palette[m] * px + probe.palette[m + 4] * py + probe.palette[m + 8] * pz + probe.palette[m + 12]);
        y +=
          weight *
          (probe.palette[m + 1] * px + probe.palette[m + 5] * py + probe.palette[m + 9] * pz + probe.palette[m + 13]);
        z +=
          weight *
          (probe.palette[m + 2] * px + probe.palette[m + 6] * py + probe.palette[m + 10] * pz + probe.palette[m + 14]);
      }
      skinned[vertex * 3] = x;
      skinned[vertex * 3 + 1] = y;
      skinned[vertex * 3 + 2] = z;
    }
  };

  return {
    bounds: { center: [0, 0.9, 0], radius: 1.2 },
    clipNames: [...clips.keys()].sort((a, b) => a.localeCompare(b)),
    data,
    dispose(): void {
      for (const id of [skeleton, wireframe]) {
        if (id !== null) {
          engine.destroyDebugLines(id);
        }
      }
      engine.removePedProbe();
    },
    play(name, loop): void {
      clip = clips.get(name) ?? clip;
      looping = loop;
      time = 0;
    },
    showSkeleton(visible): void {
      if (skeleton === null) {
        if (!visible) {
          return;
        }
        skeleton = engine.createDebugLines(new Float32Array(Math.max(1, data.bones.length) * 6), SKELETON_COLOR, {
          throughDepth: true,
        });
      }
      engine.setDebugLinesVisible(skeleton, visible);
    },
    showWireframe(visible): void {
      if (wireframe === null) {
        if (!visible) {
          return;
        }
        wireframe = engine.createDebugLines(new Float32Array(edges.length * 3), WIREFRAME_COLOR);
      }
      engine.setDebugLinesVisible(wireframe, visible);
    },
    update(dtSeconds): void {
      time += dtSeconds;
      if (clip) {
        if (looping && clip.duration > 0) {
          time %= clip.duration;
        } else if (time > clip.duration) {
          time = clip.duration;
        }
        sampler.sample(clip, time, probe.palette, 1);
      }
      writeModelMatrix(probe.palette);
      engine.updatePedPalette();

      if (skeleton !== null || wireframe !== null) {
        skinVertices();
      }
      // The bone palette is MODEL space (the shader applies slot 0 last — `world = pedMatrices[0] *
      // skinned`), while debug lines are world space by contract. Both overlays go through slot 0.
      if (skeleton !== null) {
        engine.updateDebugLines(skeleton, toWorld(skeletonLines(data, probe.palette), probe.palette));
      }
      if (wireframe !== null) {
        engine.updateDebugLines(wireframe, toWorld(edgeLines(skinned, edges), probe.palette));
      }
    },
  };
}

/** Slot 0 = the GTA Z-up → engine Y-up basis change, no translation (the viewer stands the ped at origin). */
function writeModelMatrix(palette: Float32Array): void {
  palette.set([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1], 0);
}
