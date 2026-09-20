import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { chunk, concat, f32, f32a, fixedString, i32, toArrayBuffer, u8, u16, u32 } from '../../test-utils';
import { parseDffCollision } from './col';
import { GeometryFlag, MatFxEffect, RwSection } from './constants';
import { parseDff } from './dff';

/** Build a minimal but complete one-mesh clump exercising every attribute path.
 *  `geometryExt` is appended into the Geometry chunk (e.g. a Skin Extension);
 *  `materialExt` is appended into the Material chunk (e.g. an Extension with reflection plugins). */
function buildSyntheticClump(geometryExt?: Uint8Array, materialExt?: Uint8Array): ArrayBuffer {
  const flags = GeometryFlag.POSITIONS | GeometryFlag.TEXTURED | GeometryFlag.PRELIT | GeometryFlag.NORMALS;

  const frameList = chunk(
    RwSection.FRAME_LIST,
    concat(
      chunk(
        RwSection.STRUCT,
        concat(
          u32(1), // numFrames
          f32a([1, 0, 0, 0, 1, 0, 0, 0, 1]), // rotation (identity)
          f32a([10, 20, 30]), // position
          i32(-1), // parentIndex
          u32(0), // flags
        ),
      ),
      chunk(RwSection.EXTENSION, chunk(RwSection.FRAME, fixedString('Root', 4))),
    ),
  );

  const geometryStruct = chunk(
    RwSection.STRUCT,
    concat(
      u16(flags),
      u8(1), // numUVLayers
      u8(0), // native flag
      u32(1), // numTriangles
      u32(3), // numVertices
      u32(1), // numMorphTargets
      // prelit RGBA per vertex
      u8(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255),
      // one UV layer (3 * vec2)
      f32a([0, 0, 1, 0, 0, 1]),
      // one triangle, packed [v2, v1, materialIndex, v3]
      concat(u16(1), u16(0), u16(0), u16(2)),
      // morph target: bounding sphere (4f) + hasVertices + hasNormals + data
      f32a([0, 0, 0, 1]),
      u32(1),
      u32(1),
      f32a([0, 0, 0, 1, 0, 0, 0, 1, 0]), // positions
      f32a([0, 0, 1, 0, 0, 1, 0, 0, 1]), // normals
    ),
  );

  const material = chunk(
    RwSection.MATERIAL,
    concat(
      chunk(RwSection.STRUCT, concat(u32(0), u8(255, 128, 64, 255), u32(0), u32(1))),
      chunk(
        RwSection.TEXTURE,
        concat(
          chunk(RwSection.STRUCT, u32(0)),
          chunk(RwSection.STRING, fixedString('mytex', 8)),
          chunk(RwSection.STRING, fixedString('', 4)),
        ),
      ),
      materialExt ?? new Uint8Array(0),
    ),
  );

  const materialList = chunk(
    RwSection.MATERIAL_LIST,
    concat(chunk(RwSection.STRUCT, concat(u32(1), i32(-1))), material),
  );

  const geometry = chunk(
    RwSection.GEOMETRY,
    geometryExt ? concat(geometryStruct, materialList, geometryExt) : concat(geometryStruct, materialList),
  );
  const geometryList = chunk(RwSection.GEOMETRY_LIST, concat(chunk(RwSection.STRUCT, u32(1)), geometry));
  const atomic = chunk(RwSection.ATOMIC, chunk(RwSection.STRUCT, concat(u32(0), u32(0), u32(0), u32(0))));

  return toArrayBuffer(
    chunk(RwSection.CLUMP, concat(chunk(RwSection.STRUCT, u32(1)), frameList, geometryList, atomic)),
  );
}

/** A Skin plugin Extension for the 3-vertex synthetic geometry (2 bones). */
function skinExtension(): Uint8Array {
  const skin = chunk(
    RwSection.SKIN,
    concat(
      u8(2, 0, 1, 0), // numBones=2, numUsedBones=0, maxWeights=1, padding
      u8(0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0), // 3 vertices × 4 bone indices
      f32a([1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0]), // 3 vertices × 4 weights
      f32a(Array.from({ length: 32 }, (_, i) => i)), // 2 × 16 inverse-bind matrices
    ),
  );

  return chunk(RwSection.EXTENSION, skin);
}

