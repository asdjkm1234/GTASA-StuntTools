import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { copyMaterialEffects } from './copy-effects';

// Real vehicle fixtures: infernus (env-map coefficient 1 everywhere — overdone), admiral (a mix: 19 materials
// carry an env-map chunk at ZERO and 3 reflect through the reflection plugin alone) and the anti-rip locked
// walton (well-tuned, every material reflects) read via the engine parser (`npm run test:fixtures`).
const INFERNUS = 'fixtures/original/dff/vehicle/infernus.dff';
const ADMIRAL = 'fixtures/original/dff/vehicle/admiral.dff';
const WALTON = 'fixtures/custom/locked-models/walton.dff';

/** How the materials split by WHICH reflective chunk they carry and whether its value is non-zero. */
function chunks(dff: Uint8Array): {
  coefficientZero: number;
  envMapChunks: number;
  nonZero: number;
  reflectionZero: number;
  total: number;
} {
  const clump = parseDff(toArrayBuffer(dff));
  let coefficientZero = 0;
  let envMapChunks = 0;
  let nonZero = 0;
  let reflectionZero = 0;
  let total = 0;
  for (const geometry of clump.geometries) {
    for (const material of geometry.materials) {
      total += 1;
      const coefficient = material.effects?.envMap?.coefficient ?? 0;
      const intensity = material.effects?.reflection?.intensity ?? 0;
      if (material.effects?.envMap) {
        envMapChunks += 1;
        coefficientZero += coefficient === 0 ? 1 : 0;
      }
      reflectionZero += material.effects?.reflection && intensity === 0 ? 1 : 0;
      nonZero += coefficient !== 0 || intensity !== 0 ? 1 : 0;
    }
  }

  return { coefficientZero, envMapChunks, nonZero, reflectionZero, total };
}

