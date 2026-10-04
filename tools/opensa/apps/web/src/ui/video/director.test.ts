import { mulberry32 } from '@opensa/game/paths/rng';
import { describe, expect, it } from 'vitest';

import type { StationSource } from './director';

import {
  createDirector,
  type DirectorFrame,
  EMPTY_FRAME_SECONDS,
  nextStationSlot,
  PAN_RATE_MAX,
  PASSED_SECONDS,
  planShots,
  SAFE_FRAME,
  type ShotPlan,
  SIGHTLINE_MISSES,
  SIGHTLINE_SECONDS,
  stepDirector,
} from './director';
import {
  forwardFromHeading,
  PLANTED_CEILING_SECONDS,
  plantedEyeCandidates,
  type PosedShot,
  shotEye,
  SHOTS,
  SHOTS_PER_SCENE,
  type Subject,
  TRACKING_SECONDS,
} from './shots';

const ASPECT = 16 / 9;
const DT = 1 / 60;
const HALF_EXTENTS = [0.9, 2.3, 0.7] as const;

const WING: PosedShot = {
  anchor: { x: 0.38, y: 0.58 },
  eyeSmooth: 0.18,
  fovYRad: Math.PI / 4,
  kind: 'tracking',
  maxDist: 40,
  name: 'wing-l',
  offset: { forward: 0.4, height: 1.6, lateral: -5 },
  targetSmooth: 0.14,
  weight: 2,
};

const CHASE = SHOTS.find((shot) => shot.kind === 'chase') ?? SHOTS[0];
const FLYBY = SHOTS.find((shot) => shot.name === 'flyby') ?? SHOTS[0];
const STATION = SHOTS.find((shot) => shot.kind === 'station') ?? SHOTS[0];

/** A stand-in survey: hands out one eye, and answers the live sightline however the test says. */
const stationSource = (
  eye: [number, number, number] | null,
  clear: () => boolean = () => true,
): StationSource & { asked: number } => {
  const source = {
    asked: 0,
    sightline(): boolean {
      source.asked += 1;

      return clear();
    },
    take: (): [number, number, number] | null => eye,
  };

  return source satisfies StationSource & { asked: number };
};

/** A car driving along engine −Z at `speed`, `seconds` after the start. */
const drivingSubject = (seconds: number, speed = 12): Subject => ({
  forward: forwardFromHeading(0),
  halfExtents: HALF_EXTENTS,
  position: [0, 0.6, -speed * seconds],
  speed,
});

/** Run the director over a straight cruise and hand back every frame it produced. */
const cruise = (plan: readonly ShotPlan[], seconds: number, speed = 12): DirectorFrame[] => {
  const state = createDirector(plan);
  const frames: DirectorFrame[] = [];
  for (let frame = 0; frame * DT < seconds; frame += 1) {
    frames.push(stepDirector(state, drivingSubject(frame * DT, speed), DT, ASPECT));
  }

  return frames;
};

describe('planShots', () => {
  describe('negative cases', () => {
    it('never deals more or fewer than the five cameras a scene is made of', () => {
      for (let seed = 0; seed < 40; seed += 1) {
        expect(planShots(mulberry32(seed)).length).toBe(SHOTS_PER_SCENE);
      }
    });

    it("never spends two of a scene's five slots on the same camera", () => {
      // "Five cameras" means five DIFFERENT ones: a repeat inside one scene shows the same angle twice and
      // costs a slot, which with nine presets to draw from is never necessary.
      for (let seed = 0; seed < 40; seed += 1) {
        const names = planShots(mulberry32(seed)).map((entry) => entry.preset.name);

        expect(new Set(names).size).toBe(names.length);
      }
    });
  });

  describe('positive cases', () => {
    it('gives a riding shot its fixed clip and a planted one only its watchdog', () => {
      // The two kinds end for different reasons: a shot that rides the car has no natural end, so it runs
      // TRACKING_SECONDS; a planted one ends when the car has left its frame, and its number is the ceiling
      // that stops a scene which has stopped happening.
      for (let seed = 0; seed < 40; seed += 1) {
        for (const entry of planShots(mulberry32(seed))) {
          const planted = entry.preset.kind === 'static' || entry.preset.kind === 'station';

          expect(entry.seconds).toBe(planted ? PLANTED_CEILING_SECONDS : TRACKING_SECONDS);
        }
      }
    });

    it('always shows the game as it is played — chase appears at least once', () => {
      for (let seed = 0; seed < 40; seed += 1) {
        const plan = planShots(mulberry32(seed));

        expect(plan.some((entry) => entry.preset.kind === 'chase')).toBe(true);
      }
    });

    it('reproduces itself from the seed, shot for shot and second for second', () => {
      expect(planShots(mulberry32(47))).toEqual(planShots(mulberry32(47)));
    });
  });
});