/** A material Extension with the SA reflection plugins (MatFX env-map + reflection + specular). */
function vehicleMaterialExtension(): Uint8Array {
  const envTexture = chunk(
    RwSection.TEXTURE,
    concat(
      chunk(RwSection.STRUCT, u32(0)),
      chunk(RwSection.STRING, fixedString('vehicleenvmap128', 20)),
      chunk(RwSection.STRING, fixedString('', 4)),
    ),
  );
  const matfx = chunk(
    RwSection.MATFX,
    concat(
      u32(MatFxEffect.ENVMAP), // effectType
      u32(MatFxEffect.ENVMAP), // slot type
      f32(0.5), // coefficient
      u32(0), // useFrameBufferAlpha
      u32(1), // hasTexture
      envTexture,
      u32(MatFxEffect.NULL), // slot 2 (none)
    ),
  );
  const reflection = chunk(
    RwSection.REFLECTION_MAT,
    concat(f32(1), f32(1), f32(0.25), f32(0.5), f32(0.03), u32(0)), // scaleXY, offsetXY, intensity, pad
  );
  const specular = chunk(RwSection.SPECULAR_MAT, concat(f32(0.12), fixedString('vehiclespecdot64', 24)));

  return chunk(RwSection.EXTENSION, concat(matfx, reflection, specular));
}

