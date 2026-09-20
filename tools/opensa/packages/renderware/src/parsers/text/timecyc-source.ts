/**
 * Which timecyc file the world runs on (plan 104/01).
 *
 * Three names can carry the table and every reader must prefer them in the SAME order, so the order lives
 * here once and nowhere else. Two of the three are 24h as authored; the third is the mandatory stock
 * 8-keyframe table that {@link ensure24h} expands.
 *
 * `timecyc24h.dat` is the name the `timecyc24h.asi` plugin (Dante) reads on the `sa` target; the file it
 * expects is the same 27-column, 23 × 24, 52-number schema as `timecyc_24h.dat` — the two 24h plugins in
 * this project differ only in the file name each one hardcodes, which is why swapping their data files in
 * the real game silently leaves the stock table live. Nothing here needs to tell the two apart at parse
 * time; `kind` exists so a reader can SAY which file won.
 */
import { parseTimecyc } from './timecyc.parser';

interface TimecycCandidate {
  readonly kind: TimecycKind;
  /** Game-dir-relative path; a caller reading over HTTP prefixes its own base. */
  readonly path: string;
}

/** The candidate names, in preference order. Rows are the single source of that order. */
export const TIMECYC_SOURCES: readonly TimecycCandidate[] = [
  { kind: 'authored-24h', path: 'data/timecyc_24h.dat' },
  { kind: 'dante-24h', path: 'data/timecyc24h.dat' },
  { kind: 'stock', path: 'data/timecyc.dat' },
];

/** Which of the three names supplied the table. */
export type TimecycKind = 'authored-24h' | 'dante-24h' | 'stock';

export type TimecycSource = TimecycCandidate & { readonly text: string };

/**
 * The one-line boot report: `data/timecyc24h.dat (dante-24h, 552 rows)`, or which three names were looked
 * for when the world carries none. **Choosing between two names that are both present is SILENT by nature**
 * — nothing fails, the lower-priority file is simply never read — so this line is the only way a shadowed
 * table is one `grep` away instead of one session. The row count is what `ensure24h` will judge, so it is
 * read the same way (a second parse of ~500 lines, once, at boot).
 */
export function describeTimecycSource(source: null | TimecycSource): string {
  if (source === null) {
    return `none of ${TIMECYC_SOURCES.map((c) => c.path).join(' / ')}`;
  }

  return `${source.path} (${source.kind}, ${parseTimecyc(source.text).length} rows)`;
}

/**
 * First candidate `getText` answers for, or `null` when the game dir carries none of the three.
 * A name that is present but misspelled simply does not match — the fall-through is silent by nature,
 * which is why callers log the winner.
 */
export function resolveTimecycSource(getText: (path: string) => null | string): null | TimecycSource {
  for (const candidate of TIMECYC_SOURCES) {
    const text = getText(candidate.path);
    if (text !== null) {
      return { ...candidate, text };
    }
  }

  return null;
}

/** {@link resolveTimecycSource} over an async reader (the lab fetches). Same order, one definition. */
export async function resolveTimecycSourceAsync(
  getText: (path: string) => Promise<null | string>,
): Promise<null | TimecycSource> {
  for (const candidate of TIMECYC_SOURCES) {
    const text = await getText(candidate.path);
    if (text !== null) {
      return { ...candidate, text };
    }
  }

  return null;
}
