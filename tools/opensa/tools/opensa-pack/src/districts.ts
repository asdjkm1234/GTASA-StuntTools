/**
 * The world's named districts, baked beside the pak (201/5-03).
 *
 * **A name resolved at runtime is a name that cannot exist.** The districts live in `data/info.zon` as GXT
 * KEYS (`LMEX`, `GANTON`) and their display text lives in `text/american.gxt` — two files of the game dir,
 * and a surface streaming a pak over HTTP has no game dir at all. So the resolution happens here, once, at
 * build time, and what ships is a table of boxes with their text already in them
 * (`docs/restrictions/build-vs-runtime.md`).
 *
 * The table rides as a LOOSE `districts.json` next to the pak, the way `water.bin` does, rather than as a pak
 * entry: it is one small fetch that a consumer either wants at boot or never, and keeping it out of the
 * archive means a host can read it without a range reader.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { gxtKeyHash, parseGxt, parseZones } from '@opensa/renderware';

/** One named box, GTA world x/y (native Z-up) — the same extent `info.zon` declares. */
export interface District {
  /** GXT key, kept so a consumer can tell two districts sharing a display name apart (`OCEAF1/2/3`). */
  key: string;
  max: [number, number];
  min: [number, number];
  /** Display text from the GXT, or the key when the GXT has no row for it. */
  name: string;
}

/** What lands in `districts.json`. */
export interface DistrictTable {
  districts: District[];
  /** Which GXT the names came out of — a total conversion ships its own, and a table whose source is not
   *  recorded cannot be told apart from one built before the game's text was replaced. */
  gxt: null | string;
}

/**
 * Resolve `info.zon` against a GXT into a shippable table. Absent files are not an error — a total
 * conversion may ship neither, and the consumer then falls back to whatever it did before districts existed.
 */
export function buildDistrictTable(fs: AssetFileSystem, gxtName = 'text/american.gxt'): DistrictTable | null {
  const text = fs.getText('data/info.zon');
  if (text === null) {
    return null;
  }
  const buffer = fs.get(gxtName);
  const gxt = buffer ? parseGxt(buffer) : null;
  const districts = parseZones(text).map((zone) => ({
    key: zone.label,
    max: zone.max,
    min: zone.min,
    name: (gxt?.get(gxtKeyHash(zone.label)) ?? '').trim() || zone.label,
    // `label` is the GXT key `info.zon`'s last column carries; `name` is the box's own id, which is NOT
    // what the game shows (numbered boxes like OCEAF1/2/3 all display one label).
  }));

  return districts.length > 0 ? { districts, gxt: gxt ? gxtName : null } : null;
}
