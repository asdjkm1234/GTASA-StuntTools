import { describe, expect, it } from 'vitest';

import {
  aimShot,
  anchorFor,
  forwardFromHeading,
  PLANTED_CEILING_SECONDS,
  plantedEyeCandidates,
  type PosedShot,
  projectToScreen,
  SHOT_ROAD_SECONDS,
  shotEye,
  SHOTS,
  shotSeconds,
  type Subject,
  TRACKING_SECONDS,
  WALK_SHOTS,
} from './shots';

const ASPECT = 16 / 9;
/** A saloon's own numbers (`admiral`-sized): half width, half length, half height. */
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

/** A car at the origin, driving along its own heading at `speed`. */
const subjectAt = (
  heading: number,
  speed: number,
  position: readonly [number, number, number] = [0, 0, 0],
): Subject => ({
  forward: forwardFromHeading(heading),
  halfExtents: HALF_EXTENTS,
  position,
  speed,
});

describe('forwardFromHeading', () => {
  describe('positive cases', () => {
    it('faces engine −Z at heading 0 (GTA +Y) and engine +X at heading −pi/2', () => {
      const [ax, ay, az] = forwardFromHeading(0);
      expect(ax).toBeCloseTo(0, 6);
      expect(ay).toBe(0);
      expect(az).toBeCloseTo(-1, 6);

      const [bx, , bz] = forwardFromHeading(-Math.PI / 2);
      expect(bx).toBeCloseTo(1, 6);
      expect(bz).toBeCloseTo(0, 6);
    });
  });
});

describe('shotEye', () => {
  describe('negative cases', () => {
    it('writes no metre of its own — a car twice the size is filmed twice as far out', () => {
      const small = shotEye(WING, subjectAt(0, 12));
      const large = shotEye(WING, { ...subjectAt(0, 12), halfExtents: [1.8, 4.6, 1.4] });

      expect(Math.hypot(large[0], large[2])).toBeCloseTo(2 * Math.hypot(small[0], small[2]), 6);
      expect(large[1]).toBeCloseTo(2 * small[1], 6);
    });
  });

  describe('positive cases', () => {
    it('puts a lateral offset on the side of the car it belongs to, whatever way the car faces', () => {
      // Heading 0 faces engine −Z, so the car's right is engine +X and a −5 lateral sits at −X.
      const north = shotEye(WING, subjectAt(0, 12));
      expect(north[0]).toBeCloseTo(-5 * HALF_EXTENTS[0], 6);
      expect(north[2]).toBeCloseTo(-0.4 * HALF_EXTENTS[1], 6);

      // Turn the car a quarter turn and the SAME offset follows it round.
      const east = shotEye(WING, subjectAt(-Math.PI / 2, 12));
      expect(east[2]).toBeCloseTo(-5 * HALF_EXTENTS[0], 6);
      expect(east[0]).toBeCloseTo(0.4 * HALF_EXTENTS[1], 6);
    });

    it('lifts by the height the car itself has', () => {
      expect(shotEye(WING, subjectAt(0, 12))[1]).toBeCloseTo(1.6 * HALF_EXTENTS[2], 6);
    });
  });
});