function load(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

/** Distinct env-map coefficients + count of reflective / total materials. */
function reflection(dff: Uint8Array): { coefficients: number[]; reflective: number; total: number } {
  const clump = parseDff(toArrayBuffer(dff));
  const coefficients = new Set<number>();
  let reflective = 0;
  let total = 0;
  for (const geometry of clump.geometries) {
    for (const material of geometry.materials) {
      total += 1;
      if (material.effects?.envMap) {
        reflective += 1;
        coefficients.add(Number(material.effects.envMap.coefficient.toFixed(3)));
      }
    }
  }

  return { coefficients: [...coefficients], reflective, total };
}

describe('copyMaterialEffects', () => {
  describe('negative cases', () => {
    it('throws when the prototype is not a readable vehicle DFF', () => {
      expect(() => copyMaterialEffects(load(INFERNUS), new Uint8Array(64))).toThrow();
    });
  });

  describe('positive cases', () => {
    it('retunes the target env-map coefficient to a locked, different-count reference (walton → infernus)', () => {
      const before = reflection(load(INFERNUS));
      expect(before.coefficients).toEqual([1]); // infernus is overdone (mirror-like)

      const after = reflection(copyMaterialEffects(load(INFERNUS), load(WALTON)).bytes);
      expect(after.coefficients).toEqual([0.5]); // retuned to walton's tasteful level
      expect(after.reflective).toBe(before.reflective); // no reflection added/removed
      expect(after.total).toBe(before.total);
    });

    it('matches across vehicles with different material counts without throwing (admiral → infernus)', () => {
      const after = reflection(copyMaterialEffects(load(INFERNUS), load(ADMIRAL)).bytes);
      expect(after.reflective).toBe(reflection(load(INFERNUS)).reflective);
    });

    it('retunes the ENV-MAP-MARKED materials and leaves a deliberate zero alone (walton → admiral)', () => {
      // The env-map is the author's marking of "this surface mirrors the world" — body, glass, chrome. The SA
      // reflection plugin sits on nearly every material (here 91 of 91), so retuning by IT would spread the
      // reference's body value onto the interior and the tyres.
      expect(chunks(load(ADMIRAL))).toEqual({
        coefficientZero: 19,
        envMapChunks: 67,
        nonZero: 51,
        reflectionZero: 40,
        total: 91,
      });

      const result = copyMaterialEffects(load(ADMIRAL), load(WALTON));

      expect(result.materials).toBe(91);
      // 48 env-map-marked + 13 more that only take a specular HIGHLIGHT (46 carry specular, 33 of them marked
      // too). The reflection intensity rides the marked set, not all 91 plugin carriers.
      expect(result.patched).toBe(61);
      expect(result.coefficients).toBe(48);
      expect(result.intensities).toBe(48);
      expect(result.speculars).toBe(46);
      expect(result.fellBack).toBe(false);
      // Nothing matte became shiny: the same zeros are still zero after the copy.
      const after = chunks(result.bytes);
      expect(after.coefficientZero).toBe(19);
      expect(after.reflectionZero).toBe(40);
      expect(after.nonZero).toBe(51);
    });

    it("takes the reference's level from ITS marked materials, not from its untuned majority", () => {
      // walton's env-map-marked materials are the tuned ones; a median over every plugin-carrying material
      // would return the file's default (0.5) and the copy would transfer nothing at all.
      const result = copyMaterialEffects(load(ADMIRAL), load(WALTON));

      expect(result.reference.coefficient).toBeCloseTo(0.5, 3);
      expect(result.reference.intensity).not.toBeNull();
      expect(result.reference.intensity).toBeLessThan(0.5);
    });

    it('takes an explicit level with no prototype at all — a number, not a donor median', () => {
      const result = copyMaterialEffects(load(ADMIRAL), undefined, { coefficient: 0.15, reflection: 0.05 });

      expect(result.patched).toBe(48); // no specular value given, so the specular-only materials stay out
      expect(result.reference).toEqual({ coefficient: 0.15, intensity: 0.05, specular: null });
      expect(result.speculars).toBe(0);
      const after = chunks(result.bytes);
      expect(after.coefficientZero).toBe(19); // the zeros are still the author's
      expect(after.nonZero).toBe(51);
    });

    it('lets an explicit level override the prototype it was given', () => {
      const result = copyMaterialEffects(load(ADMIRAL), load(WALTON), { reflection: 0.02 });

      expect(result.reference.intensity).toBe(0.02);
      expect(result.reference.coefficient).toBeCloseTo(0.5, 3); // still walton's
    });

    it('retunes the specular HIGHLIGHT too — its own term, its own marking (walton → admiral)', () => {
      // The field case: the target's shine was the specular level (yankee 0.26-0.56 against walton's 0.05),
      // and the pipe multiplies it by 3. A transfer that skipped it looked inert on exactly those cars.
      const specular = (dff: Uint8Array): number[] => {
        const clump = parseDff(toArrayBuffer(dff));

        return clump.geometries
          .flatMap((geometry) => geometry.materials)
          .map((material) => material.effects?.specular?.level ?? 0)
          .filter((level) => level !== 0);
      };
      const before = new Set(specular(load(ADMIRAL)).map((level) => level.toFixed(3)));
      expect(before.size).toBeGreaterThan(1); // admiral carries several levels

      const result = copyMaterialEffects(load(ADMIRAL), load(WALTON));

      const after = new Set(specular(result.bytes).map((level) => level.toFixed(3)));
      expect(after.size).toBeLessThanOrEqual(before.size); // collapsed toward walton's own level(s)
      expect(specular(result.bytes)).toHaveLength(46); // none added, none removed
    });

    it('reports what it did, so a run that changes nothing says so', () => {
      const result = copyMaterialEffects(load(ADMIRAL), load(WALTON));

      expect(result.byTexture).toBeGreaterThanOrEqual(0);
      expect(result.byTexture).toBeLessThanOrEqual(result.patched);
      expect(result.patched).toBeLessThanOrEqual(result.materials);
    });
  });
});
