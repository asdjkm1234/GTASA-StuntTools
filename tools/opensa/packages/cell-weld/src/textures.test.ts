/**
 * The planner's missing-texture rule (map-object round, plan 085 row B).
 *
 * A texture name the whole chain cannot supply renders as the MATERIAL COLOUR — vanilla SA draws such a
 * material untextured, and the magenta marker it replaced read as an engine bug in the field
 * (visagesign04: a mod DFF naming `_257` textures no dictionary anywhere ships). The loudness lives in
 * `report.missing` instead, which the pack log summarizes.
 */
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PLANNER_CURSOR_START, type PlannerJournal, TexturePlanner } from './textures';

const TXD_PATH = join(process.cwd(), 'fixtures', 'original', 'mods', 'chinatownsfe.txd');

function fixtureFs(): { fs: ConstructorParameters<typeof TexturePlanner>[0]; realName: string } {
  const data = readFileSync(TXD_PATH);
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const realName = parseTxd(bytes).textures[0].name.toLowerCase();
  const fs = {
    get: (name: string): ArrayBuffer | null => (name.toLowerCase() === 'chinatownsfe.txd' ? bytes : null),
    getText: (): null => null,
    has: (name: string): boolean => name.toLowerCase() === 'chinatownsfe.txd',
    names: ['chinatownsfe.txd'],
  } as unknown as ConstructorParameters<typeof TexturePlanner>[0];

  return { fs, realName };
}

describe('TexturePlanner missing textures', () => {
  describe('negative cases', () => {
    it('ledgers nothing when the texture resolves', () => {
      const { fs, realName } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      planner.resolve('chinatownsfe', realName, [255, 255, 255, 255]);

      expect(planner.report.missing).toEqual({});
    });

    it('ledgers nothing for a colour-only material — no texture was ever named', () => {
      const { fs } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      planner.resolve('chinatownsfe', null, [80, 90, 100, 255]);

      expect(planner.report.missing).toEqual({});
    });
  });

  describe('positive cases', () => {
    it('falls back to the material colour (vanilla draws missing textures untextured) and ledgers the name', () => {
      const { fs } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());
      const colour = [200, 10, 10, 255] as const;

      const missed = planner.resolve('chinatownsfe', 'miragepillar2_257', colour);
      const plain = planner.resolve('chinatownsfe', null, colour);

      // Same texel as a colour-only material, but a POOL of its own: the runtime repaints stand-in layers
      // magenta on demand, and repainting a layer shared with a legit colour material would tint that too.
      expect(missed).not.toBe(plain);
      expect(planner.missingLayers).toEqual([
        { array: missed.arrayRef, color: [200, 10, 10, 255], layer: missed.layer },
      ]);
      expect(planner.report.missing).toEqual({ 'chinatownsfe/miragepillar2_257': { count: 1, models: [] } });
    });

    it('shares ONE stand-in layer across misses of the same material colour', () => {
      const { fs } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      const first = planner.resolve('chinatownsfe', 'miragepillar2_257', [255, 255, 255, 255]);
      const second = planner.resolve('skullsign', 'miragesign1_257', [255, 255, 255, 255]);

      expect(second).toBe(first);
      expect(planner.missingLayers).toHaveLength(1);
    });

    it('resolves through the GLOBAL index when the def chain misses but another TXD carries the name', () => {
      // Row F: mod TXDs drop names their stock predecessors had (triadcasino roof), and stock models
      // reference textures another TXD carries (lacnchasgn_lvs → carparksignplate_64). The def chain
      // stays first; the global index only decides between the real texels and a stand-in.
      const data = readFileSync(TXD_PATH);
      const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const realName = parseTxd(bytes).textures[0].name.toLowerCase();
      const fs = {
        get: (name: string): ArrayBuffer | null => (name.toLowerCase() === 'donor.txd' ? bytes : null),
        getText: (): null => null,
        has: (name: string): boolean => name.toLowerCase() === 'donor.txd',
        names: ['donor.txd'],
      } as unknown as ConstructorParameters<typeof TexturePlanner>[0];
      const planner = new TexturePlanner(fs, new Map());

      const resolved = planner.resolve('signdef', realName, [255, 255, 255, 255], false, 'lacnchasgn_lvs');
      planner.resolve('signdef', realName, [255, 255, 255, 255], false, 'carparksign02_lvs');
      const plain = planner.resolve('signdef', null, [255, 255, 255, 255]);

      expect(resolved).not.toBe(plain); // a real texture layer, not the colour stand-in
      expect(planner.report.missing).toEqual({});
      // The full triage view: which txd LACKED the name, the donor, and every model that asked.
      expect(planner.report.crossTxd).toEqual({
        [`signdef/${realName}`]: {
          donor: 'donor',
          models: ['lacnchasgn_lvs', 'carparksign02_lvs'],
          texture: realName,
          txd: 'signdef',
        },
      });
    });

    it('counts repeat misses per name and records WHICH models asked — the actionable half of the ledger', () => {
      const { fs } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      planner.resolve('chinatownsfe', 'miragepillar2_257', [255, 255, 255, 255], false, 'visagesign04');
      planner.resolve('chinatownsfe', 'miragepillar2_257', [255, 255, 255, 255], false, 'visagesign04');
      planner.resolve('chinatownsfe', 'miragepillar2_257', [255, 255, 255, 255], false, 'visagesign05');
      planner.resolve('skullsign', 'miragesign1_257', [255, 255, 255, 255]);

      expect(planner.report.missing).toEqual({
        'chinatownsfe/miragepillar2_257': { count: 3, models: ['visagesign04', 'visagesign05'] },
        'skullsign/miragesign1_257': { count: 1, models: [] },
      });
    });
  });
});

