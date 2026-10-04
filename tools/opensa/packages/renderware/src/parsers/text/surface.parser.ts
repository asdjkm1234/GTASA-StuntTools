/**
 * Parse `data/surface.dat` — the adhesion matrix between material GROUPS (plan 081/10).
 *
 * The file is a LOWER TRIANGLE, one row per group, and its own header names the columns:
 *
 * ```text
 * ;               Rubber   Hard   Road   Loose   Sand   Wet
 * Rubber          6.0
 * Hard            3.6      2.0
 * Road            4.5      3.0    6.0
 * ```
 *
 * So `Road × Rubber` is read off the ROAD row's first column — 4.5, the number this engine has carried
 * hardcoded as `ROAD_ADHESION` since 081/05. A tyre is rubber, so the rubber column is the whole of what
 * vehicle physics needs, but the matrix is mirrored on read because the file's own note ("WheelBase is the
 * surface used for the tyres") is the only thing that makes rubber special, and a caller asking for
 * `adhesion('sand', 'hard')` should not have to know which way round the pair was stored.
 *
 * Comments here start with `;` (surfinfo.dat's start with `#`) — the two files disagree, so this parser
 * cannot use the shared `cleanLines`.
 */

/** The six adhesion groups, in the file's own row order. Lowercased, as `surfinfo.dat` rows are read. */
export const ADHESION_GROUPS = ['rubber', 'hard', 'road', 'loose', 'sand', 'wet'] as const;

export type AdhesionGroup = (typeof ADHESION_GROUPS)[number];

/** Symmetric lookup over the parsed triangle: `get(a, b) === get(b, a)`, `null` for an unknown group. */
export interface AdhesionMatrix {
  get(a: string, b: string): null | number;
  /** The raw rows as parsed, row-major over {@link ADHESION_GROUPS} (an unfilled cell is `null`). */
  readonly rows: readonly (readonly (null | number)[])[];
}

/**
 * Read the matrix. Rows are matched by their NAME rather than by position, so a file that lists the groups
 * in another order (or omits one) still lands in the right cells instead of shifting the whole table.
 */
export function parseSurfaceAdhesion(text: string): AdhesionMatrix {
  const rows: (null | number)[][] = ADHESION_GROUPS.map(() => ADHESION_GROUPS.map(() => null));
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim();
    if (clean.length === 0 || clean.startsWith(';')) {
      continue;
    }
    const [name, ...cells] = clean.split(/\s+/);
    const row = ADHESION_GROUPS.indexOf(name.toLowerCase() as AdhesionGroup);
    if (row === -1) {
      continue;
    }
    cells.forEach((cell, column) => {
      const value = Number(cell);
      if (Number.isFinite(value) && column < ADHESION_GROUPS.length) {
        rows[row][column] = value;
        rows[column][row] = value; // the file stores one half; a caller should not have to know which
      }
    });
  }

  return {
    get(a: string, b: string): null | number {
      const row = ADHESION_GROUPS.indexOf(a.toLowerCase() as AdhesionGroup);
      const column = ADHESION_GROUPS.indexOf(b.toLowerCase() as AdhesionGroup);

      return row === -1 || column === -1 ? null : rows[row][column];
    },
    rows,
  };
}
