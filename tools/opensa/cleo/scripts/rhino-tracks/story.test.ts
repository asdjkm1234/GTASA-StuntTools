import { createRecordingHost, decodeScript, ScriptRunner } from '@opensa/cleo';
import { describe, expect, it } from 'vitest';

import { compileScript } from '../../sdk/src/build';
import { script as definition, SPEC } from './script';

const FRAME_MS = 1000 / 60;
const CAR = 257;

/**
 * The rhino model's REAL emitted parts — `dump-vehicle-rig.ts` on `rhino.dff`, "parts the builder
 * emitted". The dummies (`Bradley_dummies`, `misc_e`) are deliberately ABSENT: they exist in the
 * DFF and are not parts, which is exactly what breaks the author's original. A test running on the
 * host's permissive default ("every asked name exists") would prove nothing.
 */
const RHINO_PARTS = [
  'chassis',
  'door_lf',
  'misc_a',
  'misc_b',
  'chassis_vlo',
  'ivflights',
  'wheel_big_0',
  ...Array.from({ length: 8 }, (_, index) => `wheel_small_${index + 1}`),
  'wheel_big_1',
  ...Array.from({ length: SPEC.TRACK_LINKS }, (_, index) => `track_${index + 1}`),
  'wheel_rf_dummy',
  'wheel_lf_dummy',
  'wheel_rm_dummy',
  'wheel_lm_dummy',
  'wheel_rb_dummy',
  'wheel_lb_dummy',
];

/** A reference-wheel frame whose roll reads back as `degrees`: heading = atan2(-forward.y, forward.z). */
const wheelRolledTo = (degrees: number): readonly [number, number, number] => [
  0,
  -Math.sin((degrees * Math.PI) / 180),
  Math.cos((degrees * Math.PI) / 180),
];

interface RunOptions {
  /** How many vehicles are in range (default 1). */
  readonly cars?: number;
  readonly parts?: readonly string[];
  readonly rolledTo?: number;
}

const run = (options: RunOptions = {}): { budget: number; calls: readonly string[] } => {
  const host = createRecordingHost({
    cars: Array.from({ length: options.cars ?? 1 }, (_, index) => ({ handle: CAR + index * 256, model: 432 })),
    partNames: options.parts ?? RHINO_PARTS,
    ...(options.rolledTo === undefined ? {} : { partForward: wheelRolledTo(options.rolledTo) }),
  });
  const runner = new ScriptRunner({ host });
  runner.spawn(decodeScript(compileScript(definition).bytes), definition.name);
  let budget = 0;
  for (let frame = 0; frame < 3; frame += 1) {
    runner.tick(FRAME_MS);
    budget = Math.max(budget, runner.instructionsLastTick);
  }
  expect(runner.faults).toEqual([]);

  return { budget, calls: host.calls };
};

/** Which `track_N` sat at z = 0 on the last frame — the one link the player sees. */
const visibleLinks = (calls: readonly string[]): readonly string[] =>
  calls
    .filter((line) => line.startsWith('natives.setPartTranslation') && line.includes('track_'))
    .slice(-SPEC.TRACK_LINKS)
    .filter((line) => line.endsWith('z=0'))
    .map((line) => line.split(' ')[2].split('#')[0]);

/**
 * The X-rotation a part was last given, in DEGREES (quat x = sin(angle / 2)). The trace rounds each
 * component to 3 decimals, which is the precision floor here — hence the loose tolerances below,
 * still far tighter than the 2x the wheel ratio has to show.
 */
const rollOf = (calls: readonly string[], part: string): number => {
  const lines = calls.filter((entry) => entry.startsWith(`natives.setPartRotation car#${CAR} ${part}#`));
  const [x, y, z] = (lines[lines.length - 1] ?? '')
    .replace(/^.*quat\(|\)$/g, '')
    .split(',')
    .map(Number);
  expect([y, z]).toEqual([0, 0]);

  return (2 * Math.asin(x) * 180) / Math.PI;
};