/**
 * The planner's journal (pmb plan 006): a chunked convert checkpoints what the planner added per chunk, and
 * a resume replays the journals onto a fresh planner. What must hold: after the replay the fresh planner
 * RESOLVES and BUILDS exactly as the original — the same layer indexes for the same textures, the same
 * array bytes — or a resumed pak binds the wrong layers of every array.
 */
describe('TexturePlanner journal / restore', () => {
  describe('negative cases', () => {
    it('journals only what was added since the cursor', () => {
      const { fs, realName } = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());
      planner.resolve('chinatownsfe', realName, [1, 2, 3, 255]);
      const first = planner.journalSince(PLANNER_CURSOR_START);
      planner.resolve('chinatownsfe', null, [9, 9, 9, 255]);
      const second = planner.journalSince(first.cursor);

      const layers = (journal: PlannerJournal): number =>
        journal.buckets.reduce((sum, bucket) => sum + bucket.layers.length, 0);
      expect(layers(first.journal)).toBe(1);
      expect(layers(second.journal)).toBe(1); // the colour layer only, not the texture again
      expect(planner.journalSince(second.cursor).journal.buckets).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('a fresh planner fed the journals resolves the same layers and builds the same bytes', () => {
      const { fs, realName } = fixtureFs();
      const original = new TexturePlanner(fs, new Map());
      const a = original.resolve('chinatownsfe', realName, [1, 2, 3, 255]);
      const b = original.resolve('chinatownsfe', null, [9, 9, 9, 255]);
      const missed = original.resolve('chinatownsfe', 'nosuch_257', [7, 7, 7, 255]);
      const journal = original.journalSince(PLANNER_CURSOR_START).journal;

      const resumed = new TexturePlanner(fs, new Map());
      resumed.restore(journal);
      expect(resumed.report).toEqual(original.report);
      expect(resumed.missingLayers).toEqual(original.missingLayers);

      // Dedup state survived: the same asks give the same slots, and a NEW ask gets the next slot both sides.
      expect(resumed.resolve('chinatownsfe', realName, [1, 2, 3, 255])).toEqual(a);
      expect(resumed.resolve('chinatownsfe', null, [9, 9, 9, 255])).toEqual(b);
      expect(resumed.resolve('chinatownsfe', 'nosuch_257', [7, 7, 7, 255])).toEqual(missed);
      expect(resumed.resolve('chinatownsfe', null, [4, 4, 4, 255])).toEqual(
        original.resolve('chinatownsfe', null, [4, 4, 4, 255]),
      );
      const built = original.build();
      const rebuilt = resumed.build();
      expect(rebuilt.map((array) => [array.ref, array.meta])).toEqual(built.map((array) => [array.ref, array.meta]));
      rebuilt.forEach((array, index) => expect(Buffer.compare(array.bytes, built[index].bytes)).toBe(0));
    });
  });
});
