import { TouchInputSource } from '@opensa/game/input';
import { describe, expect, it } from 'vitest';

import { foldTouchCamera, type PendingCameraInput } from './touch-camera';

/** One pinch notch in the units the source accumulates (0.5 per pixel of spread) — 80 px of finger travel. */
const ONE_NOTCH_PX = 80;

const pending = (): PendingCameraInput => ({ look: { x: 0, y: 0 }, zoom: 0 });

describe('foldTouchCamera', () => {
  describe('negative cases', () => {
    it('leaves the frame untouched when there is no touch source', () => {
      const frame = pending();

      expect(foldTouchCamera(null, frame, 12)).toBe(12);
      expect(frame).toEqual({ look: { x: 0, y: 0 }, zoom: 0 });
    });

    it('contributes no zoom for a pinch shorter than one notch, and keeps the travel', () => {
      const source = new TouchInputSource();
      const frame = pending();
      source.addZoom(-0.5 * (ONE_NOTCH_PX / 2));

      const residual = foldTouchCamera(source, frame, 0);

      expect(frame.zoom).toBe(0);
      expect(residual).toBeCloseTo(-20, 10);
    });

    it('adds nothing while both joysticks are centred', () => {
      const frame = pending();

      expect(foldTouchCamera(new TouchInputSource(), frame, 0)).toBe(0);
      expect(frame).toEqual({ look: { x: 0, y: 0 }, zoom: 0 });
    });
  });

  describe('positive cases', () => {
    it('adds the look joystick deflection to the pending look', () => {
      const source = new TouchInputSource();
      const frame = pending();
      source.setLookRate(1, -0.5);

      foldTouchCamera(source, frame, 0);

      expect(frame.look).toEqual({ x: 10, y: -5 }); // the source's own gain: 10 px per frame at full deflection
    });

    it('accumulates onto a look the mouse handlers already wrote this frame', () => {
      const source = new TouchInputSource();
      const frame: PendingCameraInput = { look: { x: 4, y: 2 }, zoom: 1 };
      source.setLookRate(1, 0);

      foldTouchCamera(source, frame, 0);

      expect(frame.look).toEqual({ x: 14, y: 2 });
      expect(frame.zoom).toBe(1);
    });

    it('turns a spread into whole zoom notches and carries the remainder', () => {
      const source = new TouchInputSource();
      const frame = pending();
      source.addZoom(-0.5 * (ONE_NOTCH_PX * 2.5)); // spreading fingers zooms IN: a negative delta

      const residual = foldTouchCamera(source, frame, 0);

      expect(frame.zoom).toBe(-2);
      expect(residual).toBeCloseTo(-20, 10);
    });

    it('completes a notch from travel earlier frames left over', () => {
      const source = new TouchInputSource();
      const frame = pending();
      source.addZoom(0.5 * (ONE_NOTCH_PX / 2));

      const residual = foldTouchCamera(source, frame, 20); // 20 + 20 = one whole notch

      expect(frame.zoom).toBe(1);
      expect(residual).toBeCloseTo(0, 10);
    });
  });
});