describe('stepDirector', () => {
  describe('negative cases', () => {
    it('does not cut inside a shot that is still framing its car', () => {
      const frames = cruise([{ preset: WING, seconds: 6 }], 5);

      expect(frames.filter((frame) => frame.cut).length).toBe(1); // the opening frame only
    });

    it('never swings the aim faster than the pan cap, however hard the car cuts across', () => {
      // A static camera the car passes at 30 m/s from 6 m out — the geometry that would whip.
      const state = createDirector([{ preset: FLYBY, seconds: 8 }]);
      let previous: [number, number, number] | null = null;
      let worst = 0;
      for (let frame = 0; frame < 300; frame += 1) {
        const at = frame * DT;
        const subject: Subject = {
          forward: forwardFromHeading(0),
          halfExtents: HALF_EXTENTS,
          position: [6, 0.6, 40 - 30 * at],
          speed: 30,
        };
        const { cut, pose } = stepDirector(state, subject, DT, ASPECT);
        if (!pose) {
          continue;
        }
        const direction = unit(pose.target, pose.eye);
        // A declared cut IS a discontinuity — the cap governs the frames BETWEEN cuts, which is exactly what
        // the watchdog is left holding the director to.
        if (previous !== null && !cut) {
          worst = Math.max(worst, Math.acos(Math.min(1, dot(previous, direction))) / DT);
        }
        previous = direction;
      }

      expect(worst).toBeLessThanOrEqual(PAN_RATE_MAX + 1e-6);
    });

    it('does not let an irregular frame clock shake a car-mounted shot', () => {
      // The field bug this pins (096 field round 1): a `tracking` eye damped in WORLD space against a car at
      // a cruise carries a permanent lag, and the per-frame catch-up step scales with `dt` — so an uneven
      // frame clock modulates it and the mount buzzes along the travel axis. A headless run measured 3.1 ms
      // RMS of frame-clock jitter on a healthy 120 fps scene; these steps are that, rounded to the coarse.
      const steps = [1 / 120, 1 / 40, 1 / 120, 1 / 120, 1 / 60, 1 / 120, 1 / 90, 1 / 120];
      const state = createDirector([{ preset: WING, seconds: 30 }]);
      const mounts: number[] = [];
      let at = 0;
      for (let frame = 0; frame < 400; frame += 1) {
        const dt = steps[frame % steps.length];
        at += dt;
        const subject = drivingSubject(at);
        const { pose } = stepDirector(state, subject, dt, ASPECT);
        // The opening frame SNAPS by design, and the frames after it are the damper settling — neither is
        // what this measures. Everything from a second in is the shot as a viewer sees it.
        if (pose && at > 1) {
          mounts.push(pose.eye[2] - subject.position[2]); // the mount along the travel axis (heading 0 = −Z)
        }
      }
      const spread = Math.max(...mounts) - Math.min(...mounts);

      // Rigid means rigid: a constant-speed drive must leave the mount NOTHING to damp, whatever the clock
      // does. Damped in world space this same drive wandered by ~0.2 m and read as a 6 px/frame² shiver.
      expect(spread).toBeLessThan(0.001);
    });

    it('does not cut a tripod on ONE blocked probe — a lamppost is not a lost shot', () => {
      const state = createDirector([{ preset: STATION, seconds: 20 }]);
      const source = stationSource([14, 2, -20], () => false);
      for (let frame = 0; frame * DT < SIGHTLINE_SECONDS * SIGHTLINE_MISSES - 0.2; frame += 1) {
        stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, source);
      }

      expect(state.misses).toBe(SIGHTLINE_MISSES - 1);
      expect(state.causes.occluded).toBe(0);
    });

    it('asks the sightline once a second, not once a frame', () => {
      const state = createDirector([{ preset: STATION, seconds: 20 }]);
      const source = stationSource([14, 2, -20]);
      for (let frame = 0; frame < 180; frame += 1) {
        stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, source);
      }

      // Three seconds of frames, three probes — the budget the whole design rests on.
      expect(source.asked).toBe(3);
    });

    it('never asks the sightline for a car-anchored shot — only a tripod has one to lose', () => {
      const state = createDirector([{ preset: WING, seconds: 20 }]);
      const source = stationSource(null);
      for (let frame = 0; frame < 180; frame += 1) {
        stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, source);
      }

      expect(source.asked).toBe(0);
    });

    it('does not judge framing while the chase rig owns the frame', () => {
      const state = createDirector([{ preset: CHASE, seconds: 6 }]);
      for (let frame = 0; frame < 120; frame += 1) {
        stepDirector(state, drivingSubject(frame * DT), DT, ASPECT);
      }

      expect(state.framesJudged).toBe(0);
      expect(state.eye).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('opens on a declared cut and hands the shot its pose on the very first frame', () => {
      const [first] = cruise([{ preset: WING, seconds: 6 }], 1);

      expect(first.cut).toBe(true);
      expect(first.pose).not.toBeNull();
      expect(first.shot).toBe('wing-l');
    });

    it('yields the frame to the shipped rig for a chase shot, and declares the hand-over', () => {
      const frames = cruise(
        [
          { preset: WING, seconds: 5 },
          { preset: CHASE, seconds: 5 },
        ],
        7,
      );
      const handover = frames.findIndex((frame) => frame.pose === null);

      expect(handover).toBeGreaterThan(0);
      expect(frames[handover].cut).toBe(true);
      expect(frames[handover].shot).toBe('chase');
    });

    it('keeps the car inside the safe frame through a straight cruise', () => {
      const frames = cruise([{ preset: WING, seconds: 20 }], 8).filter((frame) => frame.screen !== null);
      const off = frames.filter(
        (frame) =>
          Math.abs((frame.screen?.x ?? 0.5) - 0.5) > SAFE_FRAME ||
          Math.abs((frame.screen?.y ?? 0.5) - 0.5) > SAFE_FRAME,
      );

      expect(off.length).toBe(0);
    });

    it('cuts a shot short once the car has been out of frame for the guard window', () => {
      // A static shot the car drives away from: it leaves frame and never comes back.
      const state = createDirector([
        { preset: FLYBY, seconds: 30 },
        { preset: WING, seconds: 6 },
      ]);
      stepDirector(state, drivingSubject(0, 25), DT, ASPECT); // the opening frame is a cut by definition
      let cutAt = -1;
      for (let frame = 1; frame < 1800 && cutAt < 0; frame += 1) {
        const step = stepDirector(state, drivingSubject(frame * DT, 25), DT, ASPECT);
        if (step.cut) {
          cutAt = frame * DT;
        }
      }

      expect(cutAt).toBeGreaterThan(EMPTY_FRAME_SECONDS);
      expect(cutAt).toBeLessThan(30); // long before the shot's own clock would have ended it
      expect(state.plan[state.index].preset.name).toBe('wing-l');
    });

    it('stands the tripod where the survey put it, and never moves it', () => {
      const state = createDirector([{ preset: STATION, seconds: 20 }]);
      const eye: [number, number, number] = [14, 2, -20];
      const first = stepDirector(state, drivingSubject(0), DT, ASPECT, stationSource(eye));
      let last = first;
      for (let frame = 1; frame < 120; frame += 1) {
        last = stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, stationSource(eye));
      }

      expect(first.pose?.eye).toEqual(eye);
      expect(last.pose?.eye).toEqual(eye); // the aim tracked the car; the stand did not budge
      expect(last.pose?.target).not.toEqual(first.pose?.target);
    });

    it('cuts a tripod away after two blocked probes in a row, and says why', () => {
      const state = createDirector([
        { preset: STATION, seconds: 30 },
        { preset: WING, seconds: 6 },
      ]);
      const source = stationSource([14, 2, -20], () => false);
      stepDirector(state, drivingSubject(0), DT, ASPECT, source); // the opening frame is a cut by definition
      let cutAt = -1;
      for (let frame = 1; frame < 600 && cutAt < 0; frame += 1) {
        const step = stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, source);
        if (step.cut) {
          cutAt = frame * DT;
          expect(step.cutCause).toBe('occluded');
        }
      }

      expect(cutAt).toBeGreaterThanOrEqual(SIGHTLINE_SECONDS * SIGHTLINE_MISSES);
      expect(state.causes.occluded).toBe(1);
      expect(state.plan[state.index].preset.name).toBe('wing-l');
    });

    it('plays the plan fallback when the survey came back empty — a missing station costs variety, not a scene', () => {
      const state = createDirector([{ fallback: WING, preset: STATION, seconds: 20 }]);
      const frame = stepDirector(state, drivingSubject(0), DT, ASPECT, stationSource(null));

      expect(frame.shot).toBe('wing-l');
      expect(frame.pose).not.toBeNull();
      expect(state.fallbacks).toBe(1);
    });

    it('treats a car past the shot distance ceiling as an empty frame', () => {
      const state = createDirector([
        { preset: STATION, seconds: 60 },
        { preset: WING, seconds: 6 },
      ]);
      const source = stationSource([0, 2, 0]);
      stepDirector(state, drivingSubject(0, 20), DT, ASPECT, source);
      let cutAt = -1;
      for (let frame = 1; frame < 3600 && cutAt < 0; frame += 1) {
        const step = stepDirector(state, drivingSubject(frame * DT, 20), DT, ASPECT, source);
        if (step.cut) {
          cutAt = frame * DT;
          expect(step.cutCause).toBe('empty');
        }
      }
      // The car passes 70 m at 3.5 s and the guard waits its window out on top of that.
      expect(cutAt).toBeGreaterThan(STATION.kind === 'chase' ? 0 : 3.5);
      expect(cutAt).toBeLessThan(3.5 + EMPTY_FRAME_SECONDS + 0.5);
    });

    it('ends a planted shot when the car has GONE, long before its watchdog', () => {
      // The user's 2026-07-31 rule for a camera filming a passing car: it runs "until the car has driven out
      // of view". So the watchdog must not be what ends it — and a car that is past the distance ceiling is
      // GONE rather than possibly-behind-a-lamppost, which is the shorter of the two clocks.
      const state = createDirector([{ preset: FLYBY, seconds: PLANTED_CEILING_SECONDS }]);
      let at = 0;
      let goneAt = 0;
      for (let frame = 0; frame < 3000 && !state.done; frame += 1) {
        at += DT;
        stepDirector(state, drivingSubject(at, 20), DT, ASPECT);
        if (goneAt === 0 && state.passed) {
          goneAt = at;
        }
      }

      expect(state.causes.empty).toBe(1); // the car leaving ended it…
      expect(state.causes.scheduled).toBe(0); // …not the clock…
      expect(state.causes.watchdog).toBe(0); // …and not the watchdog either
      expect(at).toBeLessThan(PLANTED_CEILING_SECONDS);
      // And PROMPTLY: within the short clock of the car going, not the patient one a lamppost earns. The
      // difference is a second of empty road at the tail of every drive-past — footage to trim by hand.
      expect(at - goneAt).toBeLessThan(PASSED_SECONDS + 2 * DT);
      expect(PASSED_SECONDS).toBeLessThan(EMPTY_FRAME_SECONDS);
    });

    it('names a PLANTED shot ending on its clock `watchdog`, not `scheduled`', () => {
      // The two are one event in the code and two different facts about the footage (096/08): `scheduled` is
      // a riding shot's chosen 10 s clip running out, `watchdog` is a planted shot the car never left — a
      // shot whose length nobody chose. While they shared a name the soak could only BOUND how often the
      // second happens (up to 10 of 30 planted shots), which is the question D4 exists to answer.
      const state = createDirector([{ preset: FLYBY, seconds: PLANTED_CEILING_SECONDS }]);
      let at = 0;
      for (let frame = 0; frame < 3000 && !state.done; frame += 1) {
        at += DT;
        stepDirector(state, drivingSubject(0, 0), DT, ASPECT); // a car that stands still never leaves the frame
      }

      expect(state.causes.watchdog).toBe(1);
      expect(state.causes.scheduled).toBe(0);
      expect(at).toBeGreaterThanOrEqual(PLANTED_CEILING_SECONDS);
    });

    it('still names a RIDING shot ending on its clip `scheduled`', () => {
      const state = createDirector([{ preset: WING, seconds: TRACKING_SECONDS }]);
      let at = 0;
      for (let frame = 0; frame < 3000 && !state.done; frame += 1) {
        at += DT;
        stepDirector(state, drivingSubject(at), DT, ASPECT);
      }

      expect(state.causes.scheduled).toBe(1);
      expect(state.causes.watchdog).toBe(0);
    });

    it('ENDS on the last shot instead of wrapping — the list is the scene', () => {
      // The 2026-07-31 model: five cameras, and the scene is over when they are. Wrapping (what this used to
      // do, so a fragment could outlive its list) would make a scene run until some other clock stopped it.
      const state = createDirector([
        { preset: WING, seconds: 5 },
        { preset: FLYBY, seconds: 5 },
      ]);
      let at = 0;
      for (let frame = 0; frame < 900 && !state.done; frame += 1) {
        at += DT;
        stepDirector(state, drivingSubject(at), DT, ASPECT);
      }

      expect(state.done).toBe(true);
      expect(state.index).toBe(1); // stopped ON the last shot, never rolled back to the first
      expect(at).toBeLessThan(12); // and it did not wait out a second lap of the list
    });

    it('reproduces itself exactly from the same plan and the same drive', () => {
      const plan = planShots(mulberry32(11));

      expect(cruise(plan, 15)).toEqual(cruise(plan, 15));
    });
  });
});

