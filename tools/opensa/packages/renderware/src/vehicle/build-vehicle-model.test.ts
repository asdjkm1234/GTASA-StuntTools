import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { RWClump, RWFrame, RWGeometry, RWMaterial, RWUvAnimation } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildVehicleModel } from './build-vehicle-model';
import { VehicleTextures } from './textures';
import { MaterialClass, PaintSlot } from './types';

const PRIMARY_MARKER: [number, number, number, number] = [60, 255, 0, 255];
const HEAD_LAMP_MARKER: [number, number, number, number] = [0, 255, 200, 255];

/** A one-atomic clump carrying a UVAnimDict — the shape every animated script object has. */
function animated(geometries: RWGeometry[], uvAnimations: RWUvAnimation[]): RWClump {
  return { ...clump([frame('chassis')], [{ frame: 0, geometry: 0 }], geometries), uvAnimations };
}

function clump(frames: RWFrame[], atomics: { frame: number; geometry: number }[], geometries: RWGeometry[]): RWClump {
  return {
    atomics: atomics.map((atomic) => ({ frameIndex: atomic.frame, geometryIndex: atomic.geometry })),
    frames,
    geometries,
  };
}

function frame(name: string, parentIndex = -1, position: [number, number, number] = [0, 0, 0]): RWFrame {
  return { name, parentIndex, position, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
}

function geometry(materials: RWMaterial[] = [material()]): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS,
    lights: [],
    materials,
    nightColors: null,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    prelitColors: null,
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [],
  };
}

/** A `misc_*` pod: one triangle whose normal is `normal`, on a head-lamp material unless `marked` is false. */
function lampPod(normal: [number, number, number], marked = true): RWGeometry {
  const lamp = material({
    color: marked ? HEAD_LAMP_MARKER : [200, 200, 200, 255],
    texture: { name: marked ? 'vehiclelights128' : 'bodywork' } as RWMaterial['texture'],
    textured: true,
  });

  return {
    ...geometry([lamp]),
    flags: GeometryFlag.POSITIONS | GeometryFlag.NORMALS,
    normals: new Float32Array([...normal, ...normal, ...normal]),
  };
}

function material(partial: Partial<RWMaterial> = {}): RWMaterial {
  return { color: [200, 200, 200, 255], texture: null, textured: false, ...partial };
}

/** No TXDs: every material resolves to the built-in white layer. */
function textures(): VehicleTextures {
  return new VehicleTextures([]);
}

/** A two-keyframe dict entry — the smallest thing the builder must accept as playable. */
function uvAnimation(name: string): RWUvAnimation {
  return {
    duration: 0.45,
    keyframes: [
      { time: 0, uv: [0, 1, 1, 0, 0, 0] },
      { time: 0.225, uv: [0, 1, 1, 0, 0.0769, 0] },
    ],
    name,
  };
}

function uvAnimMaterial(name: string): RWMaterial {
  return material({ effects: { uvAnim: { channelMask: 1, names: [name] } } });
}

