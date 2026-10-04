/**
 * The autopilot against a kinematic bicycle (096/02): pure math, fixed step, no physics and no engine — a
 * controller that cannot hold a line on a perfect car will not hold one on a real one, and this is where that
 * is caught in milliseconds instead of a field round.
 *
 * The stub reproduces exactly the two things the real path does to a command: the wheel SLEWS toward
 * `-move.x × lock` at the car's own rate, and the pedals ramp a speed rather than setting one.
 */
import { describe, expect, it } from 'vitest';

import type { Route, RoutePoint } from '../paths/route-builder';

import { PathFollowSource } from './path-follow';

/** The stub car's authored numbers — a mid-range saloon: 35° of lock, 1.2 rad/s of slew, 2.6 m of wheelbase. */
const MODEL = { lockRad: (35 * Math.PI) / 180, slewRate: 1.2, wheelbase: 2.6 };
const STEP = 1 / 60;
/** The builder's own calm lateral ceiling (m/s²) — the test routes carry speeds derived the same way. */
const LAT_ACCEL_MAX = 2.5;
/** The builder's default cruise (m/s) — what a straight in these routes asks for. */
const CRUISE = 12;

describe('PathFollowSource', () => {
  describe('negative cases', () => {
    it('stays neutral until it is given a route', () => {
      const rig = harness();
      rig.source.advance(STEP);

      expect(rig.source.move()).toEqual({ x: 0, y: 0 });
      expect(rig.source.state()).toBe('idle');
    });

    it('stays neutral, and still following, while nobody is driving', () => {
      const rig = harness();
      rig.source.follow(straightRoute(60));
      rig.seated = false;
      rig.run(1);

      expect(rig.source.move()).toEqual({ x: 0, y: 0 });
      expect(rig.source.state()).toBe('following');
    });

    it('flags stuck when the car will not move under throttle', () => {
      const rig = harness();
      rig.source.follow(straightRoute(60));
      rig.wedged = true;
      rig.run(4);

      expect(rig.source.state()).toBe('stuck');
    });

    it('flags stuck when the car rolls BACKWARDS under throttle (a hill it cannot climb)', () => {
      // Measured, not imagined: 096/02's headless run started a scene on an 18° Los Santos hill and the car
      // slid back at 1-2 m/s under full throttle. A speed-based test never fired; a progress-based one does.
      const rig = harness();
      rig.source.follow(straightRoute(60));
      rig.gradient = -8; // steeper than the 5 m/s² the stub's throttle can produce
      rig.run(5);

      expect(rig.car.y).toBeLessThan(0); // it did roll back down
      expect(rig.source.state()).toBe('stuck');
    });

    it('reports arrived rather than following a route it cannot drive', () => {
      const rig = harness();
      rig.source.follow(routeOf([{ position: [0, 0, 0], speed: CRUISE }]));

      expect(rig.source.state()).toBe('arrived');
      expect(rig.source.move()).toEqual({ x: 0, y: 0 });
    });
  });

  describe('positive cases', () => {
    it('converges onto a straight from five metres off, and stays within one lane', () => {
      const rig = harness();
      rig.car.x = 5;
      rig.source.follow(straightRoute(200));
      rig.run(20);

      const errors = rig.source.errorSamples();
      const settled = errors.slice(Math.floor(errors.length / 2)).map(Math.abs);

      expect(Math.abs(rig.car.x)).toBeLessThan(1);
      expect(Math.max(...settled)).toBeLessThan(1.5);
    });

    it('slows for a corner before entering it, and holds the line through it', () => {
      const rig = harness();
      const route = cornerRoute();
      rig.source.follow(route);
      const speeds: number[] = [];
      rig.run(30, () => speeds.push(rig.car.speed));

      const corner = Math.sqrt(LAT_ACCEL_MAX * CORNER_RADIUS);
      const errors = rig.source.errorSamples().map(Math.abs);
      // From the moment it FIRST reaches cruise — otherwise the minimum is the standing start, and the
      // assertion passes without the car ever having slowed for anything.
      const cruising = speeds.slice(speeds.findIndex((speed) => speed >= CRUISE - 1));

      expect(speeds.some((speed) => speed >= CRUISE - 1)).toBe(true); // it did reach cruise on the straight
      expect(Math.min(...cruising)).toBeLessThan(corner + 0.5); // …then slowed to the corner's own speed
      expect(Math.min(...cruising)).toBeGreaterThan(2); // …without crawling to a stop doing it
      expect(Math.max(...errors)).toBeLessThan(3);
    });

    it('still reports what a run did after it has been stopped', () => {
      const rig = harness();
      rig.source.follow(straightRoute(200));
      rig.run(10);
      rig.source.stop();

      expect(rig.source.state()).toBe('idle');
      expect(rig.source.move()).toEqual({ x: 0, y: 0 });
      // A scene stops the autopilot and THEN reports it — clearing the run here made every capture say 0.
      expect(rig.source.progress()).toBeGreaterThan(0.2);
      expect(rig.source.errorSamples().length).toBeGreaterThan(500);
    });

    it('reports arrived at the end of the route', () => {
      const rig = harness();
      rig.source.follow(straightRoute(120));
      rig.run(20);

      expect(rig.source.state()).toBe('arrived');
      expect(rig.source.move()).toEqual({ x: 0, y: 0 });
    });

    it('drives a route the other way round, steering the mirror of the first', () => {
      const left = harness();
      left.source.follow(cornerRoute());
      left.run(30);

      const right = harness();
      right.source.follow(mirrored(cornerRoute()));
      right.run(30);

      // A left corner and its mirror must cost the same accuracy — a sign error shows up here and nowhere else.
      expect(Math.max(...right.source.errorSamples().map(Math.abs))).toBeCloseTo(
        Math.max(...left.source.errorSamples().map(Math.abs)),
        1,
      );
      expect(right.car.heading).toBeCloseTo(-left.car.heading, 1);
    });
  });
});