describe('rhino-tracks', () => {
  describe('negative cases', () => {
    it('leaves a model without track links completely alone — the name IS the capability test', () => {
      const { calls } = run({ parts: RHINO_PARTS.filter((part) => !part.startsWith('track_')) });
      expect(calls.filter((line) => line.startsWith('natives.setPartRotation'))).toEqual([]);
      expect(calls.filter((line) => line.startsWith('natives.setPartTranslation'))).toEqual([]);
    });

    it("never places a link at the original's -1e35 — the hide offset stays inside the world scale", () => {
      const { calls } = run({ rolledTo: 40 });
      const depths = calls
        .filter((line) => line.includes('track_') && line.includes(' z='))
        .map((line) => Number(line.split('z=')[1]));
      expect(depths.length).toBeGreaterThan(0);
      for (const depth of depths) {
        expect(Math.abs(depth)).toBeLessThanOrEqual(Math.abs(SPEC.HIDDEN_Z));
      }
    });
  });

  describe('positive cases', () => {
    it('shows exactly ONE link and parks the other eleven out of sight', () => {
      const { calls } = run({ rolledTo: 40 });
      const links = calls.filter((line) => line.startsWith('natives.setPartTranslation') && line.includes('track_'));
      // One write per link per frame — z only, so the x/y the author modelled survive.
      expect(links.slice(-SPEC.TRACK_LINKS)).toHaveLength(SPEC.TRACK_LINKS);
      expect(links.every((line) => line.includes(' z='))).toBe(true);
      expect(visibleLinks(calls)).toHaveLength(1);
    });

    it('a PARKED tank still shows a link — the defect that hides all twelve on the original', () => {
      // An unrotated reference wheel reads back as exactly 270 deg, and 270 = 15 x 18 lands on the
      // original ladder's uncovered point. Ours wraps, so link 1 takes it.
      const { calls } = run();
      expect(visibleLinks(calls)).toEqual(['track_1']);
    });

    it('the visible link steps once per 1.5 deg of roll and wraps every 18', () => {
      const seen = new Map<number, string>();
      for (const degrees of [0, 2, 5, 11, 17.9]) {
        seen.set(degrees, visibleLinks(run({ rolledTo: degrees }).calls)[0]);
      }
      expect([...seen.values()]).toEqual(['track_1', 'track_2', 'track_4', 'track_8', 'track_12']);
      // One full tread period later the flipbook is back where it started.
      expect(visibleLinks(run({ rolledTo: SPEC.TREAD_PERIOD_DEG + 2 }).calls)).toEqual(['track_2']);
    });

    it('rolls the wheels about X, with the small road wheels at twice the sprocket rate', () => {
      const { calls } = run({ rolledTo: 40 });
      const sprocket = rollOf(calls, 'wheel_big_0');
      expect(sprocket).toBeCloseTo(40, 1);
      expect(rollOf(calls, 'wheel_big_1')).toBeCloseTo(sprocket, 6);
      expect(rollOf(calls, 'wheel_small_1') / sprocket).toBeCloseTo(2, 2);
      expect(rollOf(calls, 'wheel_small_8') / sprocket).toBeCloseTo(2, 2);
    });

    it('stays within its declared per-tick budget with a tank in range', () => {
      const { budget } = run({ rolledTo: 40 });
      expect(budget).toBeGreaterThan(0);
      expect(budget).toBeLessThanOrEqual(definition.budgetPerTick);
    });

    it('costs almost nothing for a world with no tracked vehicle in it — the common frame', () => {
      // The declared budget is per TANK; what has to stay tiny is the frame that finds none. The
      // original paid its whole 139-slot pool walk here whether a tank existed or not.
      const empty = run({ cars: 0 }).budget;
      const traffic = run({ parts: RHINO_PARTS.filter((part) => !part.startsWith('track_')) }).budget;
      const tank = run({ rolledTo: 40 }).budget;
      expect(empty).toBeLessThan(20);
      expect(traffic).toBeLessThan(tank / 5);
    });

    it('builds deterministically and smaller than the 16 572 B it replaces', () => {
      const first = compileScript(definition);
      expect(first.artifact).toBe('rhino-tracks.cs');
      expect(first.warnings).toEqual([]);
      expect(first.bytes).toEqual(compileScript(definition).bytes);
      expect(first.bytes.length).toBeLessThan(16_572);
    });
  });
});