describe('buildVehicleModel', () => {
  describe('negative cases', () => {
    it('a clump with no wheel atomic and no dummies yields no wheels', () => {
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry()]), textures());

      expect(built.wheels).toHaveLength(0);
      expect(built.parts).toHaveLength(1);
    });

    it('a misc component whose lamps already face the road is a light BAR, not a pop-up pod', () => {
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('misc_a', 0, [0, 2, 0.2])],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 1 },
          ],
          [geometry(), lampPod([0, 1, 0])],
        ),
        textures(),
      );

      expect(built.popUpLights).toBeUndefined();
    });

    it('a misc component with no lamp faces at all is machinery (a dozer blade), not headlights', () => {
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('misc_a', 0, [0, 2, 0.2])],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 1 },
          ],
          [geometry(), lampPod([0, 0.7, -0.7], false)],
        ),
        textures(),
      );

      expect(built.popUpLights).toBeUndefined();
    });

    it("every `extraN` alternative ships TAGGED — the pick is the spawn's, not the build's", () => {
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('extra1'), frame('extra2'), frame('extra3')],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 0 },
            { frame: 2, geometry: 0 },
            { frame: 3, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      expect(built.parts.map((part) => part.name)).toEqual(['chassis', 'extra1', 'extra2', 'extra3']);
      // The chassis carries no tag; each extra's submeshes name their own frame, which is what lets the
      // runtime show exactly one per car instead of all three on top of each other.
      expect(built.submeshes.map((submesh) => submesh.extra ?? null)).toEqual([null, 'extra1', 'extra2', 'extra3']);
    });

    it('a material naming a UV animation the clump does not carry renders static', () => {
      const built = buildVehicleModel(
        animated([geometry([uvAnimMaterial('missing')])], [uvAnimation('f13d')]),
        textures(),
      );

      expect(built.uvAnimations).toBeUndefined();
      expect(built.submeshes[0].uvAnim).toBeUndefined();
    });

    it('a named entry with no keyframes renders static rather than inventing a scroll', () => {
      const built = buildVehicleModel(
        animated([geometry([uvAnimMaterial('f13d')])], [{ ...uvAnimation('f13d'), keyframes: [] }]),
        textures(),
      );

      expect(built.uvAnimations).toBeUndefined();
      expect(built.submeshes[0].uvAnim).toBeUndefined();
    });

    it('a dict no material references is dropped — the model carries only what it plays', () => {
      const built = buildVehicleModel(animated([geometry()], [uvAnimation('f13d')]), textures());

      expect(built.uvAnimations).toBeUndefined();
      expect(built.submeshes[0].uvAnim).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('binds a material to its dict entry and keeps the keyframes on the model', () => {
      const built = buildVehicleModel(
        animated([geometry([uvAnimMaterial('f13d'), material()])], [uvAnimation('other'), uvAnimation('f13d')]),
        textures(),
      );

      // The slot indexes the MODEL's list, not the clump's dict: only `f13d` is referenced, so it is 0 here
      // even though the dict holds it second.
      expect(built.submeshes[0].uvAnim).toBe(0);
      expect(built.uvAnimations?.map((animation) => animation.name)).toEqual(['f13d']);
      expect(built.uvAnimations?.[0].keyframes).toHaveLength(2);
    });

    it('two materials sharing one entry share the slot instead of duplicating the keyframes', () => {
      const shared = animated([geometry([uvAnimMaterial('f13d'), uvAnimMaterial('f13d')])], [uvAnimation('f13d')]);
      shared.geometries[0].triangles.push({ a: 0, b: 1, c: 2, materialIndex: 1 });

      const built = buildVehicleModel(shared, textures());

      expect(built.submeshes.map((submesh) => submesh.uvAnim)).toEqual([0, 0]);
      expect(built.uvAnimations).toHaveLength(1);
    });

    it('reads pop-up headlights off the model: the pod, and the pitch it is parked at', () => {
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('misc_a', 0, [0, 2, 0.2])],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 1 },
          ],
          // Parked looking 45° down into the nose — so it has 45° to swing before its lamps face the road.
          [geometry(), lampPod([0, Math.SQRT1_2, -Math.SQRT1_2])],
        ),
        textures(),
      );

      expect(built.parts[built.popUpLights!.part].name).toBe('misc_a');
      expect((built.popUpLights!.angle * 180) / Math.PI).toBeCloseTo(45, 4);
    });

    it("`features.txt` can declare a pod whose faces carry no lamp marker (a mod's own texture)", () => {
      const parked = clump(
        [frame('chassis'), frame('misc_a', 0, [0, 2, 0.2])],
        [
          { frame: 0, geometry: 0 },
          { frame: 1, geometry: 1 },
        ],
        [geometry(), lampPod([0, Math.SQRT1_2, -Math.SQRT1_2], false)],
      );

      expect(buildVehicleModel(parked, textures()).popUpLights).toBeUndefined();
      expect(buildVehicleModel(parked, textures(), { popUpLights: true })?.popUpLights?.angle).toBeCloseTo(
        Math.PI / 4,
        4,
      );
    });

    it('indexes a model past 65 536 vertices as uint32 instead of wrapping it', () => {
      // This used to THROW, and the throw landed in the fixed step — two hi-poly mod cars (86 511 and
      // 82 991 verts) took the whole vehicle system down with them, so NOTHING spawned.
      const huge = geometry();
      const vertexCount = 65_540;
      huge.positions = new Float32Array(vertexCount * 3);
      huge.triangles = [];
      for (let at = 0; at + 2 < vertexCount; at += 3) {
        huge.triangles.push({ a: at, b: at + 1, c: at + 2, materialIndex: 0 });
      }

      const model = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [huge]), textures());

      expect(model.indices.BYTES_PER_ELEMENT).toBe(4);
      // The whole point: the last vertex must still address itself, not wrap to a low index. A plain loop,
      // because `Math.max(...indices)` blows the call stack on tens of thousands of them and `.reduce` is
      // not callable on the `Uint16Array | Uint32Array` union (its overloads do not unify).
      let highest = 0;
      for (const index of model.indices) {
        highest = Math.max(highest, index);
      }

      expect(highest).toBeGreaterThan(65_535);
    });

    it('keeps uint16 indices for an ordinary model', () => {
      const model = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry()]), textures());

      expect(model.indices.BYTES_PER_ELEMENT).toBe(2);
    });

    it('carcols markers become a per-vertex paint SLOT, not a baked colour (one model, many colours)', () => {
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([material({ color: PRIMARY_MARKER })])]),
        textures(),
      );

      // meta.z carries the slot; the marker colour itself must NOT survive into the vertex colours.
      expect(built.meta[2]).toBe(PaintSlot.primary);
      expect([...built.colors.subarray(0, 3)]).not.toEqual([60, 255, 0]);
    });

    it('leaves a model with no prelit set undarkened at night — a car is lit by the world, not by vertices', () => {
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry()]), textures());

      // Not one of the game's 198 cars carries a prelit set, so synthesizing an ambient night here would
      // dim every vehicle at midnight on top of the world light that already does it.
      expect(built.night).toEqual(built.colors);
    });

    it('modulates the material colour by the PRELIT set, and carries the authored night set', () => {
      const lit = geometry([material({ color: [200, 200, 200, 255] })]);
      lit.prelitColors = new Uint8Array([128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255]);
      lit.nightColors = new Uint8Array([64, 64, 64, 255, 64, 64, 64, 255, 64, 64, 64, 255]);
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [lit]), textures());

      expect([...built.colors.subarray(0, 4)]).toEqual([100, 100, 100, 255]); // 200 × 128/255
      expect([...built.night.subarray(0, 4)]).toEqual([50, 50, 50, 255]); // 200 × 64/255
    });

    it('synthesizes night = day × ambient for PRELIT geometry with no authored night set', () => {
      const lit = geometry([material({ color: [255, 255, 255, 255] })]);
      lit.prelitColors = new Uint8Array([200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255]);
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [lit]), textures());

      // The welded cell path's formula, shared as NIGHT_AMBIENT — a prop must not disagree with its cell.
      expect([...built.night.subarray(0, 3)]).toEqual([60, 64, 80]); // 200 × [0.3, 0.32, 0.4]
    });

    it('gives each material its OWN copy of a vertex the two share (opensa-pack 003 phase 5g)', () => {
      // Two triangles over four vertices, sharing the 1—2 edge, one material each. With a single vertex
      // table the shared corners took whichever material came last — the wrong texture layer and the wrong
      // colour on 6.9 % of the map's models, and an unbindable submesh once layers span several arrays.
      const shared = geometry([material({ color: [10, 20, 30, 255] }), material({ color: [200, 100, 50, 255] })]);
      shared.positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
      shared.triangles = [
        { a: 0, b: 1, c: 2, materialIndex: 0 },
        { a: 1, b: 3, c: 2, materialIndex: 1 },
      ];
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [shared]), textures());

      expect(built.positions.length / 3).toBe(6); // 3 + 3, not 4 — the shared edge is emitted twice
      for (const submesh of built.submeshes) {
        const expected = submesh.indexOffset === 0 ? [10, 20, 30] : [200, 100, 50];
        for (let at = submesh.indexOffset; at < submesh.indexOffset + submesh.indexCount; at += 1) {
          const vertex = built.indices[at];

          expect([...built.colors.subarray(vertex * 4, vertex * 4 + 3)]).toEqual(expected);
        }
      }
    });

    it('lamp materials render white and carry a head/tail tag instead of their marker colour', () => {
      const lamp = material({
        color: HEAD_LAMP_MARKER,
        texture: { name: 'vehiclelights128' } as RWMaterial['texture'],
      });
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([lamp])]),
        textures(),
      );

      expect(built.submeshes[0].lamp).toBe('head');
      expect([...built.colors.subarray(0, 3)]).toEqual([255, 255, 255]);
    });

    it('materials classify into meta.w high nibble: paint / chrome / glass / matte (074/16)', () => {
      const envMap = (texture: string): RWMaterial['effects'] => ({
        envMap: { coefficient: 0.5, texture, useFrameBufferAlpha: false },
      });
      const paint = material({ color: PRIMARY_MARKER, effects: envMap('xvehicleenv128') });
      // Chrome is a DATA signal, never a name: untextured neutral grey + an env map (the ./1 mod convention).
      const chrome = material({ color: [153, 153, 153, 255], effects: envMap('vehicleenvmap128') });
      const glass = material({ color: [200, 200, 200, 120], effects: envMap('vehicleenvmap128') });
      const tyre = material(); // no env plugin — SA's "not reflective" marker
      const built = buildVehicleModel(
        clump(
          [frame('chassis')],
          [{ frame: 0, geometry: 0 }],
          [
            {
              ...geometry([paint, chrome, glass, tyre]),
              positions: new Float32Array(Array.from({ length: 12 * 3 }, () => 0)),
              triangles: [
                { a: 0, b: 1, c: 2, materialIndex: 0 },
                { a: 3, b: 4, c: 5, materialIndex: 1 },
                { a: 6, b: 7, c: 8, materialIndex: 2 },
                { a: 9, b: 10, c: 11, materialIndex: 3 },
              ],
            },
          ],
        ),
        textures(),
      );

      const classOf = (vertex: number): number => built.meta[vertex * 4 + 3] >> 4;
      expect(classOf(0)).toBe(MaterialClass.paint);
      expect(classOf(3)).toBe(MaterialClass.chrome);
      expect(classOf(6)).toBe(MaterialClass.glass);
      expect(classOf(9)).toBe(MaterialClass.matte);
    });

    it('chrome never comes from NAMES: bare grey trim is chrome, textured chrome sheets stay paint', () => {
      const envMap = (texture: string): RWMaterial['effects'] => ({
        envMap: { coefficient: 0.5, texture, useFrameBufferAlpha: false },
      });
      // Round-4 user directive: mods combine arbitrary names — only DATA signals classify. Untextured
      // grey trim → chrome; a chrome-NAMED sheet with a base texture → paint (the neo model reads its grey
      // texture as metal through the same formula); a carcols panel on a chrome-named env map → paint.
      const modChrome = material({ effects: envMap('vehicle_generic_chromeprts2') });
      const chromeSheet = material({
        effects: envMap('env_chrome128'),
        texture: { name: 'ch75_chrmap' } as RWMaterial['texture'],
      });
      const paintedBody = material({ color: PRIMARY_MARKER, effects: envMap('chrom_body') });
      const built = buildVehicleModel(
        clump(
          [frame('chassis')],
          [{ frame: 0, geometry: 0 }],
          [
            {
              ...geometry([modChrome, chromeSheet, paintedBody]),
              positions: new Float32Array(Array.from({ length: 9 * 3 }, () => 0)),
              triangles: [
                { a: 0, b: 1, c: 2, materialIndex: 0 },
                { a: 3, b: 4, c: 5, materialIndex: 1 },
                { a: 6, b: 7, c: 8, materialIndex: 2 },
              ],
            },
          ],
        ),
        textures(),
      );

      const classOf = (vertex: number): number => built.meta[vertex * 4 + 3] >> 4;
      expect(classOf(0)).toBe(MaterialClass.chrome);
      expect(classOf(3)).toBe(MaterialClass.paint);
      expect(classOf(6)).toBe(MaterialClass.paint);
    });

    it('`_vlo` LOD meshes and lamps classify MATTE, and the lamp tag survives in the low nibble', () => {
      const env: RWMaterial['effects'] = {
        envMap: { coefficient: 0.6, texture: 'xvehicleenv128', useFrameBufferAlpha: false },
      };
      const lamp = material({
        color: HEAD_LAMP_MARKER,
        effects: env,
        texture: { name: 'vehiclelights128' } as RWMaterial['texture'],
      });
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('chassis_vlo')],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 1 },
          ],
          [geometry([lamp]), geometry([material({ effects: env })])],
        ),
        textures(),
      );

      expect(built.meta[3] >> 4).toBe(MaterialClass.matte); // lamp
      expect(built.meta[3] & 0xf).toBe(1); // LampTag.head survives the packing
      const lodVertex = built.submeshes.find((submesh) => submesh.kind === 'lod')!.indexOffset;
      expect(built.meta[built.indices[lodVertex] * 4 + 3] >> 4).toBe(MaterialClass.matte);
    });

    it('the shared `wheel` atomic instances at every dummy, LEFT side turned 180°, scaled by wheelScale', () => {
      const built = buildVehicleModel(
        clump(
          [
            frame('chassis'),
            frame('wheel'),
            frame('wheel_lf_dummy', -1, [1, 2, 0]),
            frame('wheel_rf_dummy', -1, [-1, 2, 0]),
            frame('wheel_lb_dummy', -1, [1, -2, 0]),
            frame('wheel_rb_dummy', -1, [-1, -2, 0]),
          ],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
        { wheelScale: [0.8, 0.8] },
      );

      expect(built.wheels).toHaveLength(4);
      expect(built.wheels.filter((wheel) => wheel.front)).toHaveLength(2);
      // The mesh is authored on the RIGHT (the fallback — this clump parents `wheel` to no dummy), so the
      // right copies mount as-modelled and the LEFT ones take the 180° spin.
      const right = built.parts[built.wheels[1].part];
      expect(right.name).toBe('wheel_rf_dummy');
      expect(right.localRotation).toEqual([0, 0, 0, 1]);
      // The synthetic wheel geometry has radius 1 (diameter 2), so fitting it to the requested 0.8 m FRONT
      // diameter is 0.8 / 2 — the field is a diameter in metres, not a multiplier.
      expect(right.scale).toBeCloseTo(0.4, 5);
      const left = built.parts[built.wheels[0].part];
      expect(left.name).toBe('wheel_lf_dummy');
      expect(left.localRotation).toEqual([0, 0, 1, 0]); // 180° about Z — a mirror would flip the winding
    });

    it('a zero-WIDTH marker wheel is left unscaled, but still reports the ide physics radius', () => {
      // The GTA 5 Rhino draws its running gear with `wheel_big_*`/`track_*` meshes and parks a flat
      // 2 cm triangle on the SA wheel frames to keep them invisible. Fitting that to the ide diameter
      // scaled it 23.5x and drew six half-metre triangles sweeping with the wheels (field 2026-08-07).
      const marker: RWGeometry = {
        ...geometry(),
        // No extent along the axle (local X) — a solid of revolution cannot have zero width.
        positions: new Float32Array([0, 0, 0, 0, 0.011, 0.019, 0, -0.011, -0.019]),
      };
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('wheel'), frame('wheel_lf_dummy', -1, [1, 2, 0])],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 1 },
          ],
          [geometry(), marker],
        ),
        textures(),
        { wheelScale: [1, 1] },
      );

      expect(built.parts[built.wheels[0].part].scale ?? 1).toBe(1);
      // The physics radius may NOT follow the marker down to 2 cm — it is the ide half-diameter.
      expect(built.wheels[0].radius).toBeCloseTo(0.5, 5);
    });

    it('an orphan vertex no triangle references cannot inflate the wheel radius (the coach wheel_lf case)', () => {
      // Same triangle as `geometry()` plus one corrupt UNREFERENCED vertex — the real coach.dff ships one
      // at ~5.8e25 on wheel_lf, which read as the authored radius and scaled that wheel to nothing.
      const poisoned: RWGeometry = {
        ...geometry(),
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5.8e25, 2.5e7, 0]),
      };
      const built = buildVehicleModel(
        clump(
          [
            frame('chassis'),
            frame('wheel'),
            frame('wheel_lf_dummy', -1, [1, 2, 0]),
            frame('wheel_rf_dummy', -1, [-1, 2, 0]),
          ],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 1 },
          ],
          [geometry(), poisoned],
        ),
        textures(),
        { wheelScale: [0.8, 0.8] },
      );

      for (const wheel of built.wheels) {
        expect(wheel.radius).toBeCloseTo(0.4, 5);
        expect(built.parts[wheel.part].scale).toBeCloseTo(0.4, 5);
      }
    });

    it('`_dam` twins ride the same buffers as hidden submeshes, paired to their `_ok` by damage group', () => {
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('bonnet_ok'), frame('bonnet_dam')],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 0 },
            { frame: 2, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      const bonnet = built.submeshes.filter((submesh) => submesh.damageGroup === 'bonnet');
      expect(bonnet.map((submesh) => submesh.kind).sort()).toEqual(['body', 'dam']);
      // Both states hang off ONE part, so damage is a pure visibility flip — no re-parenting, no re-upload.
      expect(new Set(bonnet.map((submesh) => submesh.part)).size).toBe(1);
    });

    it('`_vlo` meshes come through as `lod` submeshes (the extractor used to drop them)', () => {
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('chassis_vlo')],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      expect(built.submeshes.filter((submesh) => submesh.kind === 'lod')).toHaveLength(1);
      expect(built.submeshes.filter((submesh) => submesh.kind === 'body')).toHaveLength(1);
    });

    it('a door sits on its HINGE frame and the _ok frame own transform is DISCARDED (SA collapses it)', () => {
      const built = buildVehicleModel(
        clump(
          // The dummy hangs under the root, as every real export authors it — a ROOT's own transform is
          // SA-owned (the entity matrix replaces it) and never contributes.
          [frame('chassis'), frame('door_lf_dummy', 0, [1, 0, 0]), frame('door_lf_ok', 1, [0.5, 0, 0])],
          [
            { frame: 0, geometry: 0 },
            { frame: 2, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      expect(built.doors).toEqual([{ name: 'door_lf', part: 1, side: 'lf' }]);
      expect(built.doors[0].parts).toBeUndefined(); // one atomic under the hinge = the stock shape, no roster
      const door = built.parts[1];
      expect(door.localTranslation).toEqual([1, 0, 0]); // the hinge dummy — NOT the door's own frame
      expect(door.offset).toBeUndefined(); // the 0.5 m on `door_lf_ok` is the frame SA destroys
    });

    it('every submesh carries its part-local AABB — the translucent sort keys on the nearest extent', () => {
      // `center − radius` counted a scattered submesh as nearer than the window sheet in front of it and
      // the cabin drew OVER the glass; the AABB is what the runtime clamps the eye into instead.
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry()]), textures());

      const submesh = built.submeshes[0];
      expect(submesh.bounds).toBeDefined();
      // The helper geometry's vertices: (0,0,0), (1,0,0), (0,1,0).
      expect(submesh.bounds!.min).toEqual([0, 0, 0]);
      expect(submesh.bounds!.max).toEqual([1, 1, 0]);
    });

    it('a translucent material spanning separate pieces becomes one submesh PER piece — each with its own AABB', () => {
      // The comet's `dials`: dash gauges + rear-shelf speakers on one material. One submesh has no honest
      // sort key (its box's nearest point is the dash from the front, so the speakers drew over the rear
      // quarter glass); split, each piece sorts by where IT is. An opaque material is never split.
      const scattered = (alpha: number): RWGeometry => ({
        ...geometry([material({ color: [200, 200, 200, alpha] })]),
        positions: new Float32Array([0, 0.4, 0, 0.1, 0.4, 0, 0, 0.5, 0, 0, -1.4, 0, 0.1, -1.4, 0, 0, -1.3, 0]),
        triangles: [
          { a: 0, b: 1, c: 2, materialIndex: 0 },
          { a: 3, b: 4, c: 5, materialIndex: 0 },
        ],
      });

      const glass = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [scattered(120)]),
        textures(),
      );
      const opaque = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [scattered(255)]),
        textures(),
      );

      expect(opaque.submeshes).toHaveLength(1);
      expect(glass.submeshes).toHaveLength(2);
      expect(glass.submeshes.every((submesh) => submesh.translucent)).toBe(true);
      const boxes = glass.submeshes.map((submesh) => submesh.bounds!).sort((a, b) => a.min[1] - b.min[1]);
      expect(boxes[0].min[1]).toBeCloseTo(-1.4);
      expect(boxes[0].max[1]).toBeCloseTo(-1.3);
      expect(boxes[1].min[1]).toBeCloseTo(0.4);
      expect(boxes[1].max[1]).toBeCloseTo(0.5);
    });

    it('a door collects every part under its hinge frame — a mod glass atomic swings with it', () => {
      // The comet authors `glass_lf_ok` as its own atomic beside `door_lf_ok`, both under `door_lf_dummy`.
      // SA rotates the dummy's frame, so the whole subtree travels; the door therefore carries a part
      // roster, and the chassis (outside the subtree) stays off it.
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('door_lf_dummy', 0, [1, 0, 0]), frame('door_lf_ok', 1), frame('glass_lf_ok', 1)],
          [
            { frame: 0, geometry: 0 },
            { frame: 2, geometry: 0 },
            { frame: 3, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      const door = built.doors[0];
      const glass = built.parts.findIndex((part) => part.name === 'glass_lf_ok');
      expect(door.parts).toBeDefined();
      expect(door.parts).toContain(door.part);
      expect(door.parts).toContain(glass);
      expect(door.parts).not.toContain(0);
    });

    it('a scissor door keeps the ROTATED hinge above the dummy — the swing axis comes from it', () => {
      // The 1995 Diablo's layout: a rotated `door_lf` above the dummy (its local Z points along world +X,
      // which is what makes the door swing UP), and 1.5 m parked on the `_ok` frame that SA throws away.
      const hinge = frame('door_lf', 0, [-0.9, 1.2, 0.1]);
      hinge.rotation = [0, -1, 0, 0, 0, -1, 1, 0, 0];
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), hinge, frame('door_lf_dummy', 1), frame('door_lf_ok', 2, [-1.24, 0.87, 0])],
          [
            { frame: 0, geometry: 0 },
            { frame: 3, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      const door = built.parts[1];
      expect(door.localTranslation.map((v) => Number(v.toFixed(3)))).toEqual([-0.9, 1.2, 0.1]);
      expect(door.offset).toBeUndefined();
      // The pivot keeps the rotated basis, so a rotation about its local Z is a VERTICAL swing.
      expect(door.localRotation.some((v) => Math.abs(v) > 1e-6)).toBe(true);
    });

    it('carries the DFF reflection settings per vertex (coefficient, intensity, specular)', () => {
      const reflective = material({
        effects: {
          envMap: { coefficient: 1, texture: 'xvehicleenv128', useFrameBufferAlpha: false },
          reflection: { intensity: 0.09, offset: [1, 1], scale: [1, 1] },
          specular: { level: 0.18, texture: 'vehiclespecdot64' },
        },
      });
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([reflective])]),
        textures(),
      );

      expect(built.reflect[0]).toBe(0); // slot 0 is spare — nothing samples the DFF's env texture
      expect(built.reflect[1]).toBe(255); // coefficient 1
      expect(built.reflect[2]).toBe(Math.round(0.09 * 255));
      expect(built.reflect[3]).toBe(Math.round(0.18 * 255));
    });

    it('a coefficient of 0 means NOT reflective — SA leaves the plugin on wheels and tyres', () => {
      const matte = material({
        effects: {
          envMap: { coefficient: 0, texture: null, useFrameBufferAlpha: false },
          reflection: { intensity: 0, offset: [1, 1], scale: [1, 1] },
        },
      });
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([matte])]),
        textures(),
      );

      expect([...built.reflect.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    });

    it('an env map zeroed to 0 wins over a strong reflection plugin — it IS the tyre marker', () => {
      const tyre = material({
        effects: {
          envMap: { coefficient: 0, texture: 'vehicleenvmap128', useFrameBufferAlpha: false },
          reflection: { intensity: 0.5, offset: [1, 1], scale: [1, 1] },
        },
      });
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([tyre])]),
        textures(),
      );

      expect([...built.reflect.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    });

    it('SA reflection + specular with NO env map is reflective — the exhaust / bare-trim shape', () => {
      const exhaust = material({
        color: [51, 51, 51, 255],
        effects: {
          reflection: { intensity: 0.5, offset: [1, 1], scale: [1, 1] },
          specular: { level: 0.17, texture: 'vehiclespecdot64' },
        },
      });
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([exhaust])]),
        textures(),
      );

      expect(built.reflect[0]).toBe(0); // no env map named, and the shader reflects the live probe anyway
      expect(built.reflect[1]).toBe(Math.round(0.5 * 255)); // the plugin's intensity becomes the coefficient
      expect(built.reflect[3]).toBe(Math.round(0.17 * 255));
    });

    it('a lone corner wheel with real dummies is a MIS-NAMED shared wheel (the comet case)', () => {
      const built = buildVehicleModel(
        clump(
          [
            frame('chassis'),
            frame('wheel_rf'),
            frame('wheel_lf_dummy', -1, [1, 2, 0]),
            frame('wheel_rf_dummy', -1, [-1, 2, 0]),
          ],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      // Instanced at BOTH dummies rather than rendered once at its own corner.
      expect(built.wheels).toHaveLength(2);
    });

    it('a `f_wheel` container wheel is its whole CHOSEN PATH — tyre + rim, not the first atomic', () => {
      // The alfamodding cabbie's shape: `f_wheel_1111 → f_extras:2 → (tire:1 → tire, tirew) (rim:1 →
      // hubcap, stamp)`. `:2` shows two groups, each bare group shows its FIRST child; the tyre band is
      // judged against the whole wheel's radius so a hub cap's own outer ring never passes for rubber.
      const tyre = geometry([material({ color: [10, 10, 10, 255] })]);
      tyre.positions = new Float32Array([0, 1, 0, 0.2, 0, 1, 0, 0.95, 0.1]);
      const hubcap = geometry([material({ color: [200, 200, 200, 255] })]);
      hubcap.positions = new Float32Array([0, 0.5, 0, 0.1, 0, 0.5, 0, 0.45, 0.05]);
      const built = buildVehicleModel(
        clump(
          [
            frame('chassis'),
            frame('f_wheel_1111', 0, [1, 2, 0]),
            frame('f_extras:2', 1),
            frame('tire:1', 2),
            frame('tire', 3),
            frame('tirew', 3),
            frame('rim:1', 2),
            frame('hubcap', 6),
            frame('stamp', 6),
            frame('wheel_lf_dummy', 0, [-1, 2, 0]),
            frame('wheel_rf_dummy', 0, [1, 2, 0]),
          ],
          [
            { frame: 0, geometry: 0 },
            { frame: 4, geometry: 1 },
            { frame: 5, geometry: 1 },
            { frame: 7, geometry: 2 },
            { frame: 8, geometry: 2 },
          ],
          [geometry(), tyre, hubcap],
        ),
        textures(),
        { wheelScale: [1, 1] },
      );

      expect(built.wheels).toHaveLength(2);
      for (const wheel of built.wheels) {
        const submeshes = built.submeshes.filter((submesh) => submesh.part === wheel.part);

        expect(submeshes).toHaveLength(2); // tire + hubcap — never tirew/stamp, never the tyre alone
        expect(submeshes.map((submesh) => submesh.tyre === true)).toEqual([true, false]);
      }
      // Fitted as ONE solid: the tyre's radius (1 m) sets the scale, the hub cap does not shrink it.
      expect(built.parts[built.wheels[0].part].scale).toBeCloseTo(0.5, 5);
      // The container is never body geometry.
      expect(built.parts.filter((part) => /^(?:tire|hubcap|f_)/.test(part.name))).toHaveLength(0);
    });

    it("bakes a chosen mesh's own frame offset below the container root into wheel-local space", () => {
      const built = buildVehicleModel(
        clump(
          [
            frame('chassis'),
            frame('f_wheel_1111', 0, [1, 2, 0]),
            frame('cap', 1, [0.1, 0, 0]),
            frame('wheel_rf_dummy', 0, [1, 2, 0]),
          ],
          [
            { frame: 0, geometry: 0 },
            { frame: 2, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );
      const wheel = built.submeshes.find((submesh) => submesh.part === built.wheels[0].part)!;

      // The container's own placement is the dummy's job; only the chain BELOW it moves the vertices.
      expect(built.positions[built.indices[wheel.indexOffset] * 3]).toBeCloseTo(0.1, 5);
    });

    it('tags the two license-plate faces by their placeholder textures (082/02)', () => {
      const plated = geometry([
        material({ texture: { maskName: '', name: 'carpback' }, textured: true }),
        material({ texture: { maskName: '', name: 'carplate' }, textured: true }),
        material({ texture: { maskName: '', name: 'chassis' }, textured: true }),
      ]);
      plated.triangles = [
        { a: 0, b: 1, c: 2, materialIndex: 0 },
        { a: 0, b: 1, c: 2, materialIndex: 1 },
        { a: 0, b: 1, c: 2, materialIndex: 2 },
      ];
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [plated]), textures());

      // One submesh per material already — the tag is all that was missing, not a regroup.
      expect(built.submeshes.map((submesh) => submesh.plate)).toEqual(['back', 'face', undefined]);
    });

    it('does NOT tag a plate on the `_vlo` LOD mesh — nobody can read it past the swap', () => {
      const plated = geometry([material({ texture: { maskName: '', name: 'carplate' }, textured: true })]);
      const built = buildVehicleModel(clump([frame('chassis_vlo')], [{ frame: 0, geometry: 0 }], [plated]), textures());

      // Tagging it would buy a per-instance texture binding for a quad that is a fraction of a pixel.
      // The builder already de-features LOD the same way by forcing it MATTE.
      expect(built.submeshes[0].kind).toBe('lod');
      expect(built.submeshes[0].plate).toBeUndefined();
      expect(built.meta[3] >> 4).toBe(MaterialClass.matte);
    });

    it('writes the plate material CLASS into meta.w — the only channel the shader can read it from', () => {
      const plated = geometry([
        material({ texture: { maskName: '', name: 'carpback' }, textured: true }),
        material({ texture: { maskName: '', name: 'carplate' }, textured: true }),
      ]);
      plated.triangles = [
        { a: 0, b: 1, c: 2, materialIndex: 0 },
        { a: 0, b: 1, c: 2, materialIndex: 1 },
      ];
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [plated]), textures());

      // The rigid vertex output stands at 15 of WebGPU's 16 inter-stage locations, so a plate could not
      // have a signal of its own — the high nibble of meta.w IS the contract with `rigidTexel` (082/03).
      const classOf = (submesh: number): number =>
        built.meta[built.indices[built.submeshes[submesh].indexOffset] * 4 + 3] >> 4;
      expect(classOf(0)).toBe(MaterialClass.plateBack);
      expect(classOf(1)).toBe(MaterialClass.plateFace);
    });

    it('matches the plate textures case-insensitively, as the DFF names them either way', () => {
      const plated = geometry([material({ texture: { maskName: '', name: 'CarPlate' }, textured: true })]);
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [plated]), textures());

      expect(built.submeshes[0].plate).toBe('face');
    });
  });
});

