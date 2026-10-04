import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decodeScript } from '../core/decode';
import { opcodeDef } from '../core/opcode-table';
import { createRecordingHost } from './recording-host';
import { ScriptRunner } from './runner';
import { atlasMissKey, atlasTierOf, DECLARED_ATLAS_TIERS, DECLARED_TIERS } from './tiers';

/**
 * The census→registry→tier join (plan 097/07 decision 1): every opcode the shipped corpus uses is
 * either SERVED by the registry or has a DECLARED tier — an undeclared gap fails here at build
 * time, sorted into the failure message by real frequency. Runs over the regenerated fixtures
 * (`npm run test:fixtures`), skips where they are absent (CI without game assets).
 */
const CORPUS = 'fixtures/original/cleo';

describe.skipIf(!existsSync(CORPUS))('corpus coverage join', () => {
  describe('negative cases', () => {
    it('no corpus opcode is an UNDECLARED gap (unserved and carrying no declared tier)', () => {
      const runner = new ScriptRunner({ host: createRecordingHost() });
      const undeclared = new Map<number, number>();
      for (const file of readdirSync(CORPUS).filter((name) => name.endsWith('.cs'))) {
        const script = decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${file}`)));
        for (const instruction of script.instructions) {
          const { opcode } = instruction;
          if (!runner.registry.has(opcode) && !DECLARED_TIERS.has(opcode)) {
            undeclared.set(opcode, (undeclared.get(opcode) ?? 0) + 1);
          }
        }
      }
      const report = [...undeclared.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(
          ([opcode, count]) => `${opcode.toString(16).padStart(4, '0')} ×${count} ${opcodeDef(opcode)?.name ?? '?'}`,
        );

      expect(report).toEqual([]);
    });

    it('no corpus atlas MISS is undeclared (the atlas half of the join — decision 4)', () => {
      // Every miss the corpus produces must carry a DECLARED tier (today: the two struct-read rows
      // — windfarm's model-info field, cardoor's task struct). This is the guard for the NEXT mod:
      // a script whose access the atlas cannot name fails here until its row gets a declared tier
      // + consumer in DECLARED_ATLAS_TIERS.
      const undeclared: string[] = [];
      for (const file of readdirSync(CORPUS).filter((name) => name.endsWith('.cs'))) {
        // A car exists AND the player sits in it — the widest realistic surface: cardoor's task
        // probing (the size-2 struct reads) only runs for a seated player.
        const host = createRecordingHost({ cars: [{ handle: 257, model: 432 }], playerInCar: 257 });
        const runner = new ScriptRunner({ host });
        runner.spawn(decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${file}`))), file);
        for (let frame = 0; frame < 120; frame += 1) {
          runner.tick(1000 / 60);
        }
        for (const miss of host.atlas.misses) {
          if (!atlasTierOf(miss).declared) {
            undeclared.push(`${file}: ${atlasMissKey(miss)}`);
          }
        }
      }

      expect(undeclared).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('the class C + text gaps are exactly the declared set the corpus exercises', () => {
      const used = new Set<number>();
      for (const file of readdirSync(CORPUS).filter((name) => name.endsWith('.cs'))) {
        const script = decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${file}`)));
        for (const instruction of script.instructions) {
          used.add(instruction.opcode);
        }
      }
      const exercised = [...DECLARED_TIERS.keys()].filter((opcode) => used.has(opcode)).sort((a, b) => a - b);

      // Every declared tier row earns its place by a real corpus consumer (no dead policy rows).
      expect(exercised).toEqual([...DECLARED_TIERS.keys()].sort((a, b) => a - b));
    });

    it('every declared ATLAS row has a real corpus consumer (no dead policy rows here either)', () => {
      const seen = new Set<string>();
      for (const file of readdirSync(CORPUS).filter((name) => name.endsWith('.cs'))) {
        // A car exists AND the player sits in it — the widest realistic surface: cardoor's task
        // probing (the size-2 struct reads) only runs for a seated player.
        const host = createRecordingHost({ cars: [{ handle: 257, model: 432 }], playerInCar: 257 });
        const runner = new ScriptRunner({ host });
        runner.spawn(decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${file}`))), file);
        for (let frame = 0; frame < 120; frame += 1) {
          runner.tick(1000 / 60);
        }
        for (const miss of host.atlas.misses) {
          seen.add(atlasMissKey(miss));
        }
      }
      const dead = [...DECLARED_ATLAS_TIERS.keys()].filter((key) => !seen.has(key));

      expect(dead).toEqual([]);
    });
  });
});
