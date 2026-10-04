/**
 * Merge a mod loader file's `IDE`/`IPL` references into the game's `gta.dat`, so the built game loads the mod's
 * object defs, `txdp` parents and placements. Paths are kept verbatim — `resolveMap` normalizes them on read —
 * only the dedup key is normalized.
 */

import { normalizeDatPath } from '@opensa/renderware/archive';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';

/**
 * Merge `refs` into the stock `gta.dat`, skipping any path already listed (so a mod re-stating a stock IPL doesn't
 * double-place). Returns `base` unchanged when every ref is already there.
 *
 * **The `IDE` refs are SPLICED in before the first `IPL` line; only the `IPL` refs append.** `CFileLoader` reads
 * the file top to bottom and an `IPL` line places its rows THERE, so a definition listed after it does not exist
 * yet: appending both left 137 rows of the `sa` build placing ids six mod IDEs define 55+ lines later, which the
 * real game refuses outright with modloader off
 * (`docs/open-issues/mod-inst-rows-folded-before-their-ide.md`). The IPL slot fold is what puts them there — it
 * moves a mod's rows into stock hosts chosen by capacity, never by position — so the IDEs have to come first
 * instead. The splice point is the FIRST `IPL`, not the top of the file: mod IDEs still land after every stock
 * one, so which definition wins a shared id does not change. Guarded on the built tree by
 * `checkDefinitionOrder` (`@opensa/tool-kit/dat-order`).
 */
export function mergeGtaDat(base: string, refs: { ide: readonly string[]; ipl: readonly string[] }): string {
  const dat = parseGtaDat(base);
  const present = new Set([...dat.ide, ...dat.ipl].map(normalizeDatPath));
  const eol = base.includes('\r\n') ? '\r\n' : '\n';
  const ide: string[] = [];
  const ipl: string[] = [];
  const add = (directive: 'IDE' | 'IPL', path: string): void => {
    const key = normalizeDatPath(path);
    if (!present.has(key)) {
      present.add(key);
      (directive === 'IDE' ? ide : ipl).push(`${directive} ${path}`);
    }
  };
  for (const path of refs.ide) {
    add('IDE', path);
  }
  for (const path of refs.ipl) {
    add('IPL', path);
  }
  if (ide.length === 0 && ipl.length === 0) {
    return base;
  }
  const lines = base.replace(/\s*$/, '').split(/\r?\n/);
  const head = lines[0] === '' && lines.length === 1 ? [] : lines;
  const firstIpl = head.findIndex((line) => /^\s*IPL\s/i.test(line));
  const spliced = firstIpl === -1 ? [...head, ...ide] : [...head.slice(0, firstIpl), ...ide, ...head.slice(firstIpl)];

  return `${[...spliced, ...ipl].join(eol)}${eol}`;
}
