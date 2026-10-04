import type { MergedMesh } from '@opensa/lod-common/mesh';
import type { TextureSource } from '@opensa/lod-common/texture-source';

import { extract2dfxEntries } from '@opensa/rw-codec/dff';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { LodLink } from '../../core/types';
import type { BuildStats } from './finalize';

import { cloneKeepTypes, stripCloneTo } from './clone-2dfx';
import { cloneLodDff } from './finalize';

// A real refinery chimney: three light coronas beside a smoke emitter — the only stock shape that can tell
// "carried the emitter" apart from "carried the coronas" (`npm run test:fixtures`).
const CHIMNEY = 'fixtures/original/dff/particle/refchimny01.dff';

/** The traffic-sign-free link shape `cloneLodDff` reads: only the HD draw distance matters to it. */
const LINK: LodLink = {
  hdDrawDistance: 300,
  hdModel: 'refchimny01',
  hdTxd: 'refinery',
  instanceCount: 1,
  lodId: 1,
  lodModel: 'lodrefchimny01',
  lodTxd: 'refinery',
};

const NO_TEXTURES: TextureSource = { get: () => null };

/** A decimator that always "succeeds" by returning a different mesh object — forces the re-encode branch
 *  without depending on QEM actually finding a cheaper mesh for this model. */
function alwaysDecimate(): (mesh: MergedMesh) => MergedMesh {
  return (mesh) => ({ ...mesh });
}

function chimney(): Uint8Array {
  return new Uint8Array(readFileSync(CHIMNEY));
}

/** The same, in the order the section stores them — what the single policy pass preserves. */
function rawTypesIn(bytes: Uint8Array): number[] {
  return extract2dfxEntries(bytes, new Set(Array.from({ length: 32 }, (_, index) => index))).map((entry) => entry.type);
}

/** Fresh zeroed stats — `cloneLodDff` only increments `decimatedLods`. */
function stats(): BuildStats {
  return {
    clonedLods: 0,
    decimatedLods: 0,
    filledHoles: 0,
    filledInstances: 0,
    generatedTxds: 0,
    mergedLods: 0,
    missingHd: 0,
    missingTxd: 0,
    parentTextures: 0,
    retransformedLods: 0,
    skippedHoles: 0,
    skippedShared: 0,
  };
}

/** The types of every 2dfx entry in a clone's bytes, sorted — `extract2dfxEntries` needs an explicit set to
 *  include particles, so ask for everything. */
function typesIn(bytes: Uint8Array): number[] {
  return rawTypesIn(bytes).sort((a, b) => a - b);
}

describe('cloneKeepTypes', () => {
  describe('negative cases', () => {
    it('drops emitters, and ONLY emitters, under --strip-particles', () => {
      const full = cloneKeepTypes(true);
      const stripped = cloneKeepTypes(false);

      expect(stripped.has(1)).toBe(false);
      expect([...full].filter((type) => !stripped.has(type))).toEqual([1]);
    });
  });

  describe('positive cases', () => {
    it('carries emitters by default — the pre-009 strip is the opt-out, not the rule', () => {
      expect(cloneKeepTypes(true).has(1)).toBe(true);
    });
  });
});

describe('cloneLodDff (real chimney)', () => {
  describe('negative cases', () => {
    it('leaves a verbatim clone byte-identical when the policy rejects nothing', () => {
      // The whole point of the byte copy: it preserves plugins our writers do not model, so a pass that
      // removes nothing must not re-encode the file at all.
      const source = chimney();

      const clone = cloneLodDff(source, LINK, null, NO_TEXTURES, stats(), true);

      expect(clone).toBe(source);
    });

    it('a stripped verbatim clone loses its emitter and keeps its coronas', () => {
      const clone = cloneLodDff(chimney(), LINK, null, NO_TEXTURES, stats(), false);

      expect(typesIn(chimney())).toEqual([0, 0, 0, 1]); // fixture sanity: the emitter is there to lose
      expect(typesIn(clone)).toEqual([0, 0, 0]);
    });
  });

  describe('positive cases', () => {
    it('a verbatim clone carries the emitter by default', () => {
      const clone = cloneLodDff(chimney(), LINK, null, NO_TEXTURES, stats(), true);

      expect(typesIn(clone)).toEqual([0, 0, 0, 1]);
    });

    it('a DECIMATED clone carries the emitter too, in its AUTHORED position in the section', () => {
      // Not a fix: the old two-pass shape appended particles, so it carried them too. What one policy pass
      // changes is the ORDER — this chimney authors `[1,0,0,0]` and used to clone as `[0,0,0,1]`.
      const counters = stats();

      const clone = cloneLodDff(chimney(), LINK, alwaysDecimate(), NO_TEXTURES, counters, true);

      expect(counters.decimatedLods).toBe(1); // the re-encode branch really ran
      expect(rawTypesIn(clone)).toEqual([1, 0, 0, 0]);
      expect(typesIn(clone)).toEqual([0, 0, 0, 1]);
    });

    it('a decimated clone honours --strip-particles as well', () => {
      const clone = cloneLodDff(chimney(), LINK, alwaysDecimate(), NO_TEXTURES, stats(), false);

      expect(typesIn(clone)).toEqual([0, 0, 0]);
    });
  });
});

describe('stripCloneTo', () => {
  describe('negative cases', () => {
    it('returns the input untouched when every type is kept', () => {
      const source = chimney();

      expect(stripCloneTo(source, new Set([0, 1, 3, 6, 7, 8, 9, 10]))).toBe(source);
    });
  });

  describe('positive cases', () => {
    it('cuts a type the policy does not name, which is what an invented mod type gets', () => {
      // Nothing stock exercises this — the corpus uses only listed types — so it is fixtured by keeping the
      // emitter and dropping the coronas, the inverse of every real call.
      expect(typesIn(stripCloneTo(chimney(), new Set([1])))).toEqual([1]);
    });
  });
});