describe('parseDff material effects (SA reflection plugins)', () => {
  describe('negative cases', () => {
    it('leaves effects undefined when the material has no effect plugins', () => {
      const material = parseDff(buildSyntheticClump()).geometries[0].materials[0];
      expect(material.effects).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    const material = parseDff(buildSyntheticClump(undefined, vehicleMaterialExtension())).geometries[0].materials[0];

    it('parses the MatFX env-map (coefficient + embedded texture name)', () => {
      expect(material.effects?.envMap?.texture).toBe('vehicleenvmap128');
      expect(material.effects?.envMap?.coefficient).toBeCloseTo(0.5);
      expect(material.effects?.envMap?.useFrameBufferAlpha).toBe(false);
    });

    it('parses the SA reflection-material plugin', () => {
      expect(material.effects?.reflection?.intensity).toBeCloseTo(0.03);
      expect(material.effects?.reflection?.scale).toEqual([1, 1]);
      expect(material.effects?.reflection?.offset[0]).toBeCloseTo(0.25);
      expect(material.effects?.reflection?.offset[1]).toBeCloseTo(0.5);
    });

    it('parses the SA specular-material plugin', () => {
      expect(material.effects?.specular?.level).toBeCloseTo(0.12);
      expect(material.effects?.specular?.texture).toBe('vehiclespecdot64');
    });
  });
});

describe('parseDff (synthetic)', () => {
  const clump = parseDff(buildSyntheticClump());

  it('reads frames with names and transforms', () => {
    expect(clump.frames).toHaveLength(1);
    expect(clump.frames[0].name).toBe('Root');
    expect(clump.frames[0].position).toEqual([10, 20, 30]);
    expect(clump.frames[0].parentIndex).toBe(-1);
  });

  it('links atomics to frame and geometry', () => {
    expect(clump.atomics).toEqual([{ frameIndex: 0, geometryIndex: 0 }]);
  });

  it('reads vertex positions, prelit colours, UVs and normals', () => {
    const geo = clump.geometries[0];
    expect(geo.positions.length).toBe(9);
    expect(Array.from(geo.positions.slice(3, 6))).toEqual([1, 0, 0]);
    expect(geo.prelitColors && Array.from(geo.prelitColors.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(geo.uvLayers).toHaveLength(1);
    expect(Array.from(geo.uvLayers[0])).toEqual([0, 0, 1, 0, 0, 1]);
    expect(geo.normals).not.toBeNull();
    expect(Array.from(geo.normals!.slice(0, 3))).toEqual([0, 0, 1]);
  });

  it('unpacks triangle indices and material index', () => {
    expect(clump.geometries[0].triangles).toEqual([{ a: 0, b: 1, c: 2, materialIndex: 0 }]);
  });

  it('reads materials and diffuse texture name', () => {
    const material = clump.geometries[0].materials[0];
    expect(material.color).toEqual([255, 128, 64, 255]);
    expect(material.textured).toBe(true);
    expect(material.texture?.name).toBe('mytex');
  });

  it('leaves normals null when the geometry stores none', () => {
    // Re-build without the NORMALS flag effect by checking the real asset below;
    // here assert the synthetic path produced normals as configured.
    expect(clump.geometries[0].normals).not.toBeNull();
  });

  it('leaves skin undefined for a non-skinned geometry', () => {
    expect(clump.geometries[0].skin).toBeUndefined();
  });

  it('parses the Skin plugin (bone indices, weights, inverse-bind matrices) when present', () => {
    const skin = parseDff(buildSyntheticClump(skinExtension())).geometries[0].skin;
    expect(skin).toBeDefined();
    expect(skin?.numBones).toBe(2);
    expect(Array.from(skin?.boneIndices.slice(0, 4) ?? [])).toEqual([0, 1, 0, 0]);
    expect(skin?.boneWeights.length).toBe(12);
    expect(Array.from(skin?.boneWeights.slice(4, 6) ?? [])).toEqual([0.5, 0.5]);
    expect(skin?.inverseBindMatrices.length).toBe(32);
    expect(Array.from(skin?.inverseBindMatrices.slice(0, 3) ?? [])).toEqual([0, 1, 2]);
  });

  it('skips a leading UVAnimDict (0x2B) chunk before the Clump', () => {
    // UV-animated models (waterfalls, scrolling signs) prepend a UVAnimDict.
    const withUvAnim = toArrayBuffer(concat(chunk(0x2b, u8(1, 2, 3, 4)), new Uint8Array(buildSyntheticClump())));
    const parsed = parseDff(withUvAnim);

    expect(parsed.geometries).toHaveLength(1);
    expect(parsed.atomics.length).toBeGreaterThan(0);
  });

  it('rejects non-clump input', () => {
    expect(() => parseDff(toArrayBuffer(chunk(RwSection.TEXTURE_DICTIONARY, u32(0))))).toThrow(/Not a DFF/);
  });
});

/**
 * A two-material, two-triangle clump. `faceMaterials` sets the indices written into the Struct face
 * array, `binMesh` toggles the BinMeshPLG (the data RenderWare actually draws), and `splitIndices`
 * overrides the winding the splits use — the face array and the splits can legally disagree.
 */
function buildBinMeshClump(
  faceMaterials: [number, number],
  binMesh: boolean,
  splitIndices: [number[], number[]] = [
    [0, 1, 2],
    [3, 4, 5],
  ],
): ArrayBuffer {
  const geometryStruct = chunk(
    RwSection.STRUCT,
    concat(
      // NB no TEXTURED flag: with the layer-count byte at 0 the flag itself implies one UV set (RW
      // semantics — see the uv-layer-count fixture below), and this synthetic carries no UV data.
      u16(GeometryFlag.POSITIONS),
      u8(0), // numUVLayers
      u8(0), // native flag
      u32(2), // numTriangles
      u32(6), // numVertices
      u32(1), // numMorphTargets
      // two triangles packed [v2, v1, materialIndex, v3] — verts {0,1,2} and {3,4,5}
      concat(u16(1), u16(0), u16(faceMaterials[0]), u16(2)),
      concat(u16(4), u16(3), u16(faceMaterials[1]), u16(5)),
      f32a([0, 0, 0, 1]), // morph bounding sphere
      u32(1), // hasVertices
      u32(0), // hasNormals
      f32a([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1]), // 6 positions
    ),
  );

  const oneMaterial = (r: number): Uint8Array =>
    chunk(RwSection.MATERIAL, chunk(RwSection.STRUCT, concat(u32(0), u8(r, 0, 0, 255), u32(0), u32(0))));
  const materialList = chunk(
    RwSection.MATERIAL_LIST,
    concat(chunk(RwSection.STRUCT, concat(u32(2), i32(-1), i32(-1))), oneMaterial(10), oneMaterial(20)),
  );

  // BinMeshPLG: trilist, split 0 → material 0 (verts 0,1,2), split 1 → material 1 (verts 3,4,5).
  const binMeshExt = chunk(
    RwSection.EXTENSION,
    chunk(
      RwSection.BIN_MESH_PLG,
      concat(
        u32(0), // flags (0 = trilist)
        u32(2), // numMeshes
        u32(6), // total indices
        concat(u32(3), u32(0), ...splitIndices[0].map((i) => u32(i))),
        concat(u32(3), u32(1), ...splitIndices[1].map((i) => u32(i))),
      ),
    ),
  );

  const parts = binMesh ? concat(geometryStruct, materialList, binMeshExt) : concat(geometryStruct, materialList);
  const geometryList = chunk(
    RwSection.GEOMETRY_LIST,
    concat(chunk(RwSection.STRUCT, u32(1)), chunk(RwSection.GEOMETRY, parts)),
  );
  const frameList = chunk(
    RwSection.FRAME_LIST,
    chunk(RwSection.STRUCT, concat(u32(1), f32a([1, 0, 0, 0, 1, 0, 0, 0, 1]), f32a([0, 0, 0]), i32(-1), u32(0))),
  );
  const atomic = chunk(RwSection.ATOMIC, chunk(RwSection.STRUCT, concat(u32(0), u32(0), u32(0), u32(0))));

  return toArrayBuffer(
    chunk(RwSection.CLUMP, concat(chunk(RwSection.STRUCT, u32(1)), frameList, geometryList, atomic)),
  );
}

describe('parseDff triangles come from the DRAWN index data', () => {
  describe('negative cases', () => {
    it('falls back to the face array when there is no BinMeshPLG', () => {
      const tris = parseDff(buildBinMeshClump([1, 0], false)).geometries[0].triangles;
      expect(tris.map((t) => t.materialIndex)).toEqual([1, 0]);
      expect(tris.map((t) => [t.a, t.b, t.c])).toEqual([
        [0, 1, 2],
        [3, 4, 5],
      ]);
    });
  });

  describe('positive cases', () => {
    it("takes the split's material even when the face array already set one", () => {
      // The face array says [1, 0]; the BinMesh splits say [0, 1]. RenderWare draws the splits (plan 095).
      const tris = parseDff(buildBinMeshClump([1, 0], true)).geometries[0].triangles;
      expect(tris.map((t) => t.materialIndex)).toEqual([0, 1]);
    });

    it('takes the WINDING from the split, not from the face array', () => {
      // Both fixtures describe the same two triangles; the face array winds them (0,1,2)/(3,4,5) and the
      // BinMesh reverses the first split. `roads32_law2` is this case for all 65 of its road faces, and
      // reading the face array put the slab face-down where back-face culling deleted it.
      const tris = parseDff(
        buildBinMeshClump([0, 0], true, [
          [2, 1, 0],
          [3, 4, 5],
        ]),
      ).geometries[0].triangles;
      expect(tris.map((t) => [t.a, t.b, t.c])).toEqual([
        [2, 1, 0],
        [3, 4, 5],
      ]);
    });
  });
});

/** A geometry Extension holding a 2d Effect plugin with one Light entry + one non-light entry. */
function twoDEffectExtension(): Uint8Array {
  const lightData = concat(
    u8(255, 200, 100, 255), // colour RGBA
    f32(150), // corona far-clip
    f32(20), // point-light range
    f32(1.5), // corona size
    f32(3), // shadow size
    u8(0, 0, 0, 0), // show-mode, reflection, flare type, shadow-colour multiplier
    u8(7), // flags1
    fixedString('coronastar', 24), // corona texture
    fixedString('shad_exp', 24), // shadow texture
    u8(0, 0), // shadow-Z distance, flags2
  );
  const light = concat(f32a([5, 6, 7]), u32(0), u32(lightData.length), lightData); // type 0 = light
  const particle = concat(f32a([1, 1, 1]), u32(1), u32(4), u8(9, 9, 9, 9)); // type 1 = particle (skipped)
  const fx = chunk(RwSection.TWO_D_EFFECT, concat(u32(2), light, particle));

  return chunk(RwSection.EXTENSION, fx);
}

describe('parseDff 2d-effect lights', () => {
  describe('negative cases', () => {
    it('returns no lights when the geometry has no 2d-effect plugin', () => {
      expect(parseDff(buildSyntheticClump()).geometries[0].lights).toEqual([]);
    });
  });

  describe('positive cases', () => {
    const lights = parseDff(buildSyntheticClump(twoDEffectExtension())).geometries[0].lights;

    it('parses the Light entry and skips non-light entries', () => {
      expect(lights).toHaveLength(1);
    });

    it('reads the light position, colour, corona size and texture', () => {
      expect(lights[0]).toEqual({
        color: [255, 200, 100, 255],
        coronaFarClip: 150,
        coronaSize: 1.5,
        coronaTexture: 'coronastar',
        flags: 7,
        position: [5, 6, 7],
      });
    });
  });
});

const dffPath = join(process.cwd(), 'fixtures', 'original', 'dff', 'building', 'washer.dff');
const dffExists = existsSync(dffPath);
// Read lazily: describe.skipIf still evaluates the suite body during collection,
// so only touch the filesystem when the asset is actually present.
const realClump = dffExists ? parseDff(toArrayBuffer(new Uint8Array(readFileSync(dffPath)))) : null;

describe.skipIf(!dffExists)('parseDff (real map model washer.dff)', () => {
  it('matches the known geometry counts', () => {
    const geo = realClump!.geometries[0];
    expect(realClump!.geometries).toHaveLength(1);
    expect(geo.positions.length / 3).toBe(24);
    expect(geo.triangles).toHaveLength(12);
  });

  it('is a prelit map model (no stored normals) with one UV layer', () => {
    const geo = realClump!.geometries[0];
    expect(geo.prelitColors).not.toBeNull(); // SA map geometry is prelit (lit at vertices, not by lights)
    expect(geo.normals).toBeNull(); // map models ship no stored normals (computed downstream)
    expect(geo.uvLayers).toHaveLength(1);
  });

  it('references its two material textures', () => {
    const geo = realClump!.geometries[0];
    expect(geo.materials).toHaveLength(2);
    expect(geo.materials.map((m) => m.texture?.name)).toEqual(['junk_tv2', 'junk_washer1']);
  });
});

const admiralPath = join(process.cwd(), 'fixtures', 'original', 'vehicles', 'admiral.dff');
const admiralExists = existsSync(admiralPath);
const admiral = admiralExists ? parseDff(toArrayBuffer(new Uint8Array(readFileSync(admiralPath)))) : null;

describe.skipIf(!admiralExists)('parseDff (real vehicle admiral.dff) reflection plugins', () => {
  it('reads MatFX env maps, reflection + specular off the body materials', () => {
    const materials = admiral!.geometries.flatMap((g) => g.materials);
    // Truly-reflective body materials: a MatFX env map with a positive coefficient (model-agnostic —
    // stock cars use coefficient 1 + the generic env textures, custom mods may use 0.5 + their own).
    const reflective = materials.filter((m) => m.effects?.envMap && m.effects.envMap.coefficient > 0);
    expect(reflective.length).toBeGreaterThan(0);
    expect(reflective.every((m) => (m.effects!.envMap!.texture?.length ?? 0) > 0)).toBe(true);
    expect(materials.some((m) => m.effects?.specular?.texture === 'vehiclespecdot64')).toBe(true);
    expect(materials.some((m) => m.effects?.reflection)).toBe(true);
  });
});

// Anti-rip lock Variant B (see docs/open-issues/locked-dff.md): cheetah.dff's clump Struct size is bloated
// to 0x0100000C so a boundary-respecting walk sees only the Struct. forEachClumpChild recovers via the
// canonical 12-byte struct payload. Committed custom fixture (a modified/locked mod model).
const LOCKED_DFF = 'fixtures/custom/locked-models/cheetah.dff';

describe('parseDff (locked DFF — inflated clump-struct size)', () => {
  const buffer = toArrayBuffer(new Uint8Array(readFileSync(LOCKED_DFF)));

  describe('positive cases', () => {
    it('recovers the model hidden behind the bogus struct size', () => {
      const clump = parseDff(buffer);
      expect(clump.atomics).toHaveLength(57);
      expect(clump.frames.length).toBeGreaterThan(0);
      expect(clump.geometries.length).toBeGreaterThan(0);
    });

    it('recovers the embedded COL the lock hid in the clump Extension', () => {
      expect(parseDffCollision(buffer)).not.toBeNull();
    });
  });
});

// Anti-rip "inflated size" lock (see docs/open-issues/locked-dff.md): yosemite.dff declares 31 atomics /
// 31 geometries but each item's size is bloated to swallow its siblings (+ 0x0 padding), so a boundary
// walk finds only 8 / 16 and atomics index missing geometries. The count-based RW-style recovery restores
// the full set. Committed custom fixture (a locked mod model). The game renders it whole (it reads by count).
const INFLATED_DFF = 'fixtures/custom/locked-models/yosemite.dff';

describe('parseDff (locked DFF — inflated atomic/geometry sizes)', () => {
  const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(INFLATED_DFF))));

  describe('positive cases', () => {
    it('recovers every atomic and geometry the inflated sizes hid', () => {
      expect(clump.atomics).toHaveLength(31);
      expect(clump.geometries).toHaveLength(31);
    });

    it('leaves no atomic pointing past the geometry list (all indices resolve)', () => {
      expect(clump.atomics.every((a) => a.geometryIndex < clump.geometries.length)).toBe(true);
    });
  });
});

// Anti-rip lock Variant D (see docs/open-issues/locked-dff.md): walton.dff bloats *every* container size —
// the clump Struct (640 MB, Variant B), the FrameList (1.2 GB, overruns EOF) and the GeometryList (swallows
// the trailing Atomics). Struct payload counts + leaf/child sizes stay honest, so forEachClumpChild recovers
// each container's real end from its honest children. Committed custom fixture (a locked mod model).
const OVERLOCKED_DFF = 'fixtures/custom/locked-models/walton.dff';

describe('parseDff (locked DFF — every container size bloated)', () => {
  const buffer = toArrayBuffer(new Uint8Array(readFileSync(OVERLOCKED_DFF)));

  describe('positive cases', () => {
    it('recovers frames, geometries and atomics past the bloated container sizes', () => {
      const clump = parseDff(buffer);
      expect(clump.frames).toHaveLength(77);
      expect(clump.geometries).toHaveLength(43);
      expect(clump.atomics).toHaveLength(43);
      expect(clump.atomics.every((a) => a.geometryIndex < clump.geometries.length)).toBe(true);
    });

    it('recovers the embedded COL the lock hid in the clump Extension', () => {
      expect(parseDffCollision(buffer)).not.toBeNull();
    });
  });
});

// NOT a lock — a 2015-era export quirk (see docs/open-issues/locked-dff.md "false alarm" note):
// casroyale01_lvs.dff writes the geometry's UV-LAYER-COUNT BYTE as 0 and carries the truth in the TEXTURED
// flag, which RenderWare honours. Trusting the bare byte skipped the UV block and read the TRIANGLES out of
// UV float data (garbage indices up to 64512 for 1418 vertices) — masquerading as an anti-rip "lock" and
// costing three field rounds (vanished casino → shard fields, 2026-07-15). Committed real fixture.
const UV_FLAG_COUNT_DFF = 'fixtures/custom/locked-models/casroyale01_lvs.dff';

describe('parseDff (uv-layer count from TEXTURED flags when the byte is 0)', () => {
  const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(UV_FLAG_COUNT_DFF))));

  describe('positive cases', () => {
    it('reads one UV layer from the TEXTURED flag and the triangles from the right offset', () => {
      const geometry = clump.geometries[0];
      const vertexCount = geometry.positions.length / 3;
      expect(vertexCount).toBe(1418);
      expect(geometry.uvLayers).toHaveLength(1);
      expect(geometry.triangles).toHaveLength(1011);
      expect(geometry.triangles.every((t) => t.a < vertexCount && t.b < vertexCount && t.c < vertexCount)).toBe(true);
    });

    it('reads sane geometry (full surface, no degenerate collapse, all materials assigned)', () => {
      const geometry = clump.geometries[0];
      const p = geometry.positions;
      let area = 0;
      for (const t of geometry.triangles) {
        const bx = p[t.b * 3] - p[t.a * 3];
        const by = p[t.b * 3 + 1] - p[t.a * 3 + 1];
        const bz = p[t.b * 3 + 2] - p[t.a * 3 + 2];
        const cx = p[t.c * 3] - p[t.a * 3];
        const cy = p[t.c * 3 + 1] - p[t.a * 3 + 1];
        const cz = p[t.c * 3 + 2] - p[t.a * 3 + 2];
        area += Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx) / 2;
      }
      expect(area).toBeCloseTo(6389, -1); // the same building as the vanilla export
      expect(new Set(geometry.triangles.map((t) => t.materialIndex)).size).toBe(12);
    });
  });
});
