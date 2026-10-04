import type { TelemetryFrame, WheelFrame } from '@opensa/game/vehicle/vehicle-telemetry';

import { describe, expect, it } from 'vitest';

import { bar, bodyRows, wheelRows } from './physics-panel';

const wheel = (over: Partial<WheelFrame> = {}): WheelFrame => ({
  compression: 0.5,
  contact: true,
  forwardImpulse: 0,
  load: 3000,
  sideImpulse: 0,
  slipRatio: 0,
  surface: null,
  ...over,
});

const frame = (over: Partial<TelemetryFrame> = {}): TelemetryFrame => ({
  brake: 0,
  engineForce: 0,
  gear: 1,
  gLat: 0,
  gLong: 0,
  gVert: 0,
  handbrake: false,
  heading: 0,
  pitch: 0,
  position: [0, 0, 0],
  roll: 0,
  slipAngle: 0,
  slipRatio: 0,
  speed: 0,
  speedLateral: 0,
  steer: 0,
  t: 0,
  throttle: 0,
  wheels: [wheel()],
  yawRate: 0,
  ...over,
});

/** The value column of a row, by its label. */
const valueOf = (rows: readonly (readonly [string, string])[], label: string): string =>
  rows.find(([rowLabel]) => rowLabel.startsWith(label))?.[1] ?? '';

describe('bar', () => {
  describe('negative cases', () => {
    it('clamps a fraction below zero to an empty meter', () => {
      expect(bar(-2, 4)).toBe('░░░░');
    });

    it('clamps a fraction above one to a full meter', () => {
      expect(bar(3, 4)).toBe('████');
    });
  });

  describe('positive cases', () => {
    it('fills the meter in proportion to the fraction', () => {
      expect(bar(0.5, 4)).toBe('██░░');
    });
  });
});

describe('bodyRows', () => {
  describe('negative cases', () => {
    it('keeps the sign of a nose-UP pitch — the complaint 081 exists for is this row', () => {
      expect(valueOf(bodyRows(frame({ pitch: Math.PI / 18 })), 'pitch')).toBe('10.0°');
    });

    it('reports reverse as a negative speed rather than an absolute one', () => {
      expect(valueOf(bodyRows(frame({ speed: -5 })), 'speed')).toBe('-18.0 km/h');
    });
  });

  describe('positive cases', () => {
    it('prints speed in km/h and angles in degrees', () => {
      const rows = bodyRows(frame({ slipAngle: Math.PI / 6, speed: 10, yawRate: Math.PI }));

      expect(valueOf(rows, 'speed')).toBe('36.0 km/h');
      expect(valueOf(rows, 'slip angle')).toBe('30.0°');
      expect(valueOf(rows, 'yaw rate')).toBe('180.0°/s');
    });

    it('prints the applied forces in kN', () => {
      const rows = bodyRows(frame({ brake: 2500, engineForce: 6000 }));

      expect(valueOf(rows, 'engine / brake')).toBe('6.0 / 2.5 kN');
    });
  });
});

describe('wheelRows', () => {
  describe('negative cases', () => {
    it('names a wheel by index when the car brought no corner labels', () => {
      const rows = wheelRows(frame({ wheels: [wheel(), wheel()] }), []);

      expect(rows.map(([label]) => label)).toEqual(['W0', 'W1']);
    });

    it('marks a wheel off the ground as out of contact', () => {
      const [[, value]] = wheelRows(frame({ wheels: [wheel({ contact: false })] }), ['FL']);

      expect(value.startsWith('○')).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('prints contact, a travel meter, the load in kN and the slip ratio', () => {
      const rows = wheelRows(frame({ wheels: [wheel({ compression: 0.4, load: 4200, slipRatio: -0.25 })] }), ['RR']);

      expect(rows).toEqual([['RR', '● ████░░░░░░ 4.2kN -0.25']]);
    });

    it('names the ground under the wheel and the grip share it gives (081/10)', () => {
      const rows = wheelRows(frame({ wheels: [wheel({ surface: 27 })] }), ['FL'], () => ({
        factor: 0.711,
        name: 'grass_medium_lush',
      }));

      expect(rows[0][1].endsWith('grass_medium_lush ×0.71')).toBe(true);
    });

    it('says nothing about the ground when the world has no surface table', () => {
      const rows = wheelRows(frame({ wheels: [wheel({ surface: 27 })] }), ['FL']);

      expect(rows[0][1]).toBe('● █████░░░░░ 3.0kN 0.00');
    });
  });
});
