/**
 * The shared keyframe walker (plan 099/02).
 *
 * It is worth its own test for one reason: BOTH lanes run through it now, and the world lane's own coverage
 * (`engine.frame.test.ts`) only asserts that a write HAPPENED at the right offset — never what was in it. A
 * value regression here would move every scrolling sign in the map and nothing would fail.
 */
import { describe, expect, it } from 'vitest';

import { stepUvAnimation, UV_ANIM_STRIDE, uvAnimOffset } from './uv-anim';

/**
 * A SCROLL: distinct keyframe times — the shape SA's crawling signs use. The CLOSING key at `duration`
 * matters: sampling exactly there wraps to time 0 (the end of a loop IS its start), so the interesting
 * values sit on the middle key instead.
 */
const SCROLL = {
  duration: 4,
  keyframes: [
    { time: 0, uv: [0, 1, 1, 0, 0, 0] },
    { time: 2, uv: [0, 2, 4, 0, 1, 3] },
    { time: 4, uv: [0, 1, 1, 0, 0, 0] },
  ],
};

/** A STEP: keyframe PAIRS sharing a timestamp — the ferris ring's film strip, and DolSign's flipbook. */
const STEP = {
  duration: 0.45,
  keyframes: [
    { time: 0, uv: [0, 1, 1, 0, 0, 0] },
    { time: 0.225, uv: [0, 1, 1, 0, 0, 0] },
    { time: 0.225, uv: [0, 1, 1, 0, 0.5, 0] },
    { time: 0.45, uv: [0, 1, 1, 0, 0.5, 0] },
  ],
};

function transformAt(animation: Parameters<typeof stepUvAnimation>[0], seconds: number): number[] {
  const out = new Float32Array(4).fill(-1);
  stepUvAnimation(animation, seconds, out, 0);

  return [...out];
}

describe('stepUvAnimation', () => {
  describe('negative cases', () => {
    it('leaves the output untouched when the animation has no keyframes', () => {
      const out = new Float32Array([9, 9, 9, 9]);

      stepUvAnimation({ duration: 1, keyframes: [] }, 0.5, out, 0);

      // NOT zeroed: the caller's slot keeps whatever it held, which for slot 0 is the identity.
      expect([...out]).toEqual([9, 9, 9, 9]);
    });

    it('holds the first keyframe when the duration is zero (a loop of no length cannot advance)', () => {
      expect(transformAt({ ...SCROLL, duration: 0 }, 12.5)).toEqual([0, 0, 1, 1]);
    });

    it('does not interpolate ACROSS a paired keyframe — the earlier frame holds until its twin starts', () => {
      // Anywhere inside [0, 0.225) the strip must show frame 0 exactly. A lerp across the pair would smear
      // the two bulb states together, which is the difference between blinking and glowing.
      expect(transformAt(STEP, 0.1)[0]).toBe(0);
      expect(transformAt(STEP, 0.2249)[0]).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('reads the DFF param order: (tX, tY, sclX, sclY) out of [rot, sclX, sclY, skew, tX, tY]', () => {
      expect(transformAt(SCROLL, 2)).toEqual([1, 3, 2, 4]);
    });

    it('lerps between two distinct keyframe times', () => {
      expect(transformAt(SCROLL, 1)).toEqual([0.5, 1.5, 1.5, 2.5]);
    });

    it('wraps a scroll at its duration — the end of a loop IS its start, in sync with every instance', () => {
      expect(transformAt(SCROLL, 4)).toEqual([0, 0, 1, 1]);
      expect(transformAt(SCROLL, 9)).toEqual(transformAt(SCROLL, 1));
    });

    it('steps at the pair boundary and wraps at the duration', () => {
      expect(transformAt(STEP, 0.225)[0]).toBe(0.5);
      expect(transformAt(STEP, 0.3)[0]).toBe(0.5);
      // 0.9 s = two full loops: the strip is back at frame 0, in sync with every other instance.
      expect(transformAt(STEP, 0.9)[0]).toBe(0);
    });

    it('writes at the requested offset and touches nothing else (the world lane packs a list here)', () => {
      const out = new Float32Array(8).fill(-1);

      stepUvAnimation(SCROLL, 2, out, 4);

      expect([...out.subarray(0, 4)]).toEqual([-1, -1, -1, -1]);
      expect([...out.subarray(4)]).toEqual([1, 3, 2, 4]);
    });
  });
});

describe('uvAnimOffset', () => {
  describe('negative cases', () => {
    it('falls back to the identity for a slot the model does not have', () => {
      // The number comes out of a `.osm` DESC — a file a mod ships. Past the buffer it would be a WebGPU
      // validation error inside the pass, so an unvouchable number renders static instead.
      expect(uvAnimOffset(3, 1)).toBe(0);
      expect(uvAnimOffset(0, 0)).toBe(0);
    });

    it('falls back to the identity for a negative or fractional slot', () => {
      expect(uvAnimOffset(-2, 4)).toBe(0);
      expect(uvAnimOffset(1.5, 4)).toBe(0);
    });

    it('falls back to the identity when the submesh names no animation at all', () => {
      expect(uvAnimOffset(undefined, 4)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('shifts a valid slot past the identity that always sits at 0', () => {
      expect(uvAnimOffset(0, 2)).toBe(UV_ANIM_STRIDE);
      expect(uvAnimOffset(1, 2)).toBe(2 * UV_ANIM_STRIDE);
    });
  });
});
