/**
 * Ped → `.osm` (plan opensa-pack/003 phase 5f).
 *
 * A ped is the one class that cannot reuse the rigid writer. It has no vertex colours, no paint/lamp `meta`
 * and no reflection slots; it does have four bone indices and four weights per vertex, a skeleton in SKIN
 * ORDER carrying real inverse binds, and a posed `minZ`. So it gets its own `DESC`/`GEOM` pair — and no
 * `COLL`, because a ped's collider is a generated capsule, not geometry.
 *
 * Textures are bucketed BY SIZE into one `.ostex` per bucket, because a `texture2d_array` is one size and
 * one format and **23 of 265 stock peds mix sizes**. Resampling them onto a common size is the option this
 * plan forbids (it regenerates map-optimizer's mip chain), so a submesh addresses its texture as
 * (array, layer) — resolved here, once, instead of by name at spawn.
 */
import type { AssetFileSystem } from '@opensa/renderware';
import type { IfpAnimation } from '@opensa/renderware/parsers/binary/ifp';
import type { PedFixture, PedFixtureSubmesh, PedModelData } from '@opensa/renderware/ped/build-ped-model';

import { encodeOsm, encodeOsmTextures, type OsmSection, OsmSectionTag } from '@opensa/engine-formats';
import { parseDff } from '@opensa/renderware';
import { getTxdChain } from '@opensa/renderware/archive/asset-cache';
import { buildPedModel, pedClip } from '@opensa/renderware/ped/build-ped-model';

import { packModelOstex } from './model-ostex';

export interface PedOsm {
  built: PedModelData;
  /** `DESC` + `GEOM` + `TEXS`. No `COLL`: a ped is collided as a capsule. */
  bytes: Uint8Array;
  fixture: PedFixture;
  /** The sections themselves, so the bundle accumulator can hold a ped like any other model. */
  sections: OsmSection[];
  /** One `.ostex` per texture SIZE the ped uses. */
  textureArrays: Uint8Array[];
}

/**
 * Build one ped's `.osm`. Throws when the model is absent or carries no skin.
 *
 * `restClip` matters more than it looks: `minZ` is the lowest POSED vertex — the feet level the host aligns
 * to the capsule bottom — so it depends on the pose. Measured on the BIND pose instead, the player sinks
 * into the ground to the knees, which is exactly what the first field check showed.
 */
export function buildPedOsm(
  fs: AssetFileSystem,
  model: string,
  txdName: string,
  restClip?: IfpAnimation,
  forceRgba8 = false,
): PedOsm {
  const name = model.toLowerCase();
  const dff = fs.get(`${name}.dff`);
  if (!dff) {
    throw new Error(`${name}.dff not found`);
  }
  const clump = parseDff(dff);
  const txds = getTxdChain(fs, txdName);
  const bind = buildPedModel(clump, txds);
  if (!bind) {
    throw new Error(`${name} is not a skinned clump`);
  }
  // The clip resolves against THIS model's bones, which only exist after the first build — so the pose
  // measurement costs a second one. Offline, that is free.
  const built = restClip ? (buildPedModel(clump, txds, { poseWith: pedClip(restClip, bind.bones) }) ?? bind) : bind;

  const { arrays, slotOf } = bucketTextures(built, forceRgba8);
  const { bin, fixture } = packPedFixture(name, built, slotOf);

  const sections: OsmSection[] = [
    { bytes: new TextEncoder().encode(JSON.stringify(fixture)), tag: OsmSectionTag.DESC },
    { bytes: bin, tag: OsmSectionTag.GEOM },
    { bytes: encodeOsmTextures({ arrays }), tag: OsmSectionTag.TEXS },
  ];

  return { built, bytes: encodeOsm(sections), fixture, sections, textureArrays: arrays };
}

/** Pack the ped's buffers into one blob, and describe them. Nothing the builder produced is dropped. */
export function packPedFixture(
  name: string,
  built: PedModelData,
  slotOf: ReadonlyMap<string, { array: number; layer: number }>,
): { bin: Uint8Array; fixture: PedFixture } {
  const align4 = (value: number): number => Math.ceil(value / 4) * 4;
  let at = 0;
  const reserve = (bytes: number): number => {
    const offset = at;
    at = align4(at + bytes);

    return offset;
  };
  const layout = { indices: 0, joints: 0, normals: 0, positions: 0, uvs: 0, weights: 0 };
  layout.positions = reserve(built.positions.byteLength);
  layout.normals = reserve(built.normals.byteLength);
  layout.uvs = reserve(built.uvs.byteLength);
  layout.joints = reserve(built.joints.byteLength);
  layout.weights = reserve(built.weights.byteLength);
  layout.indices = reserve(built.indices.byteLength);

  const bin = new Uint8Array(at);
  bin.set(bytesOf(built.positions), layout.positions);
  bin.set(bytesOf(built.normals), layout.normals);
  bin.set(bytesOf(built.uvs), layout.uvs);
  bin.set(built.joints, layout.joints);
  bin.set(built.weights, layout.weights);
  bin.set(bytesOf(built.indices), layout.indices);

  const submeshes: PedFixtureSubmesh[] = built.submeshes.map((submesh) => {
    // A submesh whose texture the dictionary does not hold keeps slot 0 — the same "render it untextured
    // rather than not at all" the runtime does today.
    const slot = slotOf.get(submesh.texture.toLowerCase()) ?? { array: 0, layer: 0 };

    return {
      array: slot.array,
      indexCount: submesh.indexCount,
      indexOffset: submesh.indexOffset,
      layer: slot.layer,
      texture: submesh.texture,
    };
  });

  return {
    bin,
    fixture: {
      bones: built.bones.map((bone) => ({
        bindPosition: [...bone.bindPosition] as [number, number, number],
        bindRotation: [...bone.bindRotation] as [number, number, number, number],
        boneId: bone.boneId,
        inverseBind: [...bone.inverseBind],
        name: bone.name,
        parent: bone.parent,
      })),
      indexCount: built.indices.length,
      layout,
      minZ: built.minZ,
      name,
      submeshes,
      vertexCount: built.positions.length / 3,
    },
  };
}

/**
 * Group the ped's textures by SIZE — one `.ostex` per bucket — and return where each texture NAME landed.
 * Every texture the builder decoded is carried; none is dropped for disagreeing with the others.
 */
function bucketTextures(
  built: PedModelData,
  forceRgba8: boolean,
): {
  arrays: Uint8Array[];
  slotOf: Map<string, { array: number; layer: number }>;
} {
  const buckets = new Map<string, PedModelData['textures']>();
  for (const texture of built.textures) {
    const key = `${texture.width}x${texture.height}`;
    buckets.set(key, [...(buckets.get(key) ?? []), texture]);
  }

  const arrays: Uint8Array[] = [];
  const slotOf = new Map<string, { array: number; layer: number }>();
  for (const textures of buckets.values()) {
    const array = arrays.length;
    const { height, width } = textures[0];
    const rgba = new Uint8Array(width * height * 4 * textures.length);
    textures.forEach((texture, layer) => {
      rgba.set(texture.rgba, layer * width * height * 4);
      slotOf.set(texture.name.toLowerCase(), { array, layer });
    });
    arrays.push(
      packModelOstex(
        { height, layers: textures.length, names: textures.map((texture) => texture.name), rgba, width },
        { forceRgba8 },
      ),
    );
  }

  return { arrays, slotOf };
}

function bytesOf(array: Float32Array | Uint16Array): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}