describe('nextStationSlot', () => {
  describe('negative cases', () => {
    it('finds nothing in a plan with no tripod in it', () => {
      const state = createDirector([
        { preset: WING, seconds: 5 },
        { preset: CHASE, seconds: 5 },
      ]);

      expect(nextStationSlot(state)).toBeNull();
    });

    it('skips the tripod that is already PLAYING — its eye was taken when it started', () => {
      const state = createDirector([
        { preset: STATION, seconds: 6 },
        { preset: WING, seconds: 5 },
      ]);
      stepDirector(state, drivingSubject(0), DT, ASPECT, stationSource([14, 2, -20]));

      // The next one is the same slot a lap later, with the whole list to survey in.
      expect(nextStationSlot(state)?.index).toBe(0);
      expect(nextStationSlot(state)?.startsIn).toBeGreaterThan(6);
    });
  });

  describe('positive cases', () => {
    it('reports a tripod that has not started yet, so a scene opening on one can still be surveyed', () => {
      const state = createDirector([
        { preset: STATION, seconds: 6 },
        { preset: WING, seconds: 5 },
      ]);

      expect(nextStationSlot(state)).toEqual({ index: 0, seconds: 6, startsIn: 0 });
    });

    it('says when the next tripod starts, counting what is left of the shot in play', () => {
      const state = createDirector([
        { preset: WING, seconds: 6 },
        { preset: CHASE, seconds: 5 },
        { preset: STATION, seconds: 7 },
      ]);
      stepDirector(state, drivingSubject(0), 2, ASPECT); // two seconds into the first shot

      const slot = nextStationSlot(state);

      expect(slot?.index).toBe(2);
      expect(slot?.seconds).toBe(7);
      expect(slot?.startsIn).toBeCloseTo(4 + 5, 6);
    });
  });
});

