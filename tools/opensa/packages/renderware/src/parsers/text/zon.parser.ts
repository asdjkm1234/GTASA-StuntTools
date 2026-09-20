/**
 * GTA San Andreas `map.zon` — the city boxes. Each line in the `zone … end` block reads
 * `name, type, x1, y1, z1, x2, y2, z2, level, label`; we keep the 2D (x, y) extent and the **level** (the
 * city: 1 = Los Santos, 2 = San Fierro, 3 = Las Venturas). `z1/z2` span the full height, so a 2D AABB
 * classifies a point. Mapping level → city and the point test live in the game layer (`game/zones/city`).
 */

/** A zone box from `map.zon`/`info.zon`: a 2D area (world x/y, native Z-up) + its `level` and text `label`. */
export interface MapZone {
  /** Last field — the GXT text key (`info.zon`; numbered districts like `OCEAF1/2/3` share one label `OCEAF`). */
  label: string;
  level: number;
  max: [number, number];
  min: [number, number];
  name: string;
}

/** Parse the `map.zon` city boxes; comment/section/malformed lines are skipped, z is ignored. */
export function parseZones(text: string): MapZone[] {
  const zones: MapZone[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line === 'zone' || line === 'end' || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 9) {
      continue;
    }
    const [name, , x1, y1, , x2, y2, , levelToken, label] = parts;
    const level = Number(levelToken);
    const bounds = [x1, y1, x2, y2].map(Number);
    if (!Number.isFinite(level) || bounds.some((n) => !Number.isFinite(n))) {
      continue;
    }
    const [ax, ay, bx, by] = bounds;
    zones.push({
      label: label ?? name,
      level,
      max: [Math.max(ax, bx), Math.max(ay, by)],
      min: [Math.min(ax, bx), Math.min(ay, by)],
      name,
    });
  }

  return zones;
}

/**
 * The zone a world point is in, or null when it is in none — **the SMALLEST containing box wins.**
 *
 * That is how the game reads `info.zon`: the boxes nest (a district inside a county inside an island) and
 * the most specific one is the answer, so the test is not "the first match" but "the smallest match". A
 * reader that takes the first box in file order names the island when it should name the street.
 *
 * It lives beside the parser because it is a rule about the FORMAT, and it has exactly one owner for the
 * reason [the cell size](../../../../../docs/restrictions/architecture.md) does: three consumers already
 * want it — the game's `ZoneNameSystem`, the dispatch console's readout, and the pack that bakes the table
 * for it — and a second copy diverges silently, in a label nobody checks.
 *
 * `x`/`y` are GTA world coordinates (native Z-up), matching the boxes as parsed.
 */
export function zoneAt(zones: readonly MapZone[], x: number, y: number): MapZone | null {
  let best: MapZone | null = null;
  let bestArea = Infinity;
  for (const zone of zones) {
    if (x < zone.min[0] || x > zone.max[0] || y < zone.min[1] || y > zone.max[1]) {
      continue;
    }
    const area = (zone.max[0] - zone.min[0]) * (zone.max[1] - zone.min[1]);
    if (area < bestArea) {
      best = zone;
      bestArea = area;
    }
  }

  return best;
}
