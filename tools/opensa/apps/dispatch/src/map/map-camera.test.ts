import { describe, expect, it } from 'vitest';

import type { MapPose } from './map-camera';

import { PUBLISH_INTERVAL_MS } from '../ops/tracks';
import { MAP_YAW, MapCamera } from './map-camera';

/**
 * Straight down. The camera's own bound sits just SHORT of this (`TOP_DOWN_PITCH` keeps a hundredth of a
 * radian, or the view direction goes parallel to `up` and the basis degenerates), so asking for it is asking
 * past the bound on purpose — which is exactly what a caller wanting "as far down as this camera goes" does.
 */
const STRAIGHT_DOWN = -Math.PI / 2;

const OPENING: MapPose = { at: [1700, -1500], height: 900, pitch: -1.15, projection: 'perspective', yaw: MAP_YAW };

describe('MapCamera.applyPose', () => {
  describe('negative cases', () => {
    it('clamps a pitch that would look at the horizon, so a map view can never show sky', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ ...OPENING, pitch: 0 });

      expect(camera.pose().pitch).toBeLessThan(0);
    });

    it('clamps a pitch past straight down rather than flipping the view through the vertical', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ ...OPENING, pitch: -Math.PI });

      expect(camera.pose().pitch).toBeGreaterThanOrEqual(STRAIGHT_DOWN);
      expect(camera.height()).toBeGreaterThan(0);
    });

    it('does not let a zero height collapse the view distance to nothing', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ ...OPENING, height: 0 });

      expect(camera.height()).toBeGreaterThan(0);
    });
  });

  describe('positive cases', () => {
    it('is what the constructor does, so a fresh camera and an applied pose agree', () => {
      const applied = new MapCamera({ ...OPENING, at: [0, 0] });
      applied.applyPose(OPENING);

      expect(applied.pose()).toEqual(new MapCamera(OPENING).pose());
    });

    it('sets a tilt outright, which no relative step can do without knowing the step scale', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ ...OPENING, pitch: -0.8 });

      expect(camera.pose().pitch).toBeCloseTo(-0.8);
    });

    it('answers its own bound to anything past it, so a caller need not know where the bound is', () => {
      const asked = new MapCamera(OPENING);
      const overshot = new MapCamera(OPENING);
      asked.applyPose({ ...OPENING, pitch: STRAIGHT_DOWN });
      overshot.applyPose({ ...OPENING, pitch: -Math.PI });

      expect(asked.pose().pitch).toBe(overshot.pose().pitch);
      // And that bound really is a top-down view, not some shallow default.
      expect(asked.pose().pitch).toBeLessThan(STRAIGHT_DOWN + 0.05);
    });

    it('holds the ground point and the eye height it was given', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ at: [500, 600], height: 420, pitch: -1, projection: 'perspective', yaw: 0.25 });

      expect(camera.positionGta()[0]).toBeCloseTo(500);
      expect(camera.positionGta()[1]).toBeCloseTo(600);
      expect(camera.height()).toBeCloseTo(420);
      expect(camera.pose().yaw).toBeCloseTo(0.25);
    });

    it('round-trips a pose, so a host can save one and restore it', () => {
      const camera = new MapCamera(OPENING);
      camera.orbit(120, -40);
      camera.dolly(-1);
      const saved = camera.pose();

      camera.applyPose({ at: [0, 0], height: 100, pitch: STRAIGHT_DOWN, projection: 'perspective', yaw: 0 });
      camera.applyPose(saved);

      expect(camera.pose().at[0]).toBeCloseTo(saved.at[0]);
      expect(camera.pose().at[1]).toBeCloseTo(saved.at[1]);
      expect(camera.pose().height).toBeCloseTo(saved.height);
      expect(camera.pose().pitch).toBeCloseTo(saved.pitch);
      expect(camera.pose().yaw).toBeCloseTo(saved.yaw);
    });
  });
});

