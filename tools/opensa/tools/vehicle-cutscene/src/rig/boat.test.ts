import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { extractBoatTemplate, toArrayBuffer } from '../template';
import { convertBoat } from './boat';
import { type ClumpModel, readClump, writeClump } from './clump-io';

const CS_DINGHY = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csdinghy.dff'));
const DINGHY = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/dinghy.dff'));
const DINGHY_MOD = new Uint8Array(readFileSync('fixtures/original/vehicles/dinghy-hd.dff'));

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

describe('convertBoat', () => {
  describe('negative cases', () => {
    it('throws when the mod has no boat_hi frame', () => {
      const template = extractBoatTemplate(CS_DINGHY);
      expect(() => convertBoat(without(DINGHY, ['boat_hi']), template)).toThrow('no boat_hi frame');
    });
  });

  describe('positive cases (the golden pair: stock donor must reproduce the vanilla cutscene rig)', () => {
    it('stock dinghy: flaps on vanilla bones, props adopted under their flaps, no shims, no shift', () => {
      const template = extractBoatTemplate(CS_DINGHY);
      const vanilla = readClump(CS_DINGHY);
      const { dff, report } = convertBoat(DINGHY, template);
      const converted = readClump(dff);

      expect(report.missingInMod).toEqual([]);
      expect(report.parts).toEqual(['boat_rearflap_right', 'boat_rearflap_left']);
      expect(report.shiftZ).toBe(0);
      expect(report.droppedFromMod).toEqual(['boat_vlo']);
      // The vanilla cutscene model carries NO propellers — the donor's are visible gameplay meshes,
      // so they are ADOPTED, riding their flap bones.
      expect(report.adoptedFromMod.sort()).toEqual(['moving_prop', 'moving_prop2', 'static_prop', 'static_prop2']);
      // Donor and vanilla author identical frame positions — nothing needs a shim.
      expect(report.shimmed).toEqual([]);

      // Bone ids per frame name match vanilla; locals are the vanilla bind pose, verbatim.
      const vanillaBones = new Map(vanilla.frames.filter((f) => f.name).map((f) => [f.name, f.boneId]));
      for (const frame of converted.frames.filter((f) => f.name && vanillaBones.has(f.name))) {
        expect(frame.boneId, frame.name).toBe(vanillaBones.get(frame.name));
      }
      for (const name of ['boat_hi', 'boat_rearflap_right', 'boat_rearflap_left']) {
        const expected = frameByName(vanilla, name)!.position;
        const actual = frameByName(converted, name)!.position;
        for (const axis of [0, 1, 2]) {
          expect(actual[axis], `${name}[${axis}]`).toBeCloseTo(expected[axis], 3);
        }
      }
      expect(converted.frames[1].name).toBe('dinghy');
      const prop = frameByName(converted, 'moving_prop_ad')!; // adopted = renamed, unbindable
      expect(converted.frames[prop.parentIndex].name).toBe('boat_rearflap_right');

      // Well-formed emit: contiguous hierarchy indexes, unique ids, parseable clump.
      const hierarchy = converted.frames[1].hierarchy!;
      expect(hierarchy.map((node) => node.index)).toEqual(hierarchy.map((_, at) => at));
      expect(new Set(hierarchy.map((node) => node.id)).size).toBe(hierarchy.length);
      expect(parseDff(toArrayBuffer(dff)).atomics.length).toBe(converted.atomics.length);
    });

    it('Dinghy HD: origin-authored hull shimmed to the vanilla local, steering + details adopted', () => {
      const template = extractBoatTemplate(CS_DINGHY);
      const { dff, report } = convertBoat(DINGHY_MOD, template);
      const converted = readClump(dff);

      expect(report.missingInMod).toEqual([]);
      expect(report.parts).toEqual(['boat_rearflap_right', 'boat_rearflap_left']);
      // The mod authors the hull at the origin — the vanilla local [0, 0.313, 0.357] stays on the bone
      // (the anims' bind pose) and the shim absorbs the delta; the flaps moved too.
      expect(report.shimmed).toEqual(expect.arrayContaining(['boat_hi', 'boat_rearflap_right', 'boat_rearflap_left']));
      const body = frameByName(converted, 'boat_hi')!;
      expect(body.position[1]).toBeCloseTo(0.313, 3);
      expect(body.position[2]).toBeCloseTo(0.357, 3);

      expect(report.adoptedFromMod).toEqual(
        expect.arrayContaining(['dinghy_details', 'movsteer_1.0', 'moving_prop', 'moving_prop2']),
      );
      expect(report.droppedFromMod).toEqual(['boat_vlo']);
      // Propellers ride their transom flaps, like the donor authors them.
      const prop = frameByName(converted, 'moving_prop_ad')!;
      expect(converted.frames[prop.parentIndex].name).toBe('boat_rearflap_left');
    });
  });
});
