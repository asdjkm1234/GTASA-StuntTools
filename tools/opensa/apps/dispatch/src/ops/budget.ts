/**
 * The console's declared symbol counts, in one place because three layers have to agree on them: the seed
 * that can produce them, the beacon buffers that must hold them, and the report that states what a capture
 * was drawing.
 *
 * `UNITS_ON_SCREEN` is not a guess — it is the number the user named on 2026-08-06, before any of this was
 * built (`docs/plans/201-dispatch-console/readme.md`, the budget table: *150 units, each drawn as a model
 * with a symbol over it, 60 fps on a phone*). Everything 201/5-02 owes is measured at it.
 *
 * **It is an ALLOCATION, never a ceiling.** A board that exceeds it must still draw every unit it has: the
 * buffers grow and the overflow is counted into the inventory report, because a marker silently dropped at
 * capacity is a unit the dispatcher cannot see and nothing on screen says so. The count that has never been
 * named by anyone is the CALL one, so calls are allocated against the same figure rather than a number
 * invented here.
 */

/** Units the console must carry at once, worst case. */
export const UNITS_ON_SCREEN = 150;

/**
 * Texture bytes the uploaded UNIT MODELS may hold before an idle type is trimmed (201/5-04).
 *
 * Derived from this chain's own ceiling rather than copied from the game, where the same cache is 256 MB:
 * the phone's whole resident budget is 300–500 MB and the pinned district already measured 76.1 MB of it
 * (the 08-23 row), so a quarter of the smaller ceiling is what unit models may hold while the world holds
 * the rest. A shift is a handful of TYPES however many units it has — 150 cars of six kinds upload six
 * models — so the allowance binds only on a board that keeps changing what it drives.
 *
 * Like {@link UNITS_ON_SCREEN} it is an ALLOCATION: a type with live instances is never trimmed, because
 * trimming one would take a unit off the map. The number is owed a device measurement by
 * [2/04](../../../../docs/plans/201-dispatch-console/2-real-device-truth/readme.md).
 */
export const UNIT_MODEL_TEXTURE_BYTES = 64 * 1024 * 1024;

/** How many units the demo board opens with when `?units=` does not say otherwise — a plausible shift. */
export const DEFAULT_SHIFT = 9;

/** How many calls the demo board opens with when `?calls=` does not say otherwise. */
export const DEFAULT_CALLS = 2;

/**
 * The seeded board size, from the query string. `?units=150&calls=40` is how the field run reaches the
 * declared count — without it the board opens with nine units and the number 5/02 owes cannot be taken on
 * any device, which is exactly where this step found the console.
 */
export function seedSize(params: URLSearchParams): { calls: number; units: number } {
  return {
    calls: count(params.get('calls'), DEFAULT_CALLS),
    units: count(params.get('units'), DEFAULT_SHIFT),
  };
}

/** A non-negative integer from a query value, or the fallback when it is absent or not a number. */
function count(raw: null | string, fallback: number): number {
  if (raw === null) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);

  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