describe('plantedEyeCandidates', () => {
  describe('negative cases', () => {
    it('writes no metre of its own — every rung scales with the car it films', () => {
      // The same rule `shotEye` obeys, and it has to hold for the LADDER too: a rung that carried a metre of
      // its own would put a bus's fallback spot where a Bandito's belongs (CLAUDE.md's no-hardcoded-asset
      // rule). Doubling the car doubles every candidate's distance, rung for rung.
      const small = plantedEyeCandidates(WING, subjectAt(0, 12));
      const large = plantedEyeCandidates(WING, { ...subjectAt(0, 12), halfExtents: [1.8, 4.6, 1.4] });

      expect(large.length).toBe(small.length);
      for (const [at, eye] of large.entries()) {
        expect(Math.hypot(eye[0], eye[2])).toBeCloseTo(2 * Math.hypot(small[at][0], small[at][2]), 6);
        expect(eye[1]).toBeCloseTo(2 * small[at][1], 6);
      }
    });

    it('never offers more rungs than the frame can pay for', () => {
      // Each rung is one cast and they are all spent on the frame the shot starts. 080's ground rule is
      // <= 5 casts/frame for the whole game and the follow rig already spends 2
      // (`docs/restrictions/architecture.md`). Three is the ceiling, not a preference.
      expect(plantedEyeCandidates(WING, subjectAt(0, 12)).length).toBeLessThanOrEqual(3);
    });
  });

  describe('positive cases', () => {
    it('offers the authored spot first, so a clear one never moves the camera', () => {
      expect(plantedEyeCandidates(WING, subjectAt(0, 12))[0]).toEqual(shotEye(WING, subjectAt(0, 12)));
    });

    it('puts the second rung on the far side of the car and the third overhead', () => {
      const subject = subjectAt(0, 12);
      const [authored, mirrored, raised] = plantedEyeCandidates(WING, subject);

      // Mirrored: same height, lateral reflected through the car — a street blocked from one side only.
      expect(mirrored[1]).toBeCloseTo(authored[1], 6);
      expect(mirrored[0] - subject.position[0]).toBeCloseTo(-(authored[0] - subject.position[0]), 6);
      // Raised: same ground position, twice the lift — over whatever is in the way.
      expect(raised[0]).toBeCloseTo(authored[0], 6);
      expect(raised[2]).toBeCloseTo(authored[2], 6);
      expect(raised[1] - subject.position[1]).toBeCloseTo(2 * (authored[1] - subject.position[1]), 6);
    });

    it('gives every rung a DISTINCT spot — a repeat would spend a cast on the same answer', () => {
      const keys = plantedEyeCandidates(WING, subjectAt(0, 12)).map((eye) => eye.map((c) => c.toFixed(4)).join());

      expect(new Set(keys).size).toBe(keys.length);
    });
  });
});

describe('aimShot', () => {
  const CASES = [
    { anchor: { x: 0.38, y: 0.58 }, distance: 6, fovYRad: Math.PI / 4 },
    { anchor: { x: 0.5, y: 0.5 }, distance: 6, fovYRad: Math.PI / 3 },
    { anchor: { x: 0.62, y: 0.35 }, distance: 25, fovYRad: (40 * Math.PI) / 180 },
    { anchor: { x: 0.3, y: 0.7 }, distance: 60, fovYRad: (55 * Math.PI) / 180 },
  ];

  describe('negative cases', () => {
    it('does not drag the car to the centre — an off-centre anchor stays off-centre', () => {
      const eye: [number, number, number] = [0, 2, 12];
      const target = aimShot(eye, [0, 1, 0], { x: 0.38, y: 0.58 }, Math.PI / 4, ASPECT);
      const screen = projectToScreen(eye, target, Math.PI / 4, ASPECT, [0, 1, 0]);

      expect(Math.abs(screen.x - 0.5)).toBeGreaterThan(0.05);
    });
  });

  describe('positive cases', () => {
    it('lands the car on its anchor at every distance and lens the presets use', () => {
      for (const { anchor, distance, fovYRad } of CASES) {
        const eye: [number, number, number] = [0, 2, distance];
        const target = aimShot(eye, [0, 1, 0], anchor, fovYRad, ASPECT);
        const screen = projectToScreen(eye, target, fovYRad, ASPECT, [0, 1, 0]);

        expect(screen.x).toBeCloseTo(anchor.x, 2);
        expect(screen.y).toBeCloseTo(anchor.y, 2);
      }
    });

    it('holds the anchor when the camera stands off to one side, not just behind', () => {
      const eye: [number, number, number] = [14, 3, 4];
      const anchor = { x: 0.4, y: 0.6 };
      const target = aimShot(eye, [0, 1, 0], anchor, Math.PI / 4, ASPECT);
      const screen = projectToScreen(eye, target, Math.PI / 4, ASPECT, [0, 1, 0]);

      expect(screen.x).toBeCloseTo(anchor.x, 2);
      expect(screen.y).toBeCloseTo(anchor.y, 2);
    });
  });
});

