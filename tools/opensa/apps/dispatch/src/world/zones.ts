/**
 * The world's named districts, as the console reads them (201/5-03).
 *
 * A dispatcher does not work in coordinates. "Grove Street, Ganton" is the address a call goes out with, and
 * until this existed the console's answer came from a **hardcoded table of twenty Los Santos landmarks** in
 * `ops/seed.ts` — which is fine for a demo of stock SA and wrong for every total conversion this engine
 * exists to run.
 *
 * **The console imports nothing from `packages/game` to do it**, and that is a decision rather than an
 * accident (201/5-03, recorded in `docs/restrictions/architecture.md`). The game's `ZoneNameSystem` is an
 * ECS system that tracks a PLAYER across frames; this surface has no player and no ECS, and needs one pure
 * question answered — what is at this point. That question lives beside the parser in
 * `@opensa/renderware` (`zoneAt`), where both consumers reach it and neither owns it.
 *
 * The DATA is baked: `districts.json` rides beside the pak with the GXT text already resolved, because
 * `info.zon` holds GXT keys and a surface streaming a pak has no `text/american.gxt` to resolve them
 * against. A pak without one — a total conversion with no `info.zon`, or a pak built before the field
 * existed — leaves the table empty, and the caller falls back to whatever it did before.
 */
import type { MapZone } from '@opensa/renderware';

import { pakTraffic } from '@opensa/engine';
import { zoneAt } from '@opensa/renderware';

import type { GtaGround } from '../map/coords';

/** Answers "what is this place called", or null everywhere when the pak carries no districts. */
export interface DistrictLookup {
  /**
   * The BOX of the most specific district containing a point, GTA min/max — what the district zoom level
   * frames (201/7-02). The same lookup as {@link nameAt} and deliberately a second method rather than a
   * richer return: `nameAt` is called on every pick and every readout, and a box it does not need is a box
   * it should not allocate.
   */
  boxAt(at: GtaGround): null | { readonly max: readonly [number, number]; readonly min: readonly [number, number] };
  /**
   * EVERY district box — the city's shape rather than one answer about a point (201/7-04's radar draws it
   * as the outline everything else is read against). A world with no `info.zon` has none, and the radar
   * then shows the units over an empty dial rather than over somebody else's city.
   */
  readonly boxes: readonly { readonly max: readonly [number, number]; readonly min: readonly [number, number] }[];
  /** How many boxes were loaded — 0 means every lookup answers null, and the caller should say so once. */
  readonly count: number;
  /** The most specific district containing a GTA ground point, or null. */
  nameAt(at: GtaGround): null | string;
  /**
   * Places whose name contains the query, best first (201/7-03's search box). Case- and
   * accent-insensitive, and a prefix match sorts above a mid-word one — "vin" should offer Vinewood before
   * it offers anything that merely contains those letters.
   *
   * This is the OTHER half of the layer decision in 5/03: the console does not carry a place list of its
   * own, so a total conversion's own districts are the ones an operator searches, and a world that ships no
   * `info.zon` has nothing to search rather than a wrong answer taken from stock San Andreas.
   */
  search(query: string, limit?: number): readonly SearchedPlace[];
}

/** One search hit: what to show in the list, and the box to fly to. */
export interface SearchedPlace {
  readonly max: readonly [number, number];
  readonly min: readonly [number, number];
  readonly name: string;
}

/** One baked district: the box, its GXT key, and the display text already resolved. */
interface District {
  key: string;
  max: [number, number];
  min: [number, number];
  name: string;
}

/** An empty lookup — what a pak with no districts gets, so no caller has to null-check the loader. */
export const NO_DISTRICTS: DistrictLookup = {
  boxAt: () => null,
  boxes: [],
  count: 0,
  nameAt: () => null,
  search: () => [],
};

/**
 * Load the baked district table from beside the pak. Never throws: a missing or malformed file is a world
 * without district names, which every caller already has to handle.
 */