describe('stepDirector — where a planted shot stands (096/09)', () => {
  describe('negative cases', () => {
    it('gives the shot up when every spot it can reach is inside something', () => {
      const state = createDirector([{ preset: FLYBY, seconds: 6 }]);
      const source = stationSource(null, () => false);
      const frame = stepDirector(state, drivingSubject(0), DT, ASPECT, source);

      // Filming from inside a wall is worse than not filming: the slot plays its fallback, exactly as a
      // tripod slot does when the survey finds nowhere to stand.
      expect(frame.shot).not.toBe('flyby');
      expect(state.fallbacks).toBe(1);
      expect(state.blockedPlants).toBe(plantedEyeCandidates(FLYBY as PosedShot, drivingSubject(0)).length);
    });

    it('plants unchecked when there is no probe to ask', () => {
      const state = createDirector([{ preset: FLYBY, seconds: 6 }]);
      stepDirector(state, drivingSubject(0), DT, ASPECT);

      // The director has to stay usable without a physics world — that is what every other test here runs on.
      expect(state.staticEye).toEqual(shotEye(FLYBY as PosedShot, drivingSubject(0)));
      expect(state.blockedPlants).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('keeps the authored spot when it is clear', () => {
      const state = createDirector([{ preset: FLYBY, seconds: 6 }]);
      const source = stationSource(null);
      const frame = stepDirector(state, drivingSubject(0), DT, ASPECT, source);

      expect(frame.shot).toBe('flyby');
      expect(state.staticEye).toEqual(shotEye(FLYBY as PosedShot, drivingSubject(0)));
      expect(state.blockedPlants).toBe(0);
    });

    it('steps to the next spot when the authored one is blocked', () => {
      const state = createDirector([{ preset: FLYBY, seconds: 6 }]);
      let asked = 0;
      const source = stationSource(null, () => {
        asked += 1;

        return asked > 1;
      });
      const frame = stepDirector(state, drivingSubject(0), DT, ASPECT, source);
      const candidates = plantedEyeCandidates(FLYBY as PosedShot, drivingSubject(0));

      // The shot survives; only its spot moved, and to the NEXT candidate — the far side of the road.
      expect(frame.shot).toBe('flyby');
      expect(state.staticEye).toEqual(candidates[1]);
      expect(state.blockedPlants).toBe(1);
    });

    it('checks the plant ONCE per shot — a planted eye never moves again', () => {
      const state = createDirector([{ preset: FLYBY, seconds: 6 }]);
      const source = stationSource(null);
      for (let frame = 0; frame < 180; frame += 1) {
        stepDirector(state, drivingSubject(frame * DT), DT, ASPECT, source);
      }

      // One probe for the plant. A tripod's live sightline is a separate budget and this shot has none.
      expect(source.asked).toBe(1);
    });
  });
});

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(
  to: readonly [number, number, number],
  from: readonly [number, number, number],
): [number, number, number] {
  const delta: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.hypot(...delta) || 1;

  return [delta[0] / length, delta[1] / length, delta[2] / length];
}