// The engine-side builder must agree with its three twin (`three/build-vehicle.test.ts`, which already runs on
// these files) — a synthetic clump only ever re-states this module's own assumptions about SA's conventions.
const ADMIRAL = 'fixtures/original/dff/vehicle/admiral.dff';
const ADMIRAL_TXD = 'fixtures/original/vehicles/admiral.txd';
const GENERIC_TXD = 'fixtures/original/models/generic/vehicle.txd';

describe.skipIf(!existsSync(ADMIRAL) || !existsSync(GENERIC_TXD))('buildVehicleModel (real admiral.dff)', () => {
  const built = buildVehicleModel(
    parseDff(toArrayBuffer(readFileSync(ADMIRAL))),
    new VehicleTextures([toArrayBuffer(readFileSync(ADMIRAL_TXD)), toArrayBuffer(readFileSync(GENERIC_TXD))]),
    { wheelScale: [0.7, 0.7] },
  );

  describe('positive cases', () => {
    it('builds identically when the clump ROOT matrix is poisoned (the comet anti-rip lock)', () => {
      // The lock plants garbage in the one matrix SA never reads (the entity matrix replaces the root's on
      // attach): rotation[0][0] = −3.9e14. Composing it flung every off-centre part to ±1e14 — invisible
      // car, live collision. The builder must produce the same model with and without the poison.
      const poisoned = parseDff(toArrayBuffer(readFileSync(ADMIRAL)));
      const root = poisoned.frames.findIndex((frame) => frame.parentIndex === -1);
      poisoned.frames[root].rotation = [-3.9e14, 0, 0, 0, 1, 0, 0, 0, 1];
      poisoned.frames[root].position = [7e13, -1, 2];

      const rebuilt = buildVehicleModel(
        poisoned,
        new VehicleTextures([toArrayBuffer(readFileSync(ADMIRAL_TXD)), toArrayBuffer(readFileSync(GENERIC_TXD))]),
        { wheelScale: [0.7, 0.7] },
      );

      expect(rebuilt.positions).toEqual(built.positions);
      expect(rebuilt.parts.map((part) => part.localTranslation)).toEqual(
        built.parts.map((part) => part.localTranslation),
      );
    });

    it('builds the full stock rig: 4 wheels, 4 doors, and the lamp dummies', () => {
      expect(built.wheels).toHaveLength(4);
      expect(built.wheels.filter((wheel) => wheel.front)).toHaveLength(2);
      // SA names the REAR doors `lr`/`rr` but the rear WHEELS `lb`/`rb` — two conventions in one file.
      expect(built.doors.map((door) => door.side).sort()).toEqual(['lf', 'lr', 'rf', 'rr']);
      const dummies = built.dummies.map((dummy) => dummy.name);
      expect(dummies).toContain('headlights');
      expect(dummies).toContain('taillights');
    });

    it('tags BOTH lamp ends — head at the front, tail at the rear', () => {
      const lamps = new Set(built.submeshes.map((submesh) => submesh.lamp).filter(Boolean));

      expect(lamps).toEqual(new Set(['head', 'tail']));
    });

    it('occludes the bottom of the car and leaves the roof open to the sky', () => {
      // The night set's alpha is the self-occlusion (`sky-occlusion.ts`), and the claim is about SHAPE, so
      // the probe is the shape: of the UP-FACING vertices, the highest tenth (roof) sees the sky and the
      // lowest tenth (floor pans under that roof) is enclosed. Down- and side-facing vertices are excluded:
      // their darkening is the shader's `skyVisibility(normal)` term, not the bake's — a vertex barely
      // facing the azimuth fan reads open here by design (085, the comet door smudges).
      const heights: { alpha: number; z: number }[] = [];
      for (let vertex = 0; vertex < built.positions.length / 3; vertex += 1) {
        if (built.normals[vertex * 3 + 2] < 0.5) {
          continue;
        }
        heights.push({ alpha: built.night[vertex * 4 + 3], z: built.positions[vertex * 3 + 2] });
      }
      heights.sort((left, right) => left.z - right.z);
      const tenth = Math.floor(heights.length / 10);
      const mean = (values: { alpha: number }[]): number =>
        values.reduce((sum, value) => sum + value.alpha, 0) / values.length;
      const bottom = mean(heights.slice(0, tenth));
      const top = mean(heights.slice(-tenth));

      expect(bottom).toBeLessThan(top * 0.75);
      expect(top).toBeGreaterThan(200); // a roof is open sky by definition
    });

    it('finds the tyre on every real wheel and silences only that', () => {
      const wheelParts = new Set(built.wheels.map((wheel) => wheel.part));
      const wheelSubmeshes = built.submeshes.filter((submesh) => wheelParts.has(submesh.part));
      const tyres = wheelSubmeshes.filter((submesh) => submesh.tyre);
      const coefficient = (submesh: (typeof tyres)[number]): number =>
        built.reflect[built.indices[submesh.indexOffset] * 4 + 1];

      // Every wheel finds its rubber (the stock admiral authors TWO tyre materials on each), and the whole
      // of it is silenced. The rim is not asserted here: this model authors no reflection on it at all.
      expect(new Set(tyres.map((submesh) => submesh.part))).toEqual(wheelParts);
      expect(new Set(tyres.map(coefficient))).toEqual(new Set([0]));
    });

    it('carries a real paint slot: the carcols markers are per-vertex, not baked colours', () => {
      const slots = new Set<number>();
      for (let at = 2; at < built.meta.length; at += 4) {
        slots.add(built.meta[at]);
      }

      // The stock admiral marks its PRIMARY colour only — a 2-colour entry in carcols.dat does NOT imply a
      // secondary marker in the DFF. The rest of the body is unpainted (slot 0) and keeps its own texture.
      expect(slots).toEqual(new Set([PaintSlot.none, PaintSlot.primary]));
    });

    it('the DFF ships env-map settings on the paint — the reflect channel is populated from the file', () => {
      let reflective = 0;
      for (let at = 1; at < built.reflect.length; at += 4) {
        if (built.reflect[at] > 0) {
          reflective += 1; // the COEFFICIENT is the reflective flag; slot 0 is spare
        }
      }

      expect(reflective).toBeGreaterThan(0);
    });

    it('pairs every `_dam` twin with its `_ok` body on ONE part (damage = a visibility flip)', () => {
      const damaged = built.submeshes.filter((submesh) => submesh.kind === 'dam');
      expect(damaged.length).toBeGreaterThan(0);
      for (const submesh of damaged) {
        const body = built.submeshes.find(
          (other) => other.kind === 'body' && other.damageGroup === submesh.damageGroup,
        );
        expect(body).toBeDefined();
        expect(body!.part).toBe(submesh.part);
      }
    });

    it('every index addresses a real vertex and no position is NaN (the upload invariant)', () => {
      const vertices = built.positions.length / 3;
      expect(vertices).toBeGreaterThan(0);
      for (const index of built.indices) {
        expect(index).toBeLessThan(vertices);
      }
      expect([...built.positions].every(Number.isFinite)).toBe(true);
    });

    it('tags both plate faces, on the intact body AND on the damaged twin (082/02)', () => {
      const plates = built.submeshes.filter((submesh) => submesh.plate);

      // The stock admiral wears a rear plate on the chassis and a front one on the bumper, and the bumper
      // ships an `_ok`/`_dam` pair — so the damage twin carries its own plate and the feature rides part
      // deformation with no attachment code. Every plate face is a 2-triangle quad.
      expect(plates.length).toBeGreaterThanOrEqual(4);
      expect(new Set(plates.map((submesh) => submesh.plate))).toEqual(new Set(['back', 'face']));
      expect(new Set(plates.map((submesh) => submesh.indexCount))).toEqual(new Set([6]));
      expect(plates.some((submesh) => submesh.kind === 'dam')).toBe(true);
      expect(plates.every((submesh) => submesh.translucent === false)).toBe(true);
    });

    it('pairs each plate face with a background on the same part', () => {
      const byPart = new Map<number, Set<string>>();
      for (const submesh of built.submeshes) {
        if (submesh.plate) {
          byPart.set(submesh.part, (byPart.get(submesh.part) ?? new Set()).add(submesh.plate));
        }
      }

      expect(byPart.size).toBeGreaterThan(0);
      for (const [, faces] of byPart) {
        expect(faces).toEqual(new Set(['back', 'face']));
      }
    });
  });
});