describe('MapCamera projection', () => {
  describe('negative cases', () => {
    it('does not fan the picking rays out when the view is orthographic', () => {
      const camera = new MapCamera({ ...OPENING, projection: 'ortho' });
      const left = camera.rayAt([-0.9, 0], 16 / 9);
      const right = camera.rayAt([0.9, 0], 16 / 9);

      // Parallel rays: the DIRECTION is the same everywhere and the ORIGIN is what moves. Reading it the
      // perspective way puts every pick under the middle of the screen, and nothing says so.
      expect(right.direction).toEqual(left.direction);
      expect(right.origin[0]).not.toBeCloseTo(left.origin[0]);
    });

    it('does not leave a perspective near plane in front of a plan view, which would slice the towers off', () => {
      const camera = new MapCamera({ ...OPENING, projection: 'ortho' });

      // Behind the eye: an orthographic box has no apex, so the front plane may sit above the camera.
      expect(camera.state(1).near).toBeLessThan(0);
    });
  });

  describe('positive cases', () => {
    it('carries the projection through a pose round trip, so a shared view opens as it was left', () => {
      const camera = new MapCamera({ ...OPENING, projection: 'ortho' });

      expect(camera.pose().projection).toBe('ortho');
      expect(new MapCamera(camera.pose()).pose().projection).toBe('ortho');
    });

    it('leaves perspective unchanged: no ortho box, and the game camera fov', () => {
      const camera = new MapCamera(OPENING);
      const state = camera.state(16 / 9);

      expect(state.orthoHalfHeight).toBeUndefined();
      expect(state.near).toBeGreaterThan(0);
    });

    it('frames the same ground extent it framed in perspective, so switching is not a jump', () => {
      const perspective = new MapCamera(OPENING);
      const ortho = new MapCamera({ ...OPENING, projection: 'ortho' });
      const state = ortho.state(16 / 9);
      const distance = Math.hypot(
        ...(perspective.state(1).eye.map((value, axis) => value - perspective.state(1).target[axis]) as [
          number,
          number,
          number,
        ]),
      );

      // The half-height of a perspective frustum at the focus plane, which is what the box has to match.
      expect(state.orthoHalfHeight).toBeCloseTo(distance * Math.tan(Math.PI / 3 / 2), 3);
    });

    it('switches in place: the pose is the same view, only projected differently', () => {
      const camera = new MapCamera(OPENING);
      const before = camera.pose();
      camera.setProjection('ortho');
      const after = camera.pose();

      expect(after).toEqual({ ...before, projection: 'ortho' });
      expect(camera.state(1).orthoHalfHeight).toBeGreaterThan(0);
    });

    it('keeps the ray under the cursor pointing where the view points', () => {
      const camera = new MapCamera({ ...OPENING, projection: 'ortho' });
      const centre = camera.rayAt([0, 0], 16 / 9);
      const eye = camera.state(16 / 9).eye;

      // The centre ray is the view axis itself: same origin as the eye, aimed at the focus.
      expect(centre.origin[0]).toBeCloseTo(eye[0]);
      expect(centre.origin[1]).toBeCloseTo(eye[1]);
      expect(centre.origin[2]).toBeCloseTo(eye[2]);
      expect(centre.direction[1]).toBeLessThan(0);
    });
  });
});

