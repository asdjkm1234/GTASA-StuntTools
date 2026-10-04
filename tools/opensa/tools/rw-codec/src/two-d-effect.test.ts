import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readRw, RW_EXTENSION, RW_TWO_D_EFFECT } from './chunk';
import { build2dfxSection, collectGeometries, extract2dfxEntries, type Raw2dfxEntry } from './dff';
import {
  decodeEscalator2dfx,
  decodeParticle2dfx,
  decodeRoadsign2dfx,
  encodeEscalator2dfx,
  encodeParticle2dfx,
  encodeRoadsign2dfx,
  ESCALATOR_2DFX,
  fixedFieldText,
  PARTICLE_2DFX,
  ROADSIGN_2DFX,
} from './two-d-effect';

// Real subjects, one per decoded type. The escalator model is the mixed-type case: it also carries four
// type-9 cover points this codec never decodes, which is what the section round trip is for.
// A Vegas junction carrying four street-name plates (committed, version-pinned).
const SIGN_DFF = 'fixtures/custom/proper-fixes-models/vegasnroad19.dff';
// The LA mall pair: two opposed escalators + 4 undecoded type-9 entries (`npm run test:fixtures`).
const ESCALATOR_DFF = 'fixtures/original/dff/escalator/escl_la.dff';
// The LV skull-torch pillar: one `fire` emitter.
const PARTICLE_DFF = 'fixtures/original/dff/particle/skullpillar01_lvs.dff';
// A refinery chimney: a smoke emitter beside three light coronas.
const CHIMNEY_DFF = 'fixtures/original/dff/particle/refchimny01.dff';
// Light coronas only — the "wrong type" subject.
const LIGHTS_DFF = 'fixtures/custom/proper-fixes-models/trafficlight1.dff';

/** Every 2dfx entry of `type` in a fixture (particles included — `extract2dfxEntries` drops them by default). */
function entriesOf(path: string, type: number): Raw2dfxEntry[] {
  return extract2dfxEntries(new Uint8Array(readFileSync(path)), new Set([type]));
}

/** A synthetic entry: zeroed position, the given type, `data` as its payload. */
function synthetic(type: number, data: Uint8Array): Uint8Array {
  const entry = new Uint8Array(20 + data.length);
  const view = new DataView(entry.buffer);
  view.setUint32(12, type, true);
  view.setUint32(16, data.length, true);
  entry.set(data, 20);

  return entry;
}

describe('2dfx roadsign codec', () => {
  describe('negative cases', () => {
    it('rejects an entry whose header declares more payload than was supplied', () => {
      const entry = entriesOf(SIGN_DFF, ROADSIGN_2DFX)[0].bytes;

      expect(() => decodeRoadsign2dfx(entry.subarray(0, entry.length - 4))).toThrow(/declares 88 payload bytes, 84/);
    });

    it('rejects a payload shorter than the roadsign layout', () => {
      expect(() => decodeRoadsign2dfx(synthetic(ROADSIGN_2DFX, new Uint8Array(40)))).toThrow(/shorter than its 86/);
    });

    it('rejects an entry of another type', () => {
      const light = extract2dfxEntries(new Uint8Array(readFileSync(LIGHTS_DFF)))[0];

      expect(() => decodeRoadsign2dfx(light.bytes)).toThrow(/type 0, expected 7/);
    });

    it('rejects a text line that is not the fixed 16-byte field', () => {
      const sign = decodeRoadsign2dfx(entriesOf(SIGN_DFF, ROADSIGN_2DFX)[0].bytes);
      sign.lines[1] = new Uint8Array(15);

      expect(() => encodeRoadsign2dfx(sign)).toThrow(/text line 1 is 15 bytes/);
    });
  });

  describe('positive cases', () => {
    it('re-encodes every plate byte-for-byte', () => {
      const entries = entriesOf(SIGN_DFF, ROADSIGN_2DFX);
      expect(entries).toHaveLength(4);

      for (const entry of entries) {
        expect(encodeRoadsign2dfx(decodeRoadsign2dfx(entry.bytes))).toEqual(entry.bytes);
      }
    });

    it('reads the plate size, rotation and baked text off the right spans', () => {
      const signs = entriesOf(SIGN_DFF, ROADSIGN_2DFX).map((entry) => decodeRoadsign2dfx(entry.bytes));

      for (const sign of signs) {
        expect(sign.plateSize[0]).toBeCloseTo(5.6, 1);
        expect(sign.plateSize[1]).toBeCloseTo(2.7, 1);
        expect(Math.abs(sign.rotation[1])).toBeCloseTo(90, 0); // the field a transplant must carry
        expect(sign.lines).toHaveLength(4); // four fields on the wire, drawn or not
        expect(sign.trailing).toHaveLength(2); // the pad, kept verbatim
      }
      expect(signs.map((sign) => fixedFieldText(sign.lines[0]))).toContain('#_THE_STRIP____');
    });

    it('carries an edited rotation into the re-encoded entry', () => {
      const sign = decodeRoadsign2dfx(entriesOf(SIGN_DFF, ROADSIGN_2DFX)[0].bytes);
      sign.rotation = [0, 45, 0];

      const again = decodeRoadsign2dfx(encodeRoadsign2dfx(sign));
      expect(again.rotation).toEqual([0, 45, 0]);
      expect(fixedFieldText(again.lines[0])).toBe('#_THE_STRIP____');
    });
  });
});