/**
 * The wheel-side conventions, on real models — the four shapes SA and its mods actually ship. Each was
 * rendering its far-side wheels facing INWARD: the shared-atomic path spun the wrong side, and the per-corner
 * path never spun at all (the field pair was admiral with both axles wrong and comet with the driver side).
 * The invariant every one of them pins: the copies on the side the mesh was NOT authored on carry the flip,
 * and the copies on the authored side mount exactly as modelled.
 */
const CONVENTIONS: { atomics: string; file: string; name: string; wheels: number }[] = [
  { atomics: 'a shared `wheel` atomic', file: ADMIRAL, name: 'admiral (stock)', wheels: 4 },
  {
    atomics: 'a LONE `wheel_rf` corner atomic',
    file: 'fixtures/custom/dff/vehicle/comet.dff',
    name: 'comet',
    wheels: 4,
  },
  {
    atomics: '4 per-corner atomics',
    file: 'fixtures/custom/dff/vehicle/petro-4wheels.dff',
    name: 'petro 4',
    wheels: 4,
  },
  {
    atomics: '6 per-corner atomics + a shared `wheel`',
    file: 'fixtures/custom/dff/vehicle/petro-6wheels.dff',
    name: 'petro 6',
    wheels: 6,
  },
];

describe('buildVehicleModel (wheel side, real models)', () => {
  describe('positive cases', () => {
    for (const convention of CONVENTIONS) {
      it.skipIf(!existsSync(convention.file))(`${convention.name} — ${convention.atomics}`, () => {
        const built = buildVehicleModel(
          parseDff(toArrayBuffer(readFileSync(convention.file))),
          new VehicleTextures([]),
          { wheelScale: [0.7, 0.7] },
        );

        expect(built.wheels).toHaveLength(convention.wheels);
        // `vehicles.ide`'s wheel field (or the modloader `.settings.txt` line, same field) is the ONLY
        // truth for wheel size, and it is a DIAMETER IN METRES: every stock mesh is already authored at its
        // target, so fitting lands near 1. Multiplying by it instead shrank every wheel by a third.
        for (const wheel of built.wheels) {
          expect(wheel.radius * 2).toBeCloseTo(0.7, 3); // fitted to the requested diameter, whatever the mesh
          expect(built.parts[wheel.part].scale ?? 1).toBeGreaterThan(0.5);
          expect(built.parts[wheel.part].scale ?? 1).toBeLessThan(1.5);
        }
        // Every model measured authors its wheel on the RIGHT, so the left copies — and only they — flip.
        for (const wheel of built.wheels) {
          const part = built.parts[wheel.part];
          const left = part.name.startsWith('wheel_l');

          expect({ name: part.name, rotation: part.localRotation }).toEqual({
            name: part.name,
            rotation: left ? [0, 0, 1, 0] : [0, 0, 0, 1],
          });
        }
      });
    }

    it.skipIf(!existsSync('fixtures/custom/dff/vehicle/petro-6wheels.dff'))(
      "ships all SIX of a real model's extras, each tagged with its own frame",
      () => {
        const built = buildVehicleModel(
          parseDff(toArrayBuffer(readFileSync('fixtures/custom/dff/vehicle/petro-6wheels.dff'))),
          new VehicleTextures([]),
        );
        const tagged = new Set(built.submeshes.map((submesh) => submesh.extra).filter(Boolean));

        // The choice is the spawn's, so the MODEL must carry every alternative — a build-time pick would
        // freeze one of these six into the pak for every petro in the world.
        expect([...tagged].sort()).toEqual(['extra1', 'extra2', 'extra3', 'extra4', 'extra5', 'extra6']);
        expect(built.parts.filter((part) => part.name.startsWith('extra'))).toHaveLength(6);
      },
    );

    it.skipIf(!existsSync('fixtures/custom/dff/vehicle/petro-6wheels.dff'))(
      'silences the tyre and leaves the rim reflective — the model that was caught glinting',
      () => {
        // This fixture is why the rule exists: all six of its wheels author the tyre with a FULL env map
        // (`xvehicleenv128`, coefficient 1) plus specular, so rubber rendered as reflective as chrome.
        const built = buildVehicleModel(
          parseDff(toArrayBuffer(readFileSync('fixtures/custom/dff/vehicle/petro-6wheels.dff'))),
          new VehicleTextures([]),
        );
        const wheelSubmeshes = built.submeshes.filter((submesh) => built.parts[submesh.part].name.startsWith('wheel_'));
        const coefficient = (submesh: (typeof wheelSubmeshes)[number]): number =>
          built.reflect[built.indices[submesh.indexOffset] * 4 + 1];
        const tyres = wheelSubmeshes.filter((submesh) => submesh.tyre);
        const rims = wheelSubmeshes.filter((submesh) => !submesh.tyre);

        expect(tyres.length).toBe(12); // two tyre materials on each of the six wheels
        expect(new Set(tyres.map(coefficient))).toEqual(new Set([0]));
        expect(Math.max(...rims.map(coefficient))).toBe(255); // the rim keeps every bit of what it authored
      },
    );

    it.skipIf(!existsSync('fixtures/custom/dff/vehicle/petro-6wheels.dff'))('covers the middle axle too', () => {
      const built = buildVehicleModel(
        parseDff(toArrayBuffer(readFileSync('fixtures/custom/dff/vehicle/petro-6wheels.dff'))),
        new VehicleTextures([]),
        { wheelScale: [1, 1] },
      );
      const names = built.wheels.map((wheel) => built.parts[wheel.part].name).sort();

      expect(names.filter((name) => /_[lr]m/.test(name))).toHaveLength(2);
      expect(built.wheels.filter((wheel) => wheel.front)).toHaveLength(2); // `m` and `b` are not front axles
    });
  });
});