describe('MapCamera bounds against the world', () => {
  /** The console's default LOD ring: what the streamer fills around the focus. */
  const REACH = 2200;

  describe('negative cases', () => {
    it('does not let the frame reach past the world there is: a shallow tilt is forced down', () => {
      const unbounded = new MapCamera(OPENING);
      const bounded = new MapCamera(OPENING);
      bounded.setStreamedReach(REACH);

      unbounded.applyPose({ ...OPENING, pitch: -0.6 });
      bounded.applyPose({ ...OPENING, pitch: -0.6 });

      // Same request, and the world is what says no: the top of a −0.6 rad frame lands thousands of units
      // outside the ring, over ground nobody loaded — which renders EMPTY rather than failing.
      expect(unbounded.pose().pitch).toBeCloseTo(-0.6, 6);
      expect(bounded.pose().pitch).toBeLessThan(-0.6);
    });

    it('does not zoom out past the ring, however far the wheel is turned', () => {
      const camera = new MapCamera(OPENING);
      camera.setStreamedReach(REACH);
      camera.zoomBy(1000);

      // At the top-down limit the frame's half-span IS the distance × tan(fov/2), so a view wider than the
      // ring is one whose edges are outside the world at any tilt.
      expect(camera.span()).toBeLessThanOrEqual(REACH * 2 + 1);
    });

    it('does not keep flying once the operator grabs the map', () => {
      const camera = new MapCamera(OPENING);
      camera.flyTo([2600, -1700]);
      camera.advance(100);
      camera.pan([0.1, 0]);

      expect(camera.flying()).toBe(false);
      const held = camera.positionGta();
      camera.advance(5000);

      expect(camera.positionGta()[0]).toBeCloseTo(held[0], 6);
      expect(camera.positionGta()[1]).toBeCloseTo(held[1], 6);
    });

    it('does not tighten anything when nothing is streamed, which is the demo and plan mode', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ ...OPENING, pitch: -0.6 });

      expect(camera.pose().pitch).toBeCloseTo(-0.6, 6);
    });
  });

  describe('positive cases', () => {
    it('re-takes the tilt bound when the ZOOM moves, not only when the tilt does', () => {
      const camera = new MapCamera({ ...OPENING, height: 200, pitch: -0.5 });
      camera.setStreamedReach(REACH);
      const close = camera.pose().pitch;
      // Widen the view a long way: the same tilt now reaches further, so the bound has to move with it.
      camera.zoomBy(8);

      expect(camera.pose().pitch).toBeLessThan(close);
    });

    it('frames the span it is given, and reports the span it is framing', () => {
      const camera = new MapCamera(OPENING);
      camera.frameSpan(1000);

      expect(camera.span()).toBeCloseTo(1000, 3);
    });

    it('lands a flight exactly on its destination and then stops being a flight', () => {
      const camera = new MapCamera(OPENING);
      camera.setStreamedReach(REACH);
      camera.flyTo([2400, -1700], 400);

      expect(camera.flying()).toBe(true);
      for (let step = 0; step < 400 && camera.flying(); step += 1) {
        camera.advance(16.7);
      }

      expect(camera.flying()).toBe(false);
      expect(camera.positionGta()[0]).toBeCloseTo(2400, 3);
      expect(camera.positionGta()[1]).toBeCloseTo(-1700, 3);
      expect(camera.span()).toBeCloseTo(400, 3);
    });

    it('gives the tilt back when a long flight comes down, instead of leaving the view flat', () => {
      const camera = new MapCamera(OPENING);
      camera.setStreamedReach(REACH);
      const before = camera.pose().pitch;
      camera.flyTo([5200, -2600], camera.span());
      let steepest = before;
      for (let step = 0; step < 600 && camera.flying(); step += 1) {
        camera.advance(16.7);
        steepest = Math.min(steepest, camera.pose().pitch);
      }

      // The arc widens the view, so somewhere over the trip the world bound tilted it down — that is the
      // bound working, and it is the half that must not be permanent.
      expect(steepest).toBeLessThan(before);
      expect(camera.pose().pitch).toBeCloseTo(before, 6);
    });

    it('gives the tilt back when the wheel comes back in, so a zoom round trip costs nothing', () => {
      const camera = new MapCamera(OPENING);
      camera.setStreamedReach(REACH);
      const before = camera.pose().pitch;
      camera.zoomBy(6);

      expect(camera.pose().pitch).toBeLessThan(before);

      camera.zoomBy(1 / 6);

      expect(camera.pose().pitch).toBeCloseTo(before, 6);
    });

    it('keeps the tilt and the heading it had while it flies — a flight moves the view, not the rig', () => {
      const camera = new MapCamera(OPENING);
      const before = camera.pose();
      camera.flyTo([2400, -1700], camera.span());
      camera.advance(200);

      expect(camera.pose().yaw).toBeCloseTo(before.yaw, 6);
      expect(camera.pose().pitch).toBeCloseTo(before.pitch, 6);
    });
  });
});

