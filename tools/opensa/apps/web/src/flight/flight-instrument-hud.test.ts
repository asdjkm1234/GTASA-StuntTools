import { describe, expect, it } from 'vitest';

import { blendFlightHud, flightHudLayout } from './flight-instrument-hud';

describe('shared third-person instruments and control layout', () => {
  it('fits common and narrow viewports above the measured transport, with separate nonoverlapping panels', () => {
    for (const [width, height, barHeight] of [
      [1920, 1080, 108],
      [1600, 1100, 166],
      [1280, 720, 150],
      [800, 600, 240],
    ]) {
      const transportTop = height - barHeight;
      const layout = flightHudLayout(width, height, transportTop);
      expect(layout.top).toBeGreaterThanOrEqual(16);
      expect(layout.left).toBeGreaterThanOrEqual(16);
      expect(layout.left + layout.width).toBeLessThanOrEqual(width - 16);
      expect(layout.top + layout.height).toBeCloseTo(transportTop - 12);
      expect(layout.instruments.left + layout.instruments.width).toBeLessThan(layout.controls.left);
      expect(layout.controls.left + layout.controls.width).toBeCloseTo(layout.left + layout.width);
      expect(layout.controls.height).toBe(layout.instruments.height);
    }
  });
  it('moves the whole row down when export hides transport, without changing instrument scale', () => {
    const live = flightHudLayout(1920, 1080, 944);
    const exported = flightHudLayout(1920, 1080);
    expect(exported.top).toBeGreaterThan(live.top);
    expect(exported.top + exported.height).toBeCloseTo(1064);
    expect(exported.instruments.width).toBe(live.instruments.width);
    expect(exported.controls.width).toBe(live.controls.width);
  });
  it('clips output safely and respects transparent/half-transparent overlay pixels at the supplied location', () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(100);
    const overlay = {
      data: new Uint8ClampedArray([200, 0, 0, 255, 200, 100, 0, 128, 255, 0, 0, 0]),
      height: 1,
      width: 3,
    } as ImageData;
    blendFlightHud(pixels, 4, 4, overlay, 1, 2);
    expect(Array.from(pixels.slice(36, 40))).toEqual([200, 0, 0, 100]);
    expect(Array.from(pixels.slice(40, 44))).toEqual([150, 100, 50, 100]);
    expect(Array.from(pixels.slice(44, 48))).toEqual([100, 100, 100, 100]);
    expect(Array.from(pixels.slice(0, 4))).toEqual([100, 100, 100, 100]);
    expect(() => blendFlightHud(pixels, 4, 4, overlay, -2, 3)).not.toThrow();
  });
});
