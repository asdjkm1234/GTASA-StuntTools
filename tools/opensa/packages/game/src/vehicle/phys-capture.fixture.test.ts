/**
 * The `[phys]` protocol, tested against the REAL captures (plan 081/01).
 *
 * `phys-capture.test.ts` proves the maths on frames a test wrote; this proves the protocol on 28 laps a
 * browser actually drove — the committed BEFORE record in `docs/benchmarks/vehicle-physics/`. Real data
 * falsifies what synthetic data confirms: the aliased-orientation bug (every rate reading 0) passed every
 * hand-written frame in this repo and died the first time a capture was read.
 *
 * These files are the baseline plans 081/02-07 are judged against, so what is asserted here is the CONTRACT
 * that makes them comparable — the column list, the units, the conventions, the peaks-over-every-frame rule.
 * Not the values: a later plan is SUPPOSED to move those (its regression pack is plan 07's job).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { PhysSummary } from './phys-capture';

/** One `[phys]` line as the runner prints it (`engine-phys-runs.ts`). */
interface Capture {
  car: string;
  columns: string[];
  key: string;
  series: number[][];
  seriesHz: number;
  summary: PhysSummary;
  what: string;
}

const RECORD_DIR = join(import.meta.dirname, '../../../../docs/benchmarks/vehicle-physics');

/** The documented column order — the readme's schema, and what `phys-compare` indexes by. */
const COLUMNS = ['t', 'speed', 'slipAngle', 'pitch', 'roll', 'yawRate', 'gLong', 'gLat', 'gVert', 'throttle', 'steer'];
/** Where the car was, appended 2026-07-27 (081/06 §2) — at the END, so a capture taken before it still
 *  compares column-for-column with one taken after. A capture carries all three or none. */
const POSITION_COLUMNS = ['x', 'y', 'z'];

const files = readdirSync(RECORD_DIR).filter((name) => name.endsWith('.json'));
const read = (name: string): Capture[] => JSON.parse(readFileSync(join(RECORD_DIR, name), 'utf8')) as Capture[];
const captures: Capture[] = files.flatMap(read);
/** The BEFORE matrix alone — the complete four-car sweep every later plan is measured against. */
const matrix: Capture[] = files.filter((name) => name.includes('-before-')).flatMap(read);
const column = (capture: Capture, name: string): number[] => {
  const index = capture.columns.indexOf(name);

  return capture.series.map((row) => row[index]);
};
const named = (car: string, key: string): Capture => {
  const found = captures.find((capture) => capture.car === car && capture.key === key);
  if (!found) {
    throw new Error(`no capture for ${car}/${key} in the record`);
  }

  return found;
};