const ZR350 = 'fixtures/original/vehicles/zr350.dff';
const ZR350_TXD = 'fixtures/original/vehicles/zr350.txd';

describe.skipIf(!existsSync(ZR350) || !existsSync(GENERIC_TXD))('buildVehicleModel (real zr350.dff)', () => {
  const built = buildVehicleModel(
    parseDff(toArrayBuffer(readFileSync(ZR350))),
    new VehicleTextures([toArrayBuffer(readFileSync(ZR350_TXD)), toArrayBuffer(readFileSync(GENERIC_TXD))]),
    { wheelScale: [0.7, 0.7] },
  );

  describe('positive cases', () => {
    it('finds the ONE stock pop-up pod and reads its parked pitch as the open angle', () => {
      // The zr350 is the only car in the stock fleet whose `misc_*` holds head-lamp faces; the pod is
      // authored looking 40° down into the nose, which is exactly how far it has to swing.
      expect(built.parts[built.popUpLights!.part].name).toBe('misc_a');
      expect((built.popUpLights!.angle * 180) / Math.PI).toBeCloseTo(40.4, 1);
    });
  });
});

const CABBIE = 'fixtures/original/vehicles/cabbie-container-wheel.dff';

describe.skipIf(!existsSync(CABBIE))('buildVehicleModel (real cabbie — f_wheel container, chosen path)', () => {
  const built = buildVehicleModel(parseDff(toArrayBuffer(readFileSync(CABBIE))), textures(), {
    wheelScale: [0.757, 0.757],
  });

  describe('positive cases', () => {
    it('every wheel is tyre + hub cap, the tyre silenced and the cap left reflective (field 2026-08-17)', () => {
      expect(built.wheels).toHaveLength(4);
      for (const wheel of built.wheels) {
        const submeshes = built.submeshes.filter((submesh) => submesh.part === wheel.part);

        // `f_extras:2 → tire:1 → tire` + `rim:1 → hubcap`: two meshes, several materials, both kinds present.
        expect(submeshes.some((submesh) => submesh.tyre)).toBe(true);
        expect(submeshes.some((submesh) => !submesh.tyre)).toBe(true);
        expect(wheel.radius * 2).toBeCloseTo(0.757, 3);
      }
    });

    it('ships the VehFuncs tree and tags every option mesh; the chassis and the wheels stay untagged', () => {
      const variants = built.variants!;

      // `f_class:1` → YCC?c1 / BAC?c2 / WBC?c3 / RURAL?c0?c4 (city classes; conditions carried verbatim).
      expect(variants.classes).toHaveLength(1);
      expect(variants.classes[0].children.map((child) => `${child.name}?${child.condition}`)).toEqual([
        'ycc?c1',
        'bac?c2',
        'wbc?c3',
        'rural?c0?c4',
      ]);
      // `f_extras:10` on the chassis + the boot's / rear bumper's own containers.
      const chassisExtras = variants.extras.find((node) => node.select[0] === 10)!;
      expect(chassisExtras.children.map((child) => child.name)).toEqual([
        'ac',
        'adv_int',
        'adv_roof',
        'bags',
        'int',
        'easter',
        'rubbish',
        'seats',
        'stickers',
        'trunkbay',
      ]);
      expect(chassisExtras.children.find((child) => child.name === 'int')!.select).toEqual([0, 1]);
      const advRoof = chassisExtras.children.find((child) => child.name === 'adv_roof')!;
      expect(advRoof.children.map((child) => child.requires)).toEqual([['ycc'], ['bac'], ['rural'], ['wbc']]);

      const tagged = built.submeshes.filter((submesh) => submesh.variant !== undefined);
      const untagged = built.submeshes.filter((submesh) => submesh.variant === undefined);
      expect(tagged.length).toBeGreaterThan(0);
      expect(untagged.some((submesh) => built.parts[submesh.part].name === 'chassis')).toBe(true);
      const wheelParts = new Set(built.wheels.map((wheel) => wheel.part));
      expect(tagged.some((submesh) => wheelParts.has(submesh.part))).toBe(false);
      // Every tag names a node of the shipped tree — the runtime resolves visibility against it alone.
      const ids = new Set<string>();
      const collect = (node: (typeof variants.extras)[number]): void => {
        ids.add(node.id);
        node.children.forEach(collect);
      };
      variants.extras.forEach(collect);
      expect(tagged.every((submesh) => ids.has(submesh.variant!))).toBe(true);
    });
  });
});

