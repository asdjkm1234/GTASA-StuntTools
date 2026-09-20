/**
 * How the map camera travels from one view to another (201/7-02).
 *
 * An instant jump loses the operator's sense of where they were — that is the whole reason `flyTo` exists in
 * every map application. What is NOT obvious is that a straight interpolation of centre and zoom is a bad
 * animation: over a long distance it drags the view across the city at ground level, which reads as a blur,
 * asks the streamer for every cell on the way, and takes a time nobody can predict.
 *
 * So this is **not our curve**. It is Van Wijk & Nuij's *Smooth and efficient zooming and panning* (2003),
 * the same path MapLibre's `flyTo` follows ([links](../../../../docs/links.md)): the camera pulls UP as it
 * travels and settles back down at the destination, along the path that is shortest in the space an operator
 * actually perceives — screenfuls, not metres. Two consequences we get for free rather than having to build:
 *
 * - **a long trip zooms out**, so it crosses the city over far-LOD content rather than through it, which is
 *   the honest answer to "do not stall on streaming" — the far ring already holds what the path flies over;
 * - **the duration is DERIVED**, not picked: it is the path length in zoom space divided by a speed stated in
 *   screenfuls per second. A trip twice as far in perceived terms takes twice as long, and no constant in
 *   this file is a millisecond count somebody liked the feel of.
 *
 * The two parameters are the paper's own, kept at the values the field settled on rather than re-fitted here.
 */

export interface Flight {
  /** The view at `elapsed` ms into the flight; clamped to the destination at and past `durationMs`. */
  at(elapsedMs: number): FlyView;
  /** Total travel time, ms — derived from the path, never passed in. */
  readonly durationMs: number;
}

/** A view this module can interpolate: where it is centred, and how much ground it frames. */
export interface FlyView {
  /** GTA ground point under the view. */
  readonly at: readonly [number, number];
  /** The ground extent the view covers, world units — the "screenful" the path is measured in. */
  readonly span: number;
}

/**
 * The paper's ρ: how sharply the path arcs upward. ρ = 1.42 is the value its own user study settled on
 * (§5, "the average of the optimal values chosen by the participants"), and the default MapLibre ships.
 * Lower flies flatter and further; higher pulls up harder.
 */
const RHO = 1.42;
/** Travel speed in SCREENFULS per second — the unit the path is measured in. MapLibre's default. */
const SPEED = 1.2;
/** Below this the two centres are the same point and the flight is a pure zoom (the paper's special case). */
const SAME_POINT = 1e-6;

/**
 * Plan the flight between two views. The result is a pure function of the two views — nothing here reads a
 * clock, so a caller can sample it from its own frame loop and a test can sample it without one.
 */
export function planFlight(from: FlyView, to: FlyView): Flight {
  const u1 = Math.hypot(to.at[0] - from.at[0], to.at[1] - from.at[1]);
  const w0 = Math.max(SAME_POINT, from.span);
  const w1 = Math.max(SAME_POINT, to.span);

  if (u1 < SAME_POINT) {
    return pureZoom(from, to, w0, w1);
  }

  // Van Wijk & Nuij (2003) eq. 9: the geodesic between the two views in zoom space.
  const b0 = (w1 * w1 - w0 * w0 + RHO ** 4 * u1 * u1) / (2 * w0 * RHO * RHO * u1);
  const b1 = (w1 * w1 - w0 * w0 - RHO ** 4 * u1 * u1) / (2 * w1 * RHO * RHO * u1);
  const r0 = Math.log(-b0 + Math.hypot(b0, 1));
  const r1 = Math.log(-b1 + Math.hypot(b1, 1));
  const s1 = (r1 - r0) / RHO;

  if (!Number.isFinite(s1) || Math.abs(s1) < SAME_POINT) {
    return pureZoom(from, to, w0, w1);
  }

  const durationMs = (Math.abs(s1) / SPEED) * 1000;
  const coshR0 = Math.cosh(r0);
  const sinhR0 = Math.sinh(r0);

  return {
    at(elapsedMs: number): FlyView {
      if (elapsedMs >= durationMs) {
        return to;
      }
      const s = s1 * Math.max(0, elapsedMs / durationMs);
      // eq. 8: how far along the ground the view has travelled at path position `s`.
      const u = (w0 * (coshR0 * Math.tanh(RHO * s + r0) - sinhR0)) / (RHO * RHO);
      const t = Math.min(1, Math.max(0, u / u1));

      return {
        at: [from.at[0] + (to.at[0] - from.at[0]) * t, from.at[1] + (to.at[1] - from.at[1]) * t],
        span: (w0 * coshR0) / Math.cosh(RHO * s + r0),
      };
    },
    durationMs,
  };
}

/** The paper's degenerate case: one point, so the path is a straight climb or descent in zoom space. */
function pureZoom(from: FlyView, to: FlyView, w0: number, w1: number): Flight {
  const s1 = Math.abs(Math.log(w1 / w0)) / RHO;
  const durationMs = (s1 / SPEED) * 1000;
  if (durationMs < 1) {
    return { at: () => to, durationMs: 0 };
  }

  return {
    at(elapsedMs: number): FlyView {
      if (elapsedMs >= durationMs) {
        return to;
      }
      const t = Math.max(0, elapsedMs / durationMs);

      // Geometric in the span, which is what makes a zoom read as constant-rate.
      return { at: to.at, span: w0 * (w1 / w0) ** t };
    },
    durationMs,
  };
}
