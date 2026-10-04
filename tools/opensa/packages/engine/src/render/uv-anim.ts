/**
 * The UV-animation keyframe walker, shared by both lanes that play one (plan 099/02).
 *
 * The WORLD lane advances the pak's global animation list (kind-4/5 objectTable draws — the LV skull sign's
 * crawling neon); the RIGID lane advances one model's own list (a script object's film strip). They must not
 * drift: same clock, same lerp, same paired-keyframe rule — so there is one implementation and two callers.
 */
/**
 * Byte stride between two animation slots in a model's uniform buffer.
 *
 * WebGPU's `minUniformBufferOffsetAlignment` FLOOR is 256 B — a device may report exactly that, and a
 * dynamic offset must be a multiple of whatever it reports. Picking the floor means the same buffer layout
 * is legal on every device, at the cost of 240 wasted bytes per slot on a 16-byte payload. A model carries a
 * handful of animations, so the whole waste is measured in kilobytes.
 */
export const UV_ANIM_STRIDE = 256;

/** `uv * zw + xy` with these values is the identity — what every non-animated draw binds. */
export const UV_ANIM_IDENTITY: readonly [number, number, number, number] = [0, 0, 1, 1];

/** One UVAnimDict entry, structurally — the engine learns no RenderWare or pak types. */
export interface UvAnimation {
  /** Loop duration in seconds; 0 or less holds the first keyframe. */
  duration: number;
  /** `uv` params are `[rotation, scaleX, scaleY, skew, translateX, translateY]`, verbatim from the DFF. */
  keyframes: readonly { readonly time: number; readonly uv: readonly number[] }[];
}

/**
 * Write `entry`'s transform at wall-clock `seconds` into `out[at..at+4)` as (tx, ty, sx, sy) — the shader's
 * `uv * zw + xy`.
 *
 * Keyframe PAIRS sharing a timestamp are how SA authors a stepped flipbook (the ferris wheel's 13-frame
 * bulb strip, DolSign's crawl): a zero-length span cannot be interpolated, so the earlier key HOLDS until
 * the next one starts. Leaving it to a divide-by-zero guard is not an implementation detail — it is the
 * difference between blinking and smearing.
 */
export function stepUvAnimation(entry: UvAnimation, seconds: number, out: Float32Array, at = 0): void {
  const keys = entry.keyframes;
  if (keys.length === 0) {
    return;
  }
  const time = entry.duration > 0 ? seconds % entry.duration : 0;
  let k = keys.length - 1;
  while (k > 0 && keys[k].time > time) {
    k -= 1;
  }
  const k0 = keys[k];
  const k1 = keys[Math.min(k + 1, keys.length - 1)];
  const span = k1.time - k0.time;
  const f = span > 1e-6 ? Math.min(Math.max((time - k0.time) / span, 0), 1) : 0;
  out[at] = lerp(k0.uv[4] ?? 0, k1.uv[4] ?? 0, f);
  out[at + 1] = lerp(k0.uv[5] ?? 0, k1.uv[5] ?? 0, f);
  out[at + 2] = lerp(k0.uv[1] ?? 1, k1.uv[1] ?? 1, f);
  out[at + 3] = lerp(k0.uv[2] ?? 1, k1.uv[2] ?? 1, f);
}

/**
 * The dynamic offset a submesh binds: its slot, or the IDENTITY when it names none — or names one this
 * model does not have.
 *
 * The out-of-range case is not hypothetical bookkeeping: `uvAnim` is read out of a `.osm` DESC, and a file
 * is a thing a mod ships. An offset past the buffer is a WebGPU VALIDATION error inside the render pass,
 * which takes the frame (and on some drivers the device) down — so a number we cannot vouch for renders
 * STATIC instead, exactly as an unresolvable dict name does at build time.
 */
export function uvAnimOffset(slot: number | undefined, count: number): number {
  if (slot === undefined || !Number.isInteger(slot) || slot < 0 || slot >= count) {
    return 0;
  }

  return (slot + 1) * UV_ANIM_STRIDE;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}