export async function loadDistricts(
  base: string,
  districts: undefined | { count: number; file: string },
): Promise<DistrictLookup> {
  if (!districts) {
    return NO_DISTRICTS;
  }
  const table = await fetchTable(`${base}/${districts.file}`);
  if (table === null || table.length === 0) {
    return NO_DISTRICTS;
  }
  // `zoneAt` reads `MapZone`; `level` plays no part in the containment test and the baked table drops it.
  const zones: MapZone[] = table.map((entry) => ({
    label: entry.key,
    level: 0,
    max: entry.max,
    min: entry.min,
    name: entry.name,
  }));

  return {
    boxAt: (at) => {
      const zone = zoneAt(zones, at[0], at[1]);

      return zone === null ? null : { max: [zone.max[0], zone.max[1]], min: [zone.min[0], zone.min[1]] };
    },
    boxes: zones.map((zone) => ({
      max: [zone.max[0], zone.max[1]] as const,
      min: [zone.min[0], zone.min[1]] as const,
    })),
    count: zones.length,
    nameAt: (at) => zoneAt(zones, at[0], at[1])?.name ?? null,
    search: (query, limit = SEARCH_LIMIT) => searchZones(zones, query, limit),
  };
}

/** How many hits a search answers with. A list an operator has to scroll is a list they stop reading. */
const SEARCH_LIMIT = 8;

async function fetchTable(url: string): Promise<District[] | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    // Loose beside the pak, like `water.bin` — so it is recorded here or it is missing from the bytes
    // column entirely (the IO worker never sees it).
    pakTraffic.record('districts.json', new TextEncoder().encode(text).byteLength);
    const parsed: unknown = JSON.parse(text);
    const rows: unknown = (parsed as null | { districts?: unknown })?.districts;

    // Shape-checked rather than cast. A cast satisfies the compiler and nothing else: a row missing `min`
    // reaches `zoneAt`, which reads `zone.min[0]` and throws — inside the map's TAP HANDLER, well outside
    // this try/catch. The file is our own pack's output, so a bad one means a bad build rather than an
    // attack, and it should still degrade to "this world has no district names".
    return Array.isArray(rows) ? rows.filter(isDistrict) : null;
  } catch {
    return null;
  }
}

/** Lower-cased and stripped of accents, so a query matches a name a mod author spelled with them. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** A row is usable only if it carries the two corners and a name — everything `zoneAt` will touch. */
function isDistrict(row: unknown): row is District {
  const entry = row as District;

  return (
    typeof entry?.name === 'string' &&
    typeof entry.key === 'string' &&
    Array.isArray(entry.min) &&
    Array.isArray(entry.max) &&
    entry.min.length === 2 &&
    entry.max.length === 2 &&
    entry.min.every(Number.isFinite) &&
    entry.max.every(Number.isFinite)
  );
}

function searchZones(zones: readonly MapZone[], query: string, limit: number): readonly SearchedPlace[] {
  const needle = fold(query);
  if (needle === '') {
    return [];
  }
  const hits: { place: SearchedPlace; rank: number }[] = [];
  // One entry per NAME: `info.zon` names a place once per box it is cut into (Vinewood is several), and a
  // picker listing the same name four times is one an operator cannot choose from. The boxes are unioned,
  // so flying to the hit frames the whole place rather than a third of it.
  const byName = new Map<string, SearchedPlace>();
  for (const zone of zones) {
    const index = fold(zone.name).indexOf(needle);
    if (index < 0) {
      continue;
    }
    const seen = byName.get(zone.name);
    byName.set(zone.name, {
      max: [Math.max(seen?.max[0] ?? -Infinity, zone.max[0]), Math.max(seen?.max[1] ?? -Infinity, zone.max[1])],
      min: [Math.min(seen?.min[0] ?? Infinity, zone.min[0]), Math.min(seen?.min[1] ?? Infinity, zone.min[1])],
      name: zone.name,
    });
  }
  for (const place of byName.values()) {
    hits.push({ place, rank: fold(place.name).indexOf(needle) });
  }

  return hits
    .sort((a, b) => a.rank - b.rank || a.place.name.localeCompare(b.place.name))
    .slice(0, limit)
    .map((hit) => hit.place);
}
