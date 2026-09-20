/**
 * The ground a 201 measurement may be taken on — and which of them is PINNED.
 *
 * [201/1-01](../../../../docs/plans/201-dispatch-console/1-the-map-profile/readme.md) pins one district for
 * the whole chain, because a before-table from one district and an after-table from another is not an A/B.
 * The first real mobile row was taken on Ganton — a valid measurement of a real district, and not part of
 * this chain's series, which cost a paragraph of prose in the benchmark file to say.
 *
 * So the name lives here rather than in three places that can disagree:
 *
 * - the console reads it for the opening pose, so `?district=` alone lands on the right ground;
 * - the inventory report reads it to say whether the capture belongs to the chain's series;
 * - `scripts/phone.sh` reads it for the pak rect, so the pak, the URL and the report all name one place.
 *
 * `cells` is an INCLUSIVE rect on the 250-unit render grid (cell = floor(worldXY / 250)) — the same form
 * `opensa-pack --rect` takes. A pak whose rect does not contain a district cannot show it, and that is the
 * failure this table exists to make impossible to take by accident.
 */

export interface MeasurementDistrict {
  /** The ground point the map opens over (GTA x, y) — what `?at=` defaults to for this name. */
  readonly at: readonly [number, number];
  /** Inclusive GTA cell rect a pak must cover to contain this district: x0, y0, x1, y1. */
  readonly cells: readonly [number, number, number, number];
  /** Why this ground. A district is a choice, and this is what a later reader argues against. */
  readonly note: string;
  /** Where the GAME shell spawns for this district (GTA x, y, z) — the map itself only needs `at`. */
  readonly spawn: readonly [number, number, number];
}

/** The district 201/1-01 pinned on 2026-08-06. Every before/after in the chain is taken here. */
export const PINNED_DISTRICT = 'los-santos-centre';

export const DISTRICTS: Readonly<Record<string, MeasurementDistrict>> = {
  ganton: {
    at: [2400, -1700],
    cells: [9, -7, 10, -6],
    note:
      'the rect the phone workflow converted first — low, sparse suburb. The 2026-08-07 mobile row was ' +
      'taken here, which is why it is NOT part of the chain series',
    spawn: [2400, -1700, 20],
  },
  'los-santos-centre': {
    at: [1480, -1720],
    // Same 2x2 shape as Ganton, anchored on the cell the opening point falls in — so the two districts
    // differ in CONTENT and not in how much world was converted.
    cells: [5, -7, 6, -6],
    note:
      'dense, mixed heights, water within the view, and the part of the map an operator actually ' +
      'watches — not an empty stretch that flatters every number',
    spawn: [1480, -1720, 20],
  },
  /**
   * The pinned district with one cell added on every side — same centre, same opening point, 4x the ground.
   *
   * Sized from the 2026-08-23 field capture rather than by feel: 4 cells measured **76.1 MB resident, of
   * which `target` is 37.5 and does not grow with the world** (1/01's finding), so the content is ~38.6 MB
   * for 4 cells. Even with every one of these 16 cells resident at once that is ~192 MB — inside the
   * 300-500 MB ceiling with room, and the streamer keeps far less than all of them anyway.
   */
  'los-santos-wide': {
    at: [1480, -1720],
    cells: [4, -8, 7, -5],
    note:
      'the pinned district extended one cell on every side (1000x1000 units, same centre) — for a run ' +
      'that needs somewhere to fly to rather than a 500 m square. NOT the chain series: a capture here ' +
      'is a valid measurement of more world, and its numbers are not comparable to the pinned rect',
    spawn: [1480, -1720, 20],
  },
};