describe('2dfx escalator codec', () => {
  describe('negative cases', () => {
    it('rejects an entry shorter than the 20-byte header', () => {
      expect(() => decodeEscalator2dfx(new Uint8Array(12))).toThrow(/shorter than its 20-byte header/);
    });

    it('rejects a payload shorter than the escalator layout', () => {
      expect(() => decodeEscalator2dfx(synthetic(ESCALATOR_2DFX, new Uint8Array(24)))).toThrow(/shorter than its 40/);
    });
  });

  describe('positive cases', () => {
    it('re-encodes both mall escalators byte-for-byte', () => {
      const entries = entriesOf(ESCALATOR_DFF, ESCALATOR_2DFX);
      expect(entries).toHaveLength(2);

      for (const entry of entries) {
        expect(encodeEscalator2dfx(decodeEscalator2dfx(entry.bytes))).toEqual(entry.bytes);
      }
    });

    it('reads the opposed pair: same path, mirrored x, opposite directions', () => {
      const [left, right] = entriesOf(ESCALATOR_DFF, ESCALATOR_2DFX).map((entry) => decodeEscalator2dfx(entry.bytes));

      expect(left.direction).toBe(1);
      expect(right.direction).toBe(0);
      expect(left.bottom[0]).toBeLessThan(0);
      expect(right.bottom[0]).toBeGreaterThan(0);
      expect(left.bottom[2]).toBeCloseTo(right.bottom[2], 3);
      expect(left.top[1]).toBeCloseTo(right.top[1], 3);
    });
  });
});

describe('2dfx particle codec', () => {
  describe('negative cases', () => {
    it('rejects a payload shorter than the 24-byte name field', () => {
      expect(() => decodeParticle2dfx(synthetic(PARTICLE_2DFX, new Uint8Array(8)))).toThrow(/shorter than its 24/);
    });

    it('rejects a name field that is not 24 bytes', () => {
      const emitter = decodeParticle2dfx(entriesOf(PARTICLE_DFF, PARTICLE_2DFX)[0].bytes);
      emitter.name = new Uint8Array(8);

      expect(() => encodeParticle2dfx(emitter)).toThrow(/name field is 8 bytes/);
    });
  });

  describe('positive cases', () => {
    it('re-encodes the skull-torch emitter byte-for-byte', () => {
      const entry = entriesOf(PARTICLE_DFF, PARTICLE_2DFX)[0];

      expect(encodeParticle2dfx(decodeParticle2dfx(entry.bytes))).toEqual(entry.bytes);
    });

    it('keeps the name field raw — its tail past the terminator is NOT zeroed', () => {
      const emitter = decodeParticle2dfx(entriesOf(PARTICLE_DFF, PARTICLE_2DFX)[0].bytes);
      const name = fixedFieldText(emitter.name);

      expect(name).toBe('fire');
      // Measured on this fixture: re-deriving the field from the string would change 19 bytes.
      expect(emitter.name.subarray(name.length + 1).some((byte) => byte !== 0)).toBe(true);
    });

    it('re-encodes the chimney emitter that sits beside light coronas', () => {
      const entry = entriesOf(CHIMNEY_DFF, PARTICLE_2DFX)[0];

      expect(encodeParticle2dfx(decodeParticle2dfx(entry.bytes))).toEqual(entry.bytes);
    });
  });
});

describe('2dfx section round trip', () => {
  describe('positive cases', () => {
    it('rebuilds the mall section identically with typed entries re-encoded and type-9 entries untouched', () => {
      const bytes = new Uint8Array(readFileSync(ESCALATOR_DFF));
      const entries = extract2dfxEntries(bytes, new Set([9, ESCALATOR_2DFX]));
      expect(entries.map((entry) => entry.type)).toEqual([10, 10, 9, 9, 9, 9]); // fixture sanity

      const rebuilt = build2dfxSection(
        entries.map((entry) => ({
          bytes: entry.type === ESCALATOR_2DFX ? encodeEscalator2dfx(decodeEscalator2dfx(entry.bytes)) : entry.bytes,
          position: entry.position,
        })),
      );

      expect(rebuilt).toEqual(sectionOf(bytes));
    });
  });
});

/** The raw 2dfx section bytes of a DFF's first geometry (`u32 count` + entries). */
function sectionOf(bytes: Uint8Array): Uint8Array | undefined {
  const geometry = collectGeometries(readRw(bytes).chunks)[0];
  const extension = geometry.children?.find((child) => child.type === RW_EXTENSION);

  return extension?.children?.find((child) => child.type === RW_TWO_D_EFFECT)?.data;
}
