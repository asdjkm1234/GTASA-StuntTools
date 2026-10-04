import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readRw } from '@opensa/rw-codec/chunk';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { geometryBodyHasTranslucency, geometryBodyHasWindowPane } from '../materials';
import { extractCarTemplate, toArrayBuffer } from '../template';
import { convertCar } from './car';
import { type ClumpModel, readClump, writeClump } from './clump-io';
import { IDENTITY_ROTATION } from './matrix';

const CS_BOBCAT = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csbobcat92.dff'));
const CS_TAXI = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/cstaxi92.dff'));
const CS_ZR350 = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/cszr350.dff'));
const BOBCAT = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/bobcat.dff'));
const TAXI = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/taxi.dff'));
const ZR350 = new Uint8Array(readFileSync('fixtures/original/vehicles/zr350.dff'));

function frameByName(model: ClumpModel, name: string): ClumpModel['frames'][number] | undefined {
  return model.frames.find((frame) => frame.name === name);
}

/** A stock-shaped mod with the named frames neutralized (renamed + their meshes detached) — the
 *  negative-case donor. */
function without(donor: Uint8Array, names: string[]): Uint8Array {
  const model = readClump(donor);
  for (const name of names) {
    const index = model.frames.findIndex((frame) => frame.name === name);
    if (index >= 0) {
      model.frames[index].name = `gone_${name}`;
      model.atomics = model.atomics.filter((atomic) => atomic.frameIndex !== index);
    }
  }

  return writeClump(model);
}

