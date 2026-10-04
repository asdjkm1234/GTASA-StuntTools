import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { extractBikeTemplate, toArrayBuffer } from '../template';
import { convertBike } from './bike';
import { type ClumpModel, readClump, writeClump } from './clump-io';

const CS_MTBIKE = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csmtbike92.dff'));
const MTBIKE = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/mtbike.dff'));
const MTBIKE_MOD = new Uint8Array(readFileSync('fixtures/original/vehicles/mtbike-smooth-criminal.dff'));

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

describe('convertBike', () => {
  describe('negative cases', () => {
    it('throws when the mod has no chassis frame', () => {
      const template = extractBikeTemplate(CS_MTBIKE);
      expect(() => convertBike(without(MTBIKE, ['chassis']), template)).toThrow('no chassis frame');
    });

    it('throws when the mod has no rear-wheel mesh', () => {
      const template = extractBikeTemplate(CS_MTBIKE);
      expect(() => convertBike(without(MTBIKE, ['wheel_rear']), template)).toThrow('no wheel_rear mesh');
    });
  });

  describe('positive cases (the golden pair: stock donor must reproduce the vanilla cutscene rig)', () => {
    it('stock mtbike: full part set, vanilla bone ids, vanilla hierarchy order, ~0 shift', () => {
      const template = extractBikeTemplate(CS_MTBIKE);
      const vanilla = readClump(CS_MTBIKE);
      const { dff, report } = convertBike(MTBIKE, template);
      const converted = readClump(dff);

      expect(report.missingInMod).toEqual([]);
      expect(report.parts).toEqual([
        'wheel_rear',
        'chainset',
        'pedal_r',
        'pedal_l',
        'handlebars',
        'forks_front',
        'wheel_front',
      ]);
      expect(report.shiftZ).toBeCloseTo(0, 2);
      expect(report.droppedFromMod).toEqual(['chassis_vlo']);
      expect(report.adoptedFromMod).toEqual([]);
      // The stock donor re-authors the forks (vanilla pitches them) — the delta lands in a shim, never
      // in the bone local; the chassis needs none.
      expect(report.shimmed).toContain('forks_front');
      expect(report.shimmed).not.toContain('chassis');

      // Vanilla ids survive as an ordered subsequence (shim ids are allocated past the template's 0-8).
      const vanillaIds = vanilla.frames[1].hierarchy!.map((node) => node.id);
      const convertedIds = converted.frames[1].hierarchy!.map((node) => node.id);
      let matched = 0;
      for (const id of convertedIds) {
        if (id === vanillaIds[matched]) {
          matched += 1;
        }
      }
      expect(matched).toBe(vanillaIds.length);

      // Bone ids per frame name match vanilla for every SHARED frame; locals are the vanilla bind pose.
      const vanillaBones = new Map(vanilla.frames.filter((f) => f.name).map((f) => [f.name, f.boneId]));
      for (const frame of converted.frames.filter((f) => f.name && vanillaBones.has(f.name))) {
        expect(frame.boneId, frame.name).toBe(vanillaBones.get(frame.name));
      }
      for (const name of ['wheel_rear', 'chainset', 'handlebars', 'forks_front', 'wheel_front']) {
        const expected = frameByName(vanilla, name)!.position;
        const actual = frameByName(converted, name)!.position;
        for (const axis of [0, 1, 2]) {
          expect(actual[axis], `${name}[${axis}]`).toBeCloseTo(expected[axis], 3);
        }
      }
      expect(converted.frames[1].name).toBe('csbikechassis_dummy');

      // wheel_front stays in the forks subtree (possibly through a shim), like vanilla.
      let wheelFrontParent = converted.frames[frameByName(converted, 'wheel_front')!.parentIndex];
      if (wheelFrontParent.name.endsWith('_pv')) {
        wheelFrontParent = converted.frames[wheelFrontParent.parentIndex];
      }
      expect(wheelFrontParent.name).toBe('forks_front');

      // Well-formed emit: contiguous hierarchy indexes, unique ids, parseable clump.
      const hierarchy = converted.frames[1].hierarchy!;
      expect(hierarchy.map((node) => node.index)).toEqual(hierarchy.map((_, at) => at));
      expect(new Set(hierarchy.map((node) => node.id)).size).toBe(hierarchy.length);
      expect(parseDff(toArrayBuffer(dff)).atomics.length).toBe(converted.atomics.length);
    });

    it('Smooth Criminal MTB: dummy-shipped parts keep their bones, variant subtrees adopted whole', () => {
      const template = extractBikeTemplate(CS_MTBIKE);
      const { dff, report } = convertBike(MTBIKE_MOD, template);
      const converted = readClump(dff);

      // The mod ships no `handlebars` frame at all — its bars are f_extras variants (adopted below).
      expect(report.missingInMod).toEqual(['handlebars']);
      expect(report.parts).toEqual(['wheel_rear', 'chainset', 'pedal_r', 'pedal_l', 'forks_front', 'wheel_front']);

      // Both wheels ship as `wheel_pj=0-2c` meshes under the matched dummies — adopted under the wheel
      // BONES, so the spin channels carry them.
      const wheelMeshes = converted.frames
        .map((frame, index) => ({ frame, index }))
        .filter(({ frame }) => frame.name === 'wheel_pj=0-2c_ad'); // adopted = renamed, unbindable
      expect(wheelMeshes).toHaveLength(2);
      expect(wheelMeshes.map(({ frame }) => converted.frames[frame.parentIndex].name).sort()).toEqual([
        'wheel_front',
        'wheel_rear',
      ]);

      // Variant policy on the real file: the b-handlebar subtree is adopted WHOLE (bars + brake levers
      // + grips), the a-set is dropped; `+` containers are additive (both wheel reflectors kept).
      expect(report.adoptedFromMod).toContain('b_drt=0-9:3');
      expect(report.adoptedFromMod).not.toContain('a_drt=0-9:3');
      expect(report.droppedFromMod).toContain('a_drt=0-9:3');
      expect(report.adoptedFromMod).toEqual(expect.arrayContaining(['ref1', 'ref2']));
      expect(report.adoptedFromMod).toContain('_[fenders]_drt=0-9');
      expect(report.droppedFromMod).toContain('chassis_vlo');

      // The mod's chassis frame is a meshless container — the bone is emitted without an atomic and the
      // frame/seat sub-meshes ride it.
      const chassisIndex = converted.frames.findIndex((frame) => frame.name === 'chassis');
      expect(converted.atomics.some((atomic) => atomic.frameIndex === chassisIndex)).toBe(false);
      expect(report.adoptedFromMod).toContain('seat2');
    });
  });
});