// Nothing in the stock vehicle/prop set animates its UVs, so the binding can only be proven on a mod: the
// Pacific Park ferris wheel's light ring is the asset plan 099 exists for.
const FERRIS_LIGHTS = 'fixtures/original/mods/ferriswheel_lights.dff';

describe.skipIf(!existsSync(FERRIS_LIGHTS))('buildVehicleModel (real ferriswheel_lights.dff)', () => {
  const built = buildVehicleModel(parseDff(toArrayBuffer(readFileSync(FERRIS_LIGHTS))), textures());

  describe('positive cases', () => {
    it("carries the mod's authored blink: the `f13d` film strip, on the `Frames` submesh alone", () => {
      const animated = built.submeshes.filter((submesh) => submesh.uvAnim !== undefined);

      expect(built.uvAnimations?.map((animation) => animation.name)).toEqual(['f13d']);
      expect(animated).toHaveLength(1);
      expect(animated[0].uvAnim).toBe(0);
    });

    it('keeps the keyframes verbatim — a 13-frame strip stepping every 0.225 s over a 29.25 s loop', () => {
      const f13d = built.uvAnimations![0];
      // Paired keyframes at the same timestamp are how a STEP animation is authored: the pair holds the
      // frame, then jumps `1/13` of the strip. 130 steps × 2 + the closing key = 261.
      expect(f13d.duration).toBeCloseTo(29.25, 4);
      expect(f13d.keyframes).toHaveLength(261);
      expect(f13d.keyframes[1].time).toBeCloseTo(0.225, 4);
      expect(f13d.keyframes[2].time).toBeCloseTo(0.225, 4);
      expect(f13d.keyframes[2].uv[4] - f13d.keyframes[1].uv[4]).toBeCloseTo(1 / 13, 4);
    });
  });
});
