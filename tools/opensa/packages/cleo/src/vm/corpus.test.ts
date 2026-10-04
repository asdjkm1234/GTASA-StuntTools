import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decodeScript } from '../core/decode';
import { createRecordingHost } from './recording-host';
import { ScriptRunner } from './runner';
import { atlasTierOf } from './tiers';

/** Real corpus scripts on the real decoder — the plan 03 headless integration. */
const CORPUS = 'fixtures/original/cleo';

const load = (name: string): ReturnType<typeof decodeScript> =>
  decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${name}.cs`)));

describe.skipIf(!existsSync(CORPUS))('corpus on the VM', () => {
  describe('positive cases', () => {
    it('Ferris Wheel produces the expected host-call story headless', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      runner.spawn(load('ferris'), 'ferris');
      for (let frame = 0; frame < 60; frame += 1) {
        runner.tick(1000 / 60);
      }
      expect(runner.faults).toEqual([]);

      // The story: request the four models (14644-14647), poll, then build — the base (#1), the
      // wheel HD+LOD (#2/#3, linked), the lights HD+LOD (#4/#5, linked) and SIXTEEN seats.
      expect(host.calls.filter((line) => line.startsWith('models.request'))).toHaveLength(4);
      expect(host.calls.filter((line) => line.startsWith('models.isAvailable'))).toHaveLength(4);
      expect(host.calls.filter((line) => line.startsWith('objects.create'))).toHaveLength(21);
      expect(host.calls).toContain('objects.connectLods 2 3');
      expect(host.calls).toContain('objects.connectLods 4 5');
      // …then per frame: the wheel and lights rotate, and every seat rides the rim (sin/cos).
      expect(host.calls.filter((line) => line.startsWith('objects.setRotation')).length).toBeGreaterThan(50);
      expect(host.calls.filter((line) => line.startsWith('objects.setCoordinates')).length).toBeGreaterThan(500);
    });

    it('the Ferris rotation angle ADVANCES across frames (the wheel actually turns)', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      runner.spawn(load('ferris'), 'ferris');
      for (let frame = 0; frame < 120; frame += 1) {
        runner.tick(1000 / 60);
      }
      // The wheel is #2; its rotation is (0, angle, 90) — the middle component advances with time
      // (0079 ADD_TIMED_VAL: ~4.8° over the first second).
      const angles = host.calls
        .filter((line) => line.startsWith('objects.setRotation #2 '))
        .map((line) => Number(line.split(' ')[2].split(',')[1]));
      expect(angles.length).toBeGreaterThan(50);
      expect(angles[angles.length - 1]).toBeGreaterThan(angles[0] + 5);
      // Monotone non-decreasing — the wheel never jumps backwards.
      for (let index = 1; index < angles.length; index += 1) {
        expect(angles[index]).toBeGreaterThanOrEqual(angles[index - 1]);
      }
    });

    it('Wind Farm BUILDS its turbines: the atlas serves its wind + LOD-multiplier globals (plan 05)', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      const thread = runner.spawn(load('windfarm'), 'windfarm');
      for (let frame = 0; frame < 120; frame += 1) {
        runner.tick(1000 / 60);
      }
      expect(runner.faults).toEqual([]);
      expect(thread.terminated).toBe(false);
      for (const name of ['windturb_base', 'windturb_fan', 'lodwindturb_base', 'lodwindturb_fan']) {
        expect(namedId(host.calls, name)).toBeGreaterThanOrEqual(20000);
      }
      // The 04 field checkpoint's measured blocker, now served: 0A8D reads resolve, the visibility
      // radius is non-zero, and the farm actually builds — turbines + LOD links + spinning fans.
      expect(host.calls.some((line) => line.startsWith('onUnimplemented 0A8D'))).toBe(false);
      expect(host.calls.filter((line) => line.startsWith('objects.create')).length).toBeGreaterThan(30);
      expect(host.calls.filter((line) => line.startsWith('objects.connectLods')).length).toBeGreaterThan(10);
      // Every remaining read miss is a DECLARED gap (the 0D4E model-info field — 07's atlas tiers);
      // an undeclared one would also fail the corpus-coverage join.
      expect(host.atlas.misses.filter((miss) => miss.kind === 'read' && !atlasTierOf(miss).declared)).toEqual([]);
    });

    it('firela holds its ladder parts level: pool walk → frames by name → SetRotate*Only (class B)', () => {
      const host = createRecordingHost({ cars: [{ handle: 257, model: 544 }] });
      const runner = new ScriptRunner({ host });
      runner.spawn(load('firela'), 'firela');
      for (let frame = 0; frame < 60; frame += 1) {
        runner.tick(1000 / 60);
      }
      expect(runner.faults).toEqual([]);
      const rotations = host.calls.filter((line) => line.startsWith('natives.setPartRotation car#257'));
      for (const part of ['misc_a', 'misc_b', 'misc_c']) {
        expect(rotations.some((line) => line.includes(`${part}#`))).toBe(true);
      }
      // SetRotate*Only(0.0) → identity quats — the mod pins the ladder against SA's default sway.
      expect(rotations[0]).toMatch(/quat\(0,0,0,1\)/);
    });

    it('vandoor probes door frames by name and SLIDES the door by the 095F ratio (class B)', () => {
      const host = createRecordingHost({ cars: [{ handle: 513, model: 582 }], doorAngleRatio: 0.5 });
      const runner = new ScriptRunner({ host });
      runner.spawn(load('vandoor'), 'vandoor');
      for (let frame = 0; frame < 60; frame += 1) {
        runner.tick(1000 / 60);
      }
      expect(runner.faults).toEqual([]);
      // dvan_l's matrix pos.y written with the door ratio — the slide itself.
      const slides = host.calls.filter((line) => line.startsWith('natives.setPartTranslation car#513'));
      expect(slides.some((line) => line.includes('dvan_l#') && line.includes('y=0.5'))).toBe(true);
    });

    it('rhino walks the REAL pool facade, finds the tank and drives its track frames (class B)', () => {
      // Handle 257 = slot 1, counter 1 — exactly what the byte-map walk reconstructs.
      const host = createRecordingHost({ cars: [{ handle: 257, model: 432 }] });
      const runner = new ScriptRunner({ host });
      const thread = runner.spawn(load('rhino'), 'rhino');
      const counts: number[] = [];
      for (let frame = 0; frame < 60; frame += 1) {
        runner.tick(1000 / 60);
        counts.push(runner.instructionsLastTick);
      }
      expect(runner.faults).toEqual([]);
      expect(thread.terminated).toBe(false);
      // The budget bound holds with the real walk running (the plan 03 re-measure).
      expect(Math.max(...counts)).toBeLessThan(10_000);
      // The walk found the tank through the byte map and rotated its track/wheel frames.
      expect(host.calls.some((line) => line.startsWith('natives.setPartRotation car#257'))).toBe(true);
    });

    it('cardoor (class C) degrades cleanly: unimplemented ped-task ops, zero faults', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      runner.spawn(load('cardoor-coach'), 'cardoor');
      for (let frame = 0; frame < 60; frame += 1) {
        runner.tick(1000 / 60);
      }
      expect(runner.faults).toEqual([]);
    });
  });
});

function namedId(calls: readonly string[], name: string): number {
  const line = calls.find((entry) => entry.startsWith(`models.byName ${name} -> `));

  return line ? Number(line.split(' -> ')[1]) : -1;
}