describe('MapCamera.follow', () => {
  const REACH = 2200;

  describe('negative cases', () => {
    it('does not tow the camera behind a unit driving at a constant speed', () => {
      const camera = new MapCamera(OPENING);
      camera.setStreamedReach(REACH);
      let x = 1700;
      camera.follow(() => [x, -1500]);

      // 20 m per tick is ~72 km/h at 60 fps. A world-framed damper lags by speed x time-constant forever;
      // re-basing on the subject leaves it nothing to do (restrictions/architecture.md).
      for (let tick = 0; tick < 400; tick += 1) {
        x += 20;
        camera.advance(16.7);
      }

      expect(Math.abs(camera.positionGta()[0] - x)).toBeLessThan(1);
    });

    it('does not snap to nowhere when the followed unit goes away', () => {
      const camera = new MapCamera(OPENING);
      let at: null | readonly [number, number] = [2000, -1600];
      camera.follow(() => at);
      for (let tick = 0; tick < 600; tick += 1) {
        camera.advance(16.7);
      }
      const arrived = camera.positionGta();
      at = null;
      camera.advance(1000);

      // The view stays exactly where the last fix put it — it does not drift, and it does not jump home.
      expect(camera.positionGta()[0]).toBeCloseTo(arrived[0], 6);
      expect(camera.positionGta()[1]).toBeCloseTo(arrived[1], 6);
      // Still riding: a unit that stops reporting may start again, and dropping the mode would be a
      // decision the operator did not make.
      expect(camera.following()).toBe(true);
    });

    it('does not keep riding once the view is sent somewhere else', () => {
      const camera = new MapCamera(OPENING);
      camera.follow(() => [2000, -1600]);
      camera.flyTo([1000, -1000]);

      // A fit, a bookmark, a locate and a searched place are all this flight — each of them is the operator
      // naming a destination, which a ride cannot then fight for the focus every frame.
      expect(camera.following()).toBe(false);
      expect(camera.flying()).toBe(true);
    });

    it('does not keep riding once the operator pans away', () => {
      const camera = new MapCamera(OPENING);
      camera.follow(() => [2000, -1600]);
      camera.pan([0.2, 0]);

      expect(camera.following()).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('is at most one fix behind: a jump is 95 % closed by the time the next one could land', () => {
      const camera = new MapCamera(OPENING);
      camera.setStreamedReach(REACH);
      // A 4 s fix at speed moves a car ~110 m — the step the feed actually delivers (`PUBLISH_INTERVAL_MS`).
      const gap = 110;
      camera.follow(() => [1700 + gap, -1500]);
      for (let tick = 0; tick < Math.round(PUBLISH_INTERVAL_MS / 16.7); tick += 1) {
        camera.advance(16.7);
      }

      // The time constant is one publish interval over three, so this is the bound rather than a feel.
      expect(1700 + gap - camera.positionGta()[0]).toBeLessThan(gap * 0.05);
      expect(camera.positionGta()[0]).toBeGreaterThan(1700);
    });

    it('keeps riding while the operator turns and zooms, which are not a change of subject', () => {
      const camera = new MapCamera(OPENING);
      camera.follow(() => [2000, -1600]);
      camera.orbit(40, 10);
      camera.zoomBy(1.5);

      expect(camera.following()).toBe(true);
    });
  });
});

describe('MapCamera.fitBounds', () => {
  describe('negative cases', () => {
    it('does nothing for an empty set rather than flying to the origin', () => {
      const camera = new MapCamera(OPENING);
      camera.fitBounds([]);

      expect(camera.flying()).toBe(false);
      expect(camera.positionGta()[0]).toBeCloseTo(1700, 3);
    });

    it('does not frame more world than there is when the set spans the whole state', () => {
      const camera = new MapCamera(OPENING);
      camera.setStreamedReach(2200);
      camera.fitBounds([
        [-3000, -3000],
        [3000, 3000],
      ]);
      for (let tick = 0; tick < 2000 && camera.flying(); tick += 1) {
        camera.advance(16.7);
      }

      // The zoom bound wins: the fit shows as much as the world can, rather than a view of emptiness.
      expect(camera.span()).toBeLessThanOrEqual(2200 * 2 + 1);
    });
  });

  describe('positive cases', () => {
    it('centres the set and frames it with a cell of air around it', () => {
      const camera = new MapCamera(OPENING);
      camera.fitBounds([
        [1000, -2000],
        [1600, -1400],
      ]);
      for (let tick = 0; tick < 2000 && camera.flying(); tick += 1) {
        camera.advance(16.7);
      }

      expect(camera.positionGta()[0]).toBeCloseTo(1300, 1);
      expect(camera.positionGta()[1]).toBeCloseTo(-1700, 1);
      // 600 units of set + 250 of margin on each side.
      expect(camera.span()).toBeCloseTo(1100, 1);
    });
  });
});

describe('MapCamera keyboard movement', () => {
  describe('negative cases', () => {
    it('does not lift the focus off the ground when panning a tilted view', () => {
      const camera = new MapCamera({ ...OPENING, pitch: -0.6 });
      camera.panBySpan(0, 1);

      // The screen's up vector points into the sky on a tilted view; following it would fly the focus.
      expect(camera.pose().height).toBeCloseTo(OPENING.height, 6);
    });

    it('does not keep easing towards north once the operator turns by hand', () => {
      const camera = new MapCamera(OPENING);
      camera.turnTo(0);
      camera.advance(100);
      camera.orbit(30, 0);

      expect(camera.turning()).toBe(false);
    });

    it('does not tilt past the bounds a drag is held to', () => {
      const camera = new MapCamera(OPENING);
      camera.tiltBy(10);
      const flat = camera.pose().pitch;
      camera.tiltBy(-10);

      expect(flat).toBeLessThan(0);
      expect(camera.pose().pitch).toBeGreaterThan(-Math.PI / 2);
    });
  });

  describe('positive cases', () => {
    it('pans one screenful per unit, whatever the zoom, which is what makes a held key predictable', () => {
      const near = new MapCamera({ ...OPENING, pitch: -Math.PI / 2 });
      near.frameSpan(400);
      const before = near.positionGta();
      near.panBySpan(1, 0);

      expect(near.positionGta()[0] - before[0]).toBeCloseTo(400, 1);

      const far = new MapCamera({ ...OPENING, pitch: -Math.PI / 2 });
      far.frameSpan(2000);
      const start = far.positionGta();
      far.panBySpan(1, 0);

      expect(far.positionGta()[0] - start[0]).toBeCloseTo(2000, 1);
    });

    it('pans north when told to, on a north-up view', () => {
      const camera = new MapCamera({ ...OPENING, pitch: -Math.PI / 2 });
      const before = camera.positionGta();
      camera.panBySpan(0, 1);

      expect(camera.positionGta()[1]).toBeGreaterThan(before[1]);
      expect(camera.positionGta()[0]).toBeCloseTo(before[0], 3);
    });

    it('eases round to north the short way and lands exactly on it', () => {
      const camera = new MapCamera({ ...OPENING, yaw: MAP_YAW - 0.6 });
      camera.turnTo(MAP_YAW);

      expect(camera.turning()).toBe(true);
      for (let tick = 0; tick < 400 && camera.turning(); tick += 1) {
        camera.advance(16.7);
      }

      expect(camera.pose().yaw).toBeCloseTo(MAP_YAW, 9);
    });

    it('turns by hand without easing, because a drag is already the operator moving it', () => {
      const camera = new MapCamera(OPENING);
      camera.turnBy(0.5);

      expect(camera.pose().yaw).toBeCloseTo(MAP_YAW + 0.5, 9);
      expect(camera.turning()).toBe(false);
    });
  });
});

describe('MapCamera.groundFootprint', () => {
  describe('negative cases', () => {
    it('never answers with fewer than four corners, however shallow the tilt', () => {
      const camera = new MapCamera({ ...OPENING, pitch: -0.05 });

      expect(camera.groundFootprint(1.6)).toHaveLength(4);
    });

    it('keeps every corner inside the world the streamer actually fills', () => {
      const camera = new MapCamera(OPENING);
      camera.setStreamedReach(2200);
      const focus = camera.pose().at;

      for (const corner of camera.groundFootprint(1.6)) {
        expect(Math.hypot(corner[0] - focus[0], corner[1] - focus[1])).toBeLessThanOrEqual(2200.0001);
      }
    });
  });

  describe('positive cases', () => {
    it('is a trapezoid under perspective — the far edge covers more ground than the near one', () => {
      const camera = new MapCamera({ ...OPENING, pitch: -0.9 });
      const [nearLeft, nearRight, farRight, farLeft] = camera.groundFootprint(1.6);

      expect(Math.hypot(farRight[0] - farLeft[0], farRight[1] - farLeft[1])).toBeGreaterThan(
        Math.hypot(nearRight[0] - nearLeft[0], nearRight[1] - nearLeft[1]),
      );
    });

    it('is a rectangle in the plan view, because parallel rays cover the same ground at both edges', () => {
      const camera = new MapCamera({ ...OPENING, projection: 'ortho' });
      const [nearLeft, nearRight, farRight, farLeft] = camera.groundFootprint(1.6);

      expect(Math.hypot(farRight[0] - farLeft[0], farRight[1] - farLeft[1])).toBeCloseTo(
        Math.hypot(nearRight[0] - nearLeft[0], nearRight[1] - nearLeft[1]),
        3,
      );
    });

    it('surrounds the point the view is over', () => {
      const camera = new MapCamera(OPENING);
      const [x, y] = camera.pose().at;
      const corners = camera.groundFootprint(1.6);

      expect(Math.min(...corners.map((c) => c[0]))).toBeLessThan(x);
      expect(Math.max(...corners.map((c) => c[0]))).toBeGreaterThan(x);
      expect(Math.min(...corners.map((c) => c[1]))).toBeLessThan(y);
      expect(Math.max(...corners.map((c) => c[1]))).toBeGreaterThan(y);
    });
  });
});
