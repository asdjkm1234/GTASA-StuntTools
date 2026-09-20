/**
 * The game layer's door to `info.zon`'s containment rule (201/5-03).
 *
 * The rule — a point belongs to the SMALLEST box containing it, because `info.zon`'s districts nest inside
 * counties inside islands — is a property of the format, so it has one owner beside the parser
 * (`zoneAt`, `@opensa/renderware`). Three consumers want it: this layer's `ZoneNameSystem`, the dispatch
 * console's readout, and the pack that bakes the table for that console. A second copy of it diverges
 * silently, in a label nobody checks.
 *
 * It sits in `adapters/` because the boundary lint says renderware is reached from here or from `mods/` and
 * nowhere else in this package — the rule this file exists to satisfy rather than to work around.
 */
import { type MapZone, zoneAt } from '@opensa/renderware';

/** A named zone box: its GXT-key name + 2D world AABB (world x/y, native Z-up). */
export interface NamedZone {
  max: [number, number];
  min: [number, number];
  name: string;
}

/** The name of the most specific zone containing the point, or `''` when it is in none. */
export function namedZoneAt(zones: readonly NamedZone[], x: number, y: number): string {
  return zoneAt(zones as readonly MapZone[], x, y)?.name ?? '';
}