/** A car, the autopilot driving it, and the two ways a scene can go wrong under it. */
interface Harness {
  car: { heading: number; speed: number; steerAngle: number; x: number; y: number };
  /** Constant acceleration along the car's forward axis (m/s²) — a slope, negative uphill. */
  gradient: number;
  run: (seconds: number, each?: () => void) => void;
  /** Whether anybody is in the car at all — false makes both accessors answer null. */
  seated: boolean;
  source: PathFollowSource;
  /** The car cannot move however hard it is asked to — a kerb, a wall, a bollard. */
  wedged: boolean;
}

/** Radius of the test corner (m) — well inside what 096/01 accepts (its tightest measured corner was ~9.8 m). */
const CORNER_RADIUS = 25;
/** The driven line's uniform spacing (m) — the builder's `sampleStep` default. */
const SPACING = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 60 m of straight, a 90° left arc, then 40 m of straight — the shape 02's field round is judged on. */
function cornerRoute(): Route {
  const points: [number, number, number][] = [];
  for (let at = 0; at < 60; at += SPACING) {
    points.push([0, at, 0]);
  }
  const centre: [number, number] = [-CORNER_RADIUS, 60];
  const arc = (Math.PI / 2) * CORNER_RADIUS;
  for (let at = 0; at < arc; at += SPACING) {
    const angle = at / CORNER_RADIUS;
    points.push([centre[0] + Math.cos(angle) * CORNER_RADIUS, centre[1] + Math.sin(angle) * CORNER_RADIUS, 0]);
  }
  for (let at = 0; at <= 40; at += SPACING) {
    points.push([centre[0] - at, centre[1] + CORNER_RADIUS, 0]);
  }
  const straight = 60 / SPACING;
  const cornerSpeed = Math.sqrt(LAT_ACCEL_MAX * CORNER_RADIUS);

  return routeOf(
    points.map((position, index) => ({
      position,
      // The builder's own rule: cruise on the straights, `sqrt(latAccelMax × radius)` around the arc.
      speed: index >= straight && index <= straight + arc / SPACING ? cornerSpeed : CRUISE,
    })),
  );
}

/**
 * A car and the autopilot driving it. The step is the whole physical model: the wheel slews toward the
 * commanded share of the lock, the pedals accelerate or brake, and the bicycle turns about its rear axle.
 */
function harness(): Harness {
  const car = { heading: 0, speed: 0, steerAngle: 0, x: 0, y: 0 };
  const rig: Harness = {
    car,
    gradient: 0,
    run: (seconds: number, each?: () => void): void => {
      for (let step = 0; step < Math.round(seconds / STEP); step += 1) {
        rig.source.advance(STEP);
        const move = rig.source.move();
        const target = -move.x * MODEL.lockRad;
        car.steerAngle += clamp(target - car.steerAngle, -MODEL.slewRate * STEP, MODEL.slewRate * STEP);
        // 5 m/s² on the throttle, 8 on the brake — a saloon, and slower than the 3 m/s² the plan brakes at.
        const accel = (move.y >= 0 ? 5 * move.y : 8 * move.y) + rig.gradient;
        car.speed = rig.wedged ? 0 : car.speed + accel * STEP;
        car.heading += (car.speed / MODEL.wheelbase) * Math.tan(car.steerAngle) * STEP;
        car.x += -Math.sin(car.heading) * car.speed * STEP;
        car.y += Math.cos(car.heading) * car.speed * STEP;
        each?.();
      }
    },
    seated: true,
    source: new PathFollowSource({
      pose: () =>
        rig.seated ? { heading: car.heading, position: [car.x, car.y, 0] as const, speed: car.speed } : null,
      steering: () => (rig.seated ? { ...MODEL, steerAngle: car.steerAngle } : null),
    }),
    wedged: false,
  };

  return rig;
}

/** The same route reflected about x = 0 — a right-hand corner where the original turns left. */
function mirrored(route: Route): Route {
  return routeOf(
    route.points.map((point) => ({ ...point, position: [-point.position[0], point.position[1], point.position[2]] })),
  );
}

function routeOf(points: readonly RoutePoint[]): Route {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].position[0] - points[index - 1].position[0],
      points[index].position[1] - points[index - 1].position[1],
    );
  }

  return { length, maxTurnDeg: 0, minCurveRadius: Infinity, nodes: [], points, stop: 'target', turnsDeg: [] };
}

/** A straight along +Y at x = 0, cruising at 12 m/s — the line a car must settle onto and stay on. */
function straightRoute(length: number): Route {
  const points: RoutePoint[] = [];
  for (let at = 0; at <= length; at += SPACING) {
    points.push({ position: [0, at, 0], speed: CRUISE });
  }

  return routeOf(points);
}