describe('anchorFor (lead room)', () => {
  describe('negative cases', () => {
    it('does not flip a barely moving car across the frame — no coin toss at a standstill', () => {
      const eye: [number, number, number] = [0, 2, 12];
      // The same crawl, crossing each way: a rule that read the SIGN of a near-zero signal would put these on
      // opposite sides of the frame, and a car rocking on its springs would flip between them.
      const left = anchorFor(WING, eye, subjectAt(Math.PI / 2, 0.2));
      const right = anchorFor(WING, eye, subjectAt(-Math.PI / 2, 0.2));

      expect(Math.abs(left.x - right.x)).toBeLessThan(0.01);
      expect(left.y).toBe(WING.anchor.y);
    });

    it('never steps the anchor across a crossing speed — lead room is a ramp, not a threshold', () => {
      // The bug this pins (096 field round 1): lead room used to switch on at 2 m/s, so a shot whose crossing
      // signal hovered there — `nose` sits at ~0.11 × speed, i.e. right on it at a cruise — snapped 0.24 of
      // the frame's width whenever the speed drifted over the line. Sweep the whole range, both directions.
      const eye: [number, number, number] = [0, 2, 12];
      const anchors: number[] = [];
      for (let step = 0; step <= 400; step += 1) {
        const speed = -8 + step * 0.04;
        anchors.push(anchorFor(WING, eye, subjectAt(speed < 0 ? Math.PI / 2 : -Math.PI / 2, Math.abs(speed))).x);
      }
      const worst = Math.max(...anchors.slice(1).map((x, at) => Math.abs(x - anchors[at])));

      // The ramp's steepest slope is `room × 1.5 / LEAD_SPEED_FULL` = 0.09 of the frame per m/s, so a
      // 0.04 m/s step can move the anchor by at most 0.0036. The threshold it replaced moved 0.24 in ONE step.
      expect(worst).toBeLessThan(0.005);
    });
  });

  describe('positive cases', () => {
    it('frames the car on the side OPPOSITE its screen travel, and flips when it reverses', () => {
      // Camera on +Z looking at the origin: its screen right is world +X (mat4LookAt's basis).
      const eye: [number, number, number] = [0, 2, 12];
      const crossingLeft = anchorFor(WING, eye, subjectAt(Math.PI / 2, 12)); // heading +pi/2 → engine −X
      const crossingRight = anchorFor(WING, eye, subjectAt(-Math.PI / 2, 12));

      expect(crossingRight.x).toBeLessThan(0.5); // driving screen-right → framed left, road ahead open
      expect(crossingLeft.x).toBeGreaterThan(0.5);
      expect(crossingLeft.x + crossingRight.x).toBeCloseTo(1, 9); // mirrored about centre
      expect(crossingLeft.y).toBe(WING.anchor.y); // the vertical anchor is authored, never mirrored
    });
  });
});