describe('the [phys] capture record', () => {
  describe('negative cases', () => {
    it('has captures at all — an empty record would make every assertion below vacuous', () => {
      expect(files.length).toBeGreaterThanOrEqual(3);
      expect(captures.length).toBeGreaterThanOrEqual(21);
    });

    it('never reports a peak the thinned series alone could not justify', () => {
      // The summary is taken over EVERY fixed step and the series is thinned, so the summary must BOUND the
      // series. A peak inside the series that the summary missed means the summary read the wrong frames.
      for (const capture of captures) {
        const label = `${capture.car}/${capture.key}`;
        expect(Math.max(...column(capture, 'roll')) * (180 / Math.PI), label).toBeLessThanOrEqual(
          capture.summary.rollDeg.max + 0.01,
        );
        expect(Math.max(...column(capture, 'pitch')) * (180 / Math.PI), label).toBeLessThanOrEqual(
          capture.summary.pitchDeg.max + 0.01,
        );
        expect(Math.min(...column(capture, 'gLong')), label).toBeGreaterThanOrEqual(capture.summary.gLong.min - 0.01);
      }
    });

    it('never claims a flip a lap did not have (and never misses one it did)', () => {
      for (const capture of captures) {
        const rolled = Math.max(...column(capture, 'roll').map((value) => Math.abs(value))) * (180 / Math.PI);
        const label = `${capture.car}/${capture.key}`;
        if (capture.summary.flip === null) {
          // A thinned series can miss a brief flip, so absence only has to be consistent with the peak.
          expect(Math.abs(capture.summary.rollDeg.max), label).toBeLessThan(90.01);
          expect(Math.abs(capture.summary.rollDeg.min), label).toBeLessThan(90.01);
        } else {
          expect(rolled, label).toBeGreaterThan(45); // it rolled far enough to be visible even when thinned
        }
      }
    });

    it('never reports air time or a braking run longer than the lap itself', () => {
      for (const capture of captures) {
        const label = `${capture.car}/${capture.key}`;
        expect(capture.summary.airborneS, label).toBeLessThanOrEqual(capture.summary.durationS);
        if (capture.summary.brake !== null) {
          expect(capture.summary.brake.seconds, label).toBeLessThanOrEqual(capture.summary.durationS);
          expect(capture.summary.brake.fromKmh, label).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('positive cases', () => {
    it('stores every lap in the documented shape', () => {
      for (const capture of captures) {
        const expected = capture.columns.length === COLUMNS.length ? COLUMNS : [...COLUMNS, ...POSITION_COLUMNS];
        expect(capture.columns, `${capture.car}/${capture.key}`).toEqual(expected);
        expect(capture.seriesHz).toBe(20);
        expect(capture.what.length).toBeGreaterThan(20); // a scene that cannot say what it is for is not evidence
        expect(capture.series.every((row) => row.length === capture.columns.length)).toBe(true);
        expect(capture.summary.frames).toBeGreaterThan(capture.series.length); // the series IS thinned
      }
    });

    it('runs its clock forward at the fixed step, monotonically', () => {
      for (const capture of captures) {
        const t = column(capture, 't');
        expect(t.every((value, index) => index === 0 || value > t[index - 1])).toBe(true);
        expect(capture.summary.durationS).toBeGreaterThan(t[t.length - 1] - 0.1);
      }
    });

    it('keeps the rate channels alive — the aliasing bug reported every one of them as zero', () => {
      // Any lap that turned must show yaw rate somewhere in its series. Asserting it across the record is
      // what would have caught `previous.orientation` aliasing `sample.orientation` on the first run.
      const turning = captures.filter((capture) => Math.abs(capture.summary.turnedDeg) > 20);
      expect(turning.length).toBeGreaterThan(3);
      for (const capture of turning) {
        expect(Math.max(...column(capture, 'yawRate').map(Math.abs)), `${capture.car}/${capture.key}`).toBeGreaterThan(
          0.05,
        );
      }
    });

    it('holds the sign conventions on a lap that can only mean one thing', () => {
      // A dead-straight brake strip: the throttle is held to 1, then released with the brake on. Speed must
      // be positive throughout (forward), and the lap must end stopped.
      const strip = named('infernus', 'brake-strip');
      const speed = column(strip, 'speed');
      expect(Math.min(...speed)).toBeGreaterThanOrEqual(-0.01); // never reverses
      expect(speed[speed.length - 1]).toBeLessThan(0.5); // ends stopped
      expect(column(strip, 'throttle')[0]).toBe(1);
      expect(strip.summary.brake).not.toBeNull();
    });

    it('reproduces the same lap across cars — the BEFORE matrix is the same scene set for every one', () => {
      // Scoped to the matrix on purpose. The record also holds targeted A/B captures (one scene, two cars,
      // to isolate one change), and demanding a full matrix of those would make every focused measurement
      // an illegal one. What must hold is that the baseline every later plan is judged against is complete.
      const byCar = new Map<string, Set<string>>();
      for (const capture of matrix) {
        byCar.set(capture.car, (byCar.get(capture.car) ?? new Set()).add(capture.key));
      }
      const scenes = [...byCar.values()].map((keys) => [...keys].sort().join(','));
      expect(new Set(scenes).size).toBe(1); // every car ran an identical scene set
      expect(byCar.size).toBeGreaterThanOrEqual(3);
    });
  });
});