describe('convertCar', () => {
  describe('negative cases', () => {
    it('throws when the mod has no chassis mesh', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      expect(() => convertCar(without(BOBCAT, ['chassis']), template)).toThrow('no chassis mesh');
    });

    it('throws when a wheel dummy the template needs is missing', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      expect(() => convertCar(without(BOBCAT, ['wheel_lb_dummy']), template)).toThrow('no wheel_lb_dummy');
    });

    it('throws when no wheel mesh hangs under the wheel dummies', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      expect(() => convertCar(without(BOBCAT, ['wheel']), template)).toThrow('no wheel mesh');
    });
  });

  describe('positive cases (the golden pairs: stock donor must reproduce the vanilla cutscene rig)', () => {
    it('bobcat: full part set, vanilla hierarchy verbatim, vanilla positions, 0.900 shift', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      const vanilla = readClump(CS_BOBCAT);
      const { dff, report } = convertCar(BOBCAT, template);
      const converted = readClump(dff);

      // extras are missing BY POLICY (plan 004 round 2): the '92 extras are scene furniture the anims
      // pose; a mod's spawn variants are semantically unrelated and one adopted rack was swung 50°
      // through the air by DESERT9.
      expect(report.missingInMod).toEqual(['extra1', 'extra2']);
      expect(report.shiftZ).toBeCloseTo(0.9, 2);
      expect(report.parts).toHaveLength(7);
      expect(report.droppedFromMod).toEqual(expect.arrayContaining(['chassis_vlo', 'door_lf_dam']));
      // The donor's windscreen has no template slot ('92 bodies bake glass into the chassis) — ADOPTED,
      // not dropped (a car without glass was gate 4's field finding) — along with ONE of the donor's
      // extras (SA shows at most one; extra2 is first in atomic order on this donor).
      expect(report.adoptedFromMod.sort()).toEqual(['extra2', 'windscreen_ok']);

      // Vanilla ids present in the emit survive as an ordered subsequence (the extras bones are gone
      // by policy; the adopted windscreen adds a fresh id).
      const vanillaKept = vanilla.frames[1]
        .hierarchy!.map((node) => node.id)
        .filter((id) => converted.frames.some((frame) => frame.boneId === id));
      const convertedIds = converted.frames[1].hierarchy!.map((node) => node.id);
      let matched = 0;
      for (const id of convertedIds) {
        if (id === vanillaKept[matched]) {
          matched += 1;
        }
      }
      expect(matched).toBe(vanillaKept.length);
      // EVERY adopted frame is renamed _ad — no anim channel may bind an adopted mesh (rounds 1+2).
      expect(converted.frames.find((frame) => frame.name === 'windscreen_ok_ad')?.boneId).toBeGreaterThanOrEqual(19);
      expect(converted.frames.some((frame) => frame.name === 'windscreen_ok')).toBe(false);
      expect(report.shimmed).not.toContain('door_lf_ok'); // identity delta needs no shim
      expect(converted.frames[1].name).toBe('bobcat_dummy');

      // Bone ids per frame name match vanilla for every SHARED frame (adopted ones are ours alone).
      const vanillaBones = new Map(vanilla.frames.filter((f) => f.name).map((f) => [f.name, f.boneId]));
      for (const frame of converted.frames.filter((f) => f.name && vanillaBones.has(f.name))) {
        expect(frame.boneId, frame.name).toBe(vanillaBones.get(frame.name));
      }

      // Every template frame carries the VANILLA local — the anims' bind pose (gate-4 lesson). The
      // donor's differing placement is baked into vertices instead; on this body-reusing pair only the
      // repositioned extras and the exhaust need it.
      for (const name of ['bonnet_ok', 'boot_ok', 'bump_front_ok', 'bump_rear_ok', 'door_lf_ok']) {
        const expected = frameByName(vanilla, name)!.position;
        const actual = frameByName(converted, name)!.position;
        for (const axis of [0, 1, 2]) {
          expect(actual[axis], `${name}[${axis}]`).toBeCloseTo(expected[axis], 3);
        }
      }
      expect(frameByName(converted, 'chassis')?.position[2]).toBeCloseTo(0.9, 3);
      expect(frameByName(converted, 'Box01')?.position[2]).toBeCloseTo(0.35, 3);
      expect(frameByName(converted, 'wheel03')?.rotation[0]).toBeCloseTo(-1, 4); // left mesh z-180

      // All four wheel atomics SHARE one geometry (vanilla duplicates it — ours is the smaller emission).
      const wheelFrames = new Set(
        converted.frames
          .map((frame, index) => ({ frame, index }))
          .filter(({ frame }) => frame.name.startsWith('wheel'))
          .map(({ index }) => index),
      );
      const wheelGeometries = new Set(
        converted.atomics.filter((atomic) => wheelFrames.has(atomic.frameIndex)).map((atomic) => atomic.geometryIndex),
      );
      expect(wheelGeometries.size).toBe(1);
      // 1 wheel + chassis + 7 parts + windscreen + 1 extra, plus 5 translucent twins split off the
      // mixed geometries (both doors, chassis, boot, extra2 embed 128/242-alpha glass — round 14).
      expect(converted.geometries).toHaveLength(16);

      // The converted DFF parses as a well-formed clump and keeps the mod's chassis geometry intact.
      const parsed = parseDff(toArrayBuffer(dff));
      const chassisGeometry = parsed.atomics.find(
        (atomic) => parsed.frames[atomic.frameIndex].name.trim() === 'chassis',
      );
      expect(parsed.geometries[chassisGeometry!.geometryIndex].positions.length / 3).toBe(1750);
    });

    it('taxi: _hi frame names emitted, vanilla ids kept, template-less exhaust + glass adopted', () => {
      const template = extractCarTemplate(CS_TAXI);
      const vanilla = readClump(CS_TAXI);
      const { dff, report } = convertCar(TAXI, template);
      const converted = readClump(dff);

      expect(report.missingInMod).toEqual([]);
      const vanillaIds = vanilla.frames[1].hierarchy!.map((node) => node.id);
      const convertedIds = converted.frames[1].hierarchy!.map((node) => node.id);
      let matched = 0;
      for (const id of convertedIds) {
        if (id === vanillaIds[matched]) {
          matched += 1;
        }
      }
      expect(matched).toBe(vanillaIds.length);
      expect(frameByName(converted, 'door_lr_hi_ok')?.boneId).toBe(15);
      expect(report.adoptedFromMod.sort()).toEqual(['exhaust_ok', 'windscreen_ok']);
      expect(frameByName(converted, 'exhaust_ok_ad')).toBeDefined(); // adopted = renamed, unbindable
      expect(report.droppedFromMod).not.toContain('exhaust_ok');
    });

    it('zr350: template parts the mod lacks drop out of the hierarchy, mod-only parts are dropped', () => {
      const template = extractCarTemplate(CS_ZR350);
      const { dff, report } = convertCar(ZR350, template);
      const converted = readClump(dff);

      expect(report.missingInMod.sort()).toEqual(['extra2', 'steering_wheel']);
      expect(report.droppedFromMod).toContain('chassis_vlo');
      expect(report.adoptedFromMod.sort()).toEqual(['extra1', 'misc_a']); // visible pods stay on the car
      expect(frameByName(converted, 'windscreen_ok')?.boneId).toBe(17);

      // Holes in the id sequence, contiguous indexes — the hand-made pack's precedent.
      const hierarchy = converted.frames[1].hierarchy!;
      expect(hierarchy.map((node) => node.index)).toEqual(hierarchy.map((_, at) => at));
      expect(hierarchy.some((node) => node.id === 15)).toBe(false); // extra2's bone is gone
      expect(hierarchy.some((node) => node.id === 16)).toBe(false); // steering_wheel's bone is gone
      expect(new Set(hierarchy.map((node) => node.id)).size).toBe(hierarchy.length);
    });

    it('glendale (single-frame wheels): one frame per corner, vanilla hierarchy verbatim', () => {
      const csGlendale = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csglendale92.dff'));
      const glendale = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/glendale.dff'));
      const template = extractCarTemplate(csGlendale);
      const vanilla = readClump(csGlendale);
      const { dff, report } = convertCar(glendale, template);
      const converted = readClump(dff);

      expect(report.missingInMod).toEqual([]);
      // Vanilla ids survive as an ordered subsequence (adopted bones land inside the chassis subtree,
      // BEFORE glendale's trailing wheel bones — DFS order, ids bind the anims, order is free).
      const vanillaIds = vanilla.frames[1].hierarchy!.map((node) => node.id);
      const convertedIds = converted.frames[1].hierarchy!.map((node) => node.id);
      let matched = 0;
      for (const id of convertedIds) {
        if (id === vanillaIds[matched]) {
          matched += 1;
        }
      }
      expect(matched).toBe(vanillaIds.length);
      // Single-style wheels: the mesh frame IS the corner frame, no node in between.
      const wheel = frameByName(converted, 'wheel03')!;
      expect(converted.frames[wheel.parentIndex].name).toBe('glendale');
      expect(wheel.rotation[0]).toBeCloseTo(-1, 4); // left mesh z-180 baked on the single frame
      expect(wheel.position[2]).toBeCloseTo(frameByName(vanilla, 'wheel03')!.position[2], 2);
    });

    it('monster (intermediate COG): the body frame is kept at its vanilla transform', () => {
      const csMonster = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csmonster.dff'));
      const monster = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/monster.dff'));
      const template = extractCarTemplate(csMonster);
      const vanilla = readClump(csMonster);
      const { dff, report } = convertCar(monster, template);
      const converted = readClump(dff);

      const vanillaKept = vanilla.frames[1]
        .hierarchy!.map((node) => node.id)
        .filter((id) => converted.frames.some((frame) => frame.boneId === id));
      const monsterIds = converted.frames[1].hierarchy!.map((node) => node.id);
      let keptMatched = 0;
      for (const id of monsterIds) {
        if (id === vanillaKept[keptMatched]) {
          keptMatched += 1;
        }
      }
      expect(keptMatched).toBe(vanillaKept.length);
      const cog = frameByName(converted, 'COG')!;
      expect(cog.position[2]).toBeCloseTo(1.2, 3);
      // The chassis may hang under a shim absorbing the donor delta — the chain still ends at COG.
      let chassisParent = converted.frames[frameByName(converted, 'chassis')!.parentIndex];
      if (chassisParent.name.endsWith('_pv')) {
        chassisParent = converted.frames[chassisParent.parentIndex];
      }
      expect(chassisParent.name).toBe('COG');
      // The mod's wheels sit under the COG (possibly through a shim) — ground contact preserved.
      const axis = frameByName(converted, 'axis_rf')!;
      let axisParent = converted.frames[axis.parentIndex];
      if (axisParent.name.endsWith('_pv')) {
        axisParent = converted.frames[axisParent.parentIndex];
      }
      expect(axisParent.name).toBe('COG');
      expect(report.parts).toContain('door_lf_ok');
    });

    it('copcarla (junk chassis transform): the mesh frame junk is destroyed, like the game does', () => {
      // Stock copcarla's `chassis` frame carries [0, 1.637, -0.35] under chassis_dummy — the gate-4
      // field regression: trusting it shifted the whole body and every part.
      const csCopcarla = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/cscopcarla92.dff'));
      const copcarla = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/copcarla.dff'));
      const template = extractCarTemplate(csCopcarla);
      const vanilla = readClump(csCopcarla);
      const { dff } = convertCar(copcarla, template);
      const converted = readClump(dff);

      const chassis = frameByName(converted, 'chassis')!;
      expect(chassis.position[0]).toBeCloseTo(0, 3);
      expect(chassis.position[1]).toBeCloseTo(0, 3); // the junk 1.637 never reaches the frame local
      for (const name of ['door_rf_ok', 'bump_front_ok', 'bonnet_ok']) {
        const expected = frameByName(vanilla, name)!.position;
        const actual = frameByName(converted, name)!.position;
        for (const axis of [0, 1, 2]) {
          expect(actual[axis], `${name}[${axis}]`).toBeCloseTo(expected[axis], 2);
        }
      }

      // The donor's chassis GEOMETRY is authored in the junk frame's space (the game keeps non-ok/dam
      // transforms) — the SHIM frame carries that junk, so the body lands where vanilla's body sits
      // while the bone keeps the vanilla local for the anims (gate-4 round 3 + gate-7 regression).
      const shim = frameByName(converted, 'chassis_pv')!;
      expect(shim.position[1]).toBeCloseTo(1.637, 2);
      expect(shim.position[2]).toBeCloseTo(-0.35, 1);
      expect(converted.frames[shim.parentIndex].name).toBe('copcarla');
    });

    it('keeps identity rotations identity through the emit path', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      const { dff } = convertCar(BOBCAT, template);
      const converted = readClump(dff);
      expect(frameByName(converted, 'Box01')?.rotation).toEqual([...IDENTITY_ROTATION]);
    });

    it('window panes render LAST and every atomic carries the vehicle Pipeline Set (plan 004 rounds 5+6)', () => {
      const { dff } = convertCar(BOBCAT, extractCarTemplate(CS_BOBCAT));
      const converted = readClump(dff);

      // Vanilla's own layout (windscreen_ok is the final atomic of every vanilla car): once a pane
      // atomic appears, only pane atomics follow — an early pane z-erases everything behind it.
      const paneFlags = converted.atomics.map((atomic) =>
        geometryBodyHasWindowPane(converted.geometries[atomic.geometryIndex].body),
      );
      expect(paneFlags.some(Boolean)).toBe(true);
      expect(paneFlags.slice(paneFlags.indexOf(true)).every(Boolean)).toBe(true);

      // Every NON-PANE atomic carries PipelineSet 0x53F2009A — lamp lenses included, the way gameplay
      // renders them — and only window panes stay on the DEFAULT pipeline (rounds 8 and 23; round 9's
      // wider rule measured our DFF stamp rather than the runtime pipe and cost the fleet its lamp
      // shine).
      expect(converted.atomics.some((_, index) => !paneFlags[index])).toBe(true);
      converted.atomics.forEach((atomic, index) => {
        const plugins = atomic.extension ? readRw(atomic.extension.body).chunks : [];
        const pipeline = plugins.find((chunk) => chunk.type === 0x253f2f3);
        if (paneFlags[index]) {
          expect(pipeline, `pane atomic ${index}`).toBeUndefined();
        } else {
          expect(pipeline?.data, `atomic ${index}`).toBeDefined();
          expect(new DataView(pipeline!.data!.buffer, pipeline!.data!.byteOffset, 4).getUint32(0, true)).toBe(
            0x53f2009a,
          );
        }
      });
    });

    it('securica (rotated-bone rig): un-animated frames carry identity rotation and the runtime pose stands upright (round 15)', () => {
      // The runtime law (HEIST8A, gta-reversed FrameUpdateCallBackNonSkinned): on an animated clump
      // EVERY frame's rotation is rewritten per tick — animated frames get the anim quaternion,
      // un-animated ones get IDENTITY (zero-quat Normalise); only the position snapshot survives.
      // cssecurica92 is the one rig whose vanilla bones carry 90-degree rotations, so a rotation left
      // in a shim/adopted frame stood the whole truck on its tail in game while the authored bind
      // pose looked perfect offline.
      const csSecurica = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/cssecurica92.dff'));
      const securica = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/securica.dff'));
      const vanilla = readClump(csSecurica);
      const { dff } = convertCar(securica, extractCarTemplate(csSecurica));
      const converted = readClump(dff);

      // No un-animated frame may carry rotation — the runtime erases it (the anims bind by NAME, and
      // only vanilla bone names have channels).
      const vanillaNames = new Set(vanilla.frames.map((frame) => frame.name.trim()).filter(Boolean));
      for (const frame of converted.frames) {
        if (frame.name && !vanillaNames.has(frame.name.trim())) {
          expect(frame.rotation, `${frame.name} must be identity-rotation`).toEqual([...IDENTITY_ROTATION]);
        }
      }

      // Replay the runtime law (anim value = the vanilla local, measured on heist8a.ifp): the truck
      // must stand upright — its height stays under the vanilla roofline, not its length upended.
      const vanillaLocals = new Map(
        vanilla.frames
          .filter((f) => f.name)
          .map((f) => [f.name.trim(), { position: f.position, rotation: f.rotation }]),
      );
      const worlds: { p: [number, number, number]; r: number[] }[] = [];
      const mulPoint = (w: { p: number[]; r: number[] }, v: [number, number, number]): [number, number, number] => [
        w.r[0] * v[0] + w.r[3] * v[1] + w.r[6] * v[2] + w.p[0],
        w.r[1] * v[0] + w.r[4] * v[1] + w.r[7] * v[2] + w.p[1],
        w.r[2] * v[0] + w.r[5] * v[1] + w.r[8] * v[2] + w.p[2],
      ];
      const mulRot = (a: number[], b: number[]): number[] => {
        const o = new Array<number>(9).fill(0);
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i + j * 3] += a[i + k * 3] * b[k + j * 3];

        return o;
      };
      converted.frames.forEach((frame) => {
        const law = vanillaLocals.get(frame.name.trim()) ?? {
          position: frame.position,
          rotation: [...IDENTITY_ROTATION],
        };
        const parent = frame.parentIndex >= 0 ? worlds[frame.parentIndex] : { p: [0, 0, 0], r: [...IDENTITY_ROTATION] };
        worlds.push({
          p: mulPoint(parent, law.position),
          r: mulRot(parent.r, law.rotation),
        });
      });
      let maxZ = -Infinity;
      const parsed = parseDff(toArrayBuffer(dff));
      for (const atomic of parsed.atomics) {
        const g = parsed.geometries[atomic.geometryIndex];
        const w = worlds[atomic.frameIndex];
        for (let vi = 0; vi < g.positions.length; vi += 3) {
          const worldPos = mulPoint(w, [g.positions[vi], g.positions[vi + 1], g.positions[vi + 2]]);
          // The mods' own stray garbage vertices (magnitudes ~1e18) are carried byte-faithfully and
          // sit outside any honest bound — ignore them for the pose check.
          if (Math.abs(worldPos[2]) < 100) {
            maxZ = Math.max(maxZ, worldPos[2]);
          }
        }
      }
      expect(maxZ).toBeGreaterThan(2); // a real truck body, not a flattened one
      expect(maxZ).toBeLessThan(3.2); // upright: the 5.8 m LENGTH never points up (the field bug)
    });

    it('f_wheel container wins over the dummy-child mesh — the stock fallback VehFuncs replaces (round 13)', () => {
      // The bravura's shape, synthesized on the stock donor: a bare disc under wheel_rf_dummy PLUS a
      // VehFuncs `f_wheel_1111 → f_extras:1 → stock|prefacelft` container. Picking the dummy child
      // took a brake disc as THE wheel and groundShift sank the whole body by its tiny radius
      // (FINAL2B: peds authored in world space poked out of the sunken cabin).
      const model = readClump(BOBCAT);
      const rootIndex = model.frames.findIndex((frame) => frame.parentIndex < 0);
      const wheelFrame = model.frames.findIndex((frame) => frame.name === 'wheel');
      const wheelAtomic = model.atomics.find((atomic) => atomic.frameIndex === wheelFrame)!;
      const addFrame = (name: string, parentIndex: number): number => {
        model.frames.push({ flags: 3, name, parentIndex, position: [0, 0, 0], rotation: [...IDENTITY_ROTATION] });

        return model.frames.length - 1;
      };
      const container = addFrame('f_wheel_1111', rootIndex);
      const selector = addFrame('f_extras:1', container);
      const stock = addFrame('stock', selector);
      const preface = addFrame('prefacelft', selector);
      // The chosen style carries a COPY of the wheel geometry (own index — the dropped ledger is
      // per geometry source); the non-chosen style shares it and must stay out entirely.
      const styleGeometry = model.geometries.length;
      model.geometries.push({
        body: model.geometries[wheelAtomic.geometryIndex].body.slice(),
        version: model.version,
      });
      model.atomics.push({ extension: null, flags: 5, frameIndex: stock, geometryIndex: styleGeometry });
      model.atomics.push({ extension: null, flags: 5, frameIndex: preface, geometryIndex: styleGeometry });

      const { dff, report } = convertCar(writeClump(model), extractCarTemplate(CS_BOBCAT));
      const converted = readClump(dff);

      expect(report.shiftZ).toBeCloseTo(0.9, 2); // radius derives from the container wheel
      expect(report.droppedFromMod).toContain('wheel'); // the dummy-child fallback is not carried
      expect(converted.frames.some((frame) => frame.name === 'stock_ad')).toBe(false); // never adopted
      expect(converted.frames.some((frame) => frame.name === 'prefacelft_ad')).toBe(false);
    });

    // A translucent geometry that does not modulate by material colour renders SOLID on RW's default
    // pipeline — the one cutscene translucents sit on — because the material alpha is never read. SA's
    // vehicle pipe reads it regardless, so a mod ships the flag missing and only a cutscene shows it
    // (PROLOG3's sheriff windscreen, ASI plan 001; copcarla is the only such mod of the 23).
    it('every translucent geometry modulates by material colour', () => {
      const { dff } = convertCar(TAXI, extractCarTemplate(CS_TAXI));
      const converted = readClump(dff);
      const MODULATE = 0x40;
      const flagsOf = (body: Uint8Array): number =>
        new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(12, true);

      const translucent = converted.geometries.filter((geometry) => geometryBodyHasTranslucency(geometry.body));
      expect(translucent.length).toBeGreaterThan(0);
      for (const geometry of translucent) {
        expect(flagsOf(geometry.body) & MODULATE).toBe(MODULATE);
      }

      // Opaque geometries are left exactly as authored: the flag changes how a material colour tints
      // the texture, which is the mod's decision wherever alpha is not in play.
      const donor = readClump(TAXI);
      const opaqueDonorFlags = donor.geometries
        .filter((geometry) => !geometryBodyHasTranslucency(geometry.body))
        .map((geometry) => flagsOf(geometry.body) & MODULATE);

      expect(
        converted.geometries
          .filter((geometry) => !geometryBodyHasTranslucency(geometry.body))
          .some((geometry) => (flagsOf(geometry.body) & MODULATE) === 0),
      ).toBe(opaqueDonorFlags.includes(0));
    });

    it('window-pane suppression drops every window and nothing else (round 17)', () => {
      // The per-SLOT switch (docs/hacks/retired/cutscene-window-pane-suppression.md): a rendered window pane
      // z-writes over scene actors drawn after the car, and the draw order is a per-scene accident.
      // Suppressed = the whole window class drops; lamp lenses and every opaque atomic stay.
      const template = extractCarTemplate(CS_BOBCAT);
      const { dff } = convertCar(BOBCAT, template, true);
      const converted = readClump(dff);

      const paneCount = converted.atomics.filter((atomic) =>
        geometryBodyHasWindowPane(converted.geometries[atomic.geometryIndex].body),
      ).length;
      expect(paneCount).toBe(0);
      // The non-pane translucents (the 242-alpha decal band) survive untouched.
      expect(
        converted.atomics.some((atomic) =>
          geometryBodyHasTranslucency(converted.geometries[atomic.geometryIndex].body),
        ),
      ).toBe(true);
      // And the default path still carries its panes.
      const plain = readClump(convertCar(BOBCAT, template).dff);
      expect(
        plain.atomics.some((atomic) => geometryBodyHasWindowPane(plain.geometries[atomic.geometryIndex].body)),
      ).toBe(true);
    });

    it('selector containers: <name>:K groups, no* defaults, year options vs year alternatives (rounds 11–12)', () => {
      // The burrito's VehFuncs shapes, synthesized on the stock donor (the real mod cannot be a
      // committed fixture — mods-src is git-ignored). One f_extras with three groups:
      //   fogs:1   → nofogs (meshless first child = authored OFF) | fogs:2 → fog_ok(mesh)
      //   year:1   → ver[1983]:1(mesh, unique cluster) | ver[1985]:1(mesh)  — year OPTIONS
      //   win:1    → win[on]:2 → windy_ok(mesh) | win[off]:2 → nowindy_ok(mesh)
      // plus a second container holding a year ALTERNATIVE (_[1991]:2 re-offering door_lf_ok).
      const model = readClump(BOBCAT);
      const chassisDummy = model.frames.findIndex((frame) => frame.name === 'chassis_dummy');
      const meshGeometry = model.atomics.find(
        (atomic) => model.frames[atomic.frameIndex].name === 'windscreen_ok',
      )!.geometryIndex;
      const addFrame = (name: string, parentIndex: number): number => {
        model.frames.push({
          flags: 3,
          name,
          parentIndex,
          position: [0, 0, 0],
          rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        });

        return model.frames.length - 1;
      };
      const addMesh = (frameIndex: number): void => {
        model.atomics.push({ extension: null, flags: 5, frameIndex, geometryIndex: meshGeometry });
      };
      const container = addFrame('f_extras:3', chassisDummy);
      const fogs = addFrame('fogs:1', container);
      addFrame('nofogs', fogs);
      addMesh(addFrame('fog_ok', addFrame('fogs:2', fogs)));
      const year = addFrame('year:1', container);
      addMesh(addFrame('ver[1983]:1', year));
      addMesh(addFrame('ver[1985]:1', year));
      const win = addFrame('win:1', container);
      addMesh(addFrame('windy_ok', addFrame('win[on]:2', win)));
      addMesh(addFrame('nowindy_ok', addFrame('win[off]:2', win)));
      const alternative = addFrame('f_extras:1', chassisDummy);
      addMesh(addFrame('door_lf_ok', addFrame('_[1991]:2', alternative)));

      const { dff, report } = convertCar(writeClump(model), extractCarTemplate(CS_BOBCAT));
      const converted = readClump(dff);
      const has = (name: string): boolean => converted.frames.some((frame) => frame.name === name);

      expect(report.adoptedFromMod).toContain('ver[1983]:1'); // year OPTION: first eligible picked
      expect(report.adoptedFromMod).toContain('windy_ok'); // first child of its group wins
      expect(has('ver[1983]:1_ad')).toBe(true);
      expect(has('windy_ok_ad')).toBe(true);
      expect(has('ver[1985]:1_ad')).toBe(false); // the non-chosen year
      expect(has('fog_ok_ad')).toBe(false); // leading meshless no* = authored OFF
      expect(has('nowindy_ok_ad')).toBe(false);
      // The year ALTERNATIVE re-offers the carried door — never picked (the taxi's stacked doors).
      expect(has('door_lf_ok_ad')).toBe(false);
      expect(converted.frames.filter((frame) => frame.name === 'door_lf_ok')).toHaveLength(1);
    });

    it('RENAMES an adopted mesh that duplicates an emitted frame name — a duplicate still binds its channel', () => {
      // DESERT9 (plan 004 round 1): the GMC Sierra ships door glass as a SECOND `door_lf_ok` nested
      // under the first; anim binding is not first-match-only, so the duplicate was driven to the
      // vanilla door local under the door bone — a double transform, glass floating midair.
      // Synthesized here on the stock donor: the windscreen mesh renamed to the door's exact name.
      const model = readClump(BOBCAT);
      const windscreen = model.frames.findIndex((frame) => frame.name === 'windscreen_ok');
      model.frames[windscreen].name = 'door_lf_ok';
      const template = extractCarTemplate(CS_BOBCAT);
      const { dff, report } = convertCar(writeClump(model), template);
      const converted = readClump(dff);

      const doorFrames = converted.frames.filter((frame) => frame.name === 'door_lf_ok');
      expect(doorFrames).toHaveLength(1); // the template bone alone keeps the channel name
      expect(doorFrames[0].boneId).toBe(14); // vanilla id
      expect(frameByName(converted, 'door_lf_ok_ad')).toBeDefined(); // the adopted mesh, unbindable
      expect(report.adoptedFromMod).toContain('door_lf_ok');
    });
  });
});