describe('projectToScreen', () => {
  describe('negative cases', () => {
    it('reports a point BEHIND the camera instead of a plausible pair of numbers', () => {
      const screen = projectToScreen([0, 2, 0], [0, 2, -10], Math.PI / 3, ASPECT, [0, 2, 8]);

      expect(screen.behind).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('puts the look point dead centre', () => {
      const screen = projectToScreen([0, 2, 12], [0, 1, 0], Math.PI / 3, ASPECT, [0, 1, 0]);

      expect(screen.x).toBeCloseTo(0.5, 9);
      expect(screen.y).toBeCloseTo(0.5, 9);
    });
  });
});

describe('SHOTS (the preset table)', () => {
  describe('negative cases', () => {
    it('gives every riding shot the same clip and never charges a planted one its watchdog for road', () => {
      // The lengths are a property of the KIND, not of the row — the table cannot express a shot that runs
      // for some other number, which is what keeps a scene exactly five cameras long.
      const riding = SHOTS.filter((shot) => shot.kind === 'chase' || shot.kind === 'tracking');
      const planted = SHOTS.filter((shot) => shot.kind === 'static' || shot.kind === 'station');

      expect(riding.map(shotSeconds)).toEqual(riding.map(() => TRACKING_SECONDS));
      expect(planted.map(shotSeconds)).toEqual(planted.map(() => PLANTED_CEILING_SECONDS));
      // Road is sized on the PASS, which is shorter than the watchdog: a car that trips the watchdog has
      // stopped moving and is not eating route.
      expect(SHOT_ROAD_SECONDS).toBeLessThan(PLANTED_CEILING_SECONDS);
    });

    it('places no camera inside the car it films', () => {
      // A tripod's eye comes from 04's survey, not from the car — only the car-anchored rows are asked here.
      const placed = SHOTS.filter((shot): shot is PosedShot => shot.kind === 'static' || shot.kind === 'tracking');
      const inside = placed.filter((shot) => {
        const eye = shotEye(shot, subjectAt(0, 12));

        return Math.abs(eye[0]) < HALF_EXTENTS[0] && Math.abs(eye[2]) < HALF_EXTENTS[1] && eye[1] < HALF_EXTENTS[2];
      });

      expect(inside.map((shot) => shot.name)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('offers exactly one chase shot — the one that yields the frame to the shipped rig', () => {
      expect(SHOTS.filter((shot) => shot.kind === 'chase').map((shot) => shot.name)).toEqual(['chase']);
    });

    it('names every shot once', () => {
      expect(new Set(SHOTS.map((shot) => shot.name)).size).toBe(SHOTS.length);
    });
  });
});

describe('WALK_SHOTS (the pedestrian table)', () => {
  /** A stock ped capsule, the host's own numbers: radius 0.35, half-height 0.55 + the cap. */
  const PED = [0.35, 0.35, 0.9] as const;
  const pedAt = (heading: number, speed: number): Subject => ({
    forward: forwardFromHeading(heading),
    halfExtents: PED,
    position: [0, 0, 0],
    speed,
  });

  describe('negative cases', () => {
    it('places no camera inside the person it films', () => {
      const placed = WALK_SHOTS.filter((shot): shot is PosedShot => shot.kind === 'static' || shot.kind === 'tracking');
      const inside = placed.filter((shot) => {
        const eye = shotEye(shot, pedAt(0, 2));

        return Math.abs(eye[0]) < PED[0] && Math.abs(eye[2]) < PED[1] && eye[1] < PED[2];
      });

      expect(inside.map((shot) => shot.name)).toEqual([]);
    });

    it('never frames a person at a driving distance — a walker at 40 m is a speck', () => {
      const driving = SHOTS.filter((shot) => shot.kind !== 'chase').map((shot) => shot.maxDist);
      const walking = WALK_SHOTS.filter((shot) => shot.kind !== 'chase').map((shot) => shot.maxDist);

      expect(Math.max(...walking)).toBeLessThan(Math.min(...driving));
    });

    it('keeps the overhead shot OFF the vertical, where screenBasis has no defined roll', () => {
      const top = WALK_SHOTS.find((shot) => shot.name === 'top');
      const eye = shotEye(top as PosedShot, pedAt(0, 2));
      // The angle between the view direction and straight down: 0 would be the singularity itself.
      const offVertical = (Math.atan2(Math.hypot(eye[0], eye[2]), eye[1]) * 180) / Math.PI;

      expect(offVertical).toBeGreaterThan(5);
    });
  });

  describe('positive cases', () => {
    it('covers the same roles as the driving table, once each', () => {
      expect(new Set(WALK_SHOTS.map((shot) => shot.name))).toEqual(new Set(SHOTS.map((shot) => shot.name)));
      expect(new Set(WALK_SHOTS.map((shot) => shot.name)).size).toBe(WALK_SHOTS.length);
    });

    it('obeys the same clip lengths — a scene is five cameras whoever it is about', () => {
      const riding = WALK_SHOTS.filter((shot) => shot.kind === 'chase' || shot.kind === 'tracking');
      const planted = WALK_SHOTS.filter((shot) => shot.kind === 'static' || shot.kind === 'station');

      expect(riding.map(shotSeconds)).toEqual(riding.map(() => TRACKING_SECONDS));
      expect(planted.map(shotSeconds)).toEqual(planted.map(() => PLANTED_CEILING_SECONDS));
    });
  });
});
