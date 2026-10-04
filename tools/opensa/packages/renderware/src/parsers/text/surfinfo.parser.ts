import { cleanLines } from './text-lines';

/**
 * What one `surfinfo.dat` row says about a surface (plan 081/10). Field names follow the file's own legend;
 * `roughness` (0-3) and `flammability` (0-2) are the two graded columns, everything else is a flag.
 *
 * `tyreGrip` is a per-surface OVERRIDE the legend advertises and the stock data never uses — it reads 1.0 on
 * all 179 rows (measured 2026-07-27). It is parsed anyway, because a mod may set it; but nothing may be
 * designed around it being interesting. The grip that actually varies comes from {@link SurfaceInfo.adhesionGroup}
 * through `surface.dat`'s matrix.
 */
export interface SurfaceInfo {
  /** `rubber` · `hard` · `road` · `loose` · `sand` · `wet` — the row into `surface.dat`'s matrix. */
  readonly adhesionGroup: string;
  readonly beach: boolean;
  /** `none` · `sparks` · `sand` · `wood` · `dust` — what a bullet hit plays. */
  readonly bulletFx: string;
  readonly carClean: boolean;
  readonly carDirt: boolean;
  readonly climbable: boolean;
  /** 0 not · 1 flammable · 2 very. */
  readonly flammability: number;
  readonly footDust: boolean;
  readonly footsteps: boolean;
  /** `none` · `sparks` — the friction effect while something scrapes along it. */
  readonly frictionEffect: string;
  readonly glass: boolean;
  /** Row order IS the COL material id, so a row is never dropped: a malformed line keeps its name and takes
   *  defaults rather than shifting every surface after it. */
  readonly name: string;
  /** The surface refuses a sprint (the legend's `SPRINT` column is "cant sprint on"). */
  readonly noSprint: boolean;
  readonly pavement: boolean;
  readonly procObj: boolean;
  readonly procPlant: boolean;
  /** 0 not · 1 quite · 2 rough · 3 very (pad vibration). */
  readonly roughness: number;
  /** Tyres sink into it and can bog down. */
  readonly sand: boolean;
  readonly seeThrough: boolean;
  readonly shallowWater: boolean;
  readonly shootThrough: boolean;
  readonly skateable: boolean;
  /** `default` · `sandy` · `muddy` — which mark a sliding tyre leaves (plan 089 step 3). */
  readonly skidmark: string;
  readonly softLand: boolean;
  readonly sparks: boolean;
  readonly stairs: boolean;
  readonly steepSlope: boolean;
  /** Per-surface tyre-grip override — see the note above: 1.0 everywhere in stock data. */
  readonly tyreGrip: number;
  readonly water: boolean;
  /** Rain modifier on the tyre grip; 0 on 116 of the 179 stock rows, −0.40 or −0.25 on most of the rest. */
  readonly wetGrip: number;
  /** The `W_*` columns: which wheel effect this surface throws up (plan 089 step 5). */
  readonly wheelDust: boolean;
  readonly wheelGrass: boolean;
  readonly wheelGravel: boolean;
  readonly wheelMud: boolean;
  readonly wheelSand: boolean;
  readonly wheelSpray: boolean;
}

/** Token positions in a row, from the file's four-line STACKED header (each column lists up to four names
 *  down the page). Spelled out because nothing else in the file marks them. */
const COLUMN = {
  adhesionGroup: 1,
  beach: 13,
  bulletFx: 35,
  carClean: 25,
  carDirt: 24,
  climbable: 34,
  flammability: 19,
  footDust: 23,
  footsteps: 22,
  frictionEffect: 5,
  glass: 14,
  name: 0,
  noSprint: 21,
  pavement: 17,
  procObj: 33,
  procPlant: 32,
  roughness: 18,
  sand: 9,
  seeThrough: 7,
  shallowWater: 11,
  shootThrough: 8,
  skateable: 16,
  skidmark: 4,
  softLand: 6,
  sparks: 20,
  stairs: 15,
  steepSlope: 12,
  tyreGrip: 2,
  water: 10,
  wetGrip: 3,
  wheelDust: 29,
  wheelGrass: 26,
  wheelGravel: 27,
  wheelMud: 28,
  wheelSand: 30,
  wheelSpray: 31,
} as const;

/**
 * Parse `data/surfinfo.dat` into the full per-surface table: **row order = COL material id** (the byte every
 * collision face and primitive carries), so `table[face.material]` is the surface a wheel, a foot or a
 * bullet is on. SA ships 179 rows, including the `p_*` ones `procobj.dat` rules reference.
 *
 * The row's shape, in tokens:
 *
 * ```text
 * name  adhesion tyreGrip wetGrip  skidmark friction | 7 flag groups of 4 | climbable bulletFx  audioName
 * ```
 */
export function parseSurfaceInfo(text: string): SurfaceInfo[] {
  return cleanLines(text).map((line) => {
    const cells = line.split(/\s+/);
    const flag = (column: number): boolean => cells[column] === '1';
    const graded = (column: number): number => {
      const value = Number(cells[column]);

      return Number.isFinite(value) ? value : 0;
    };
    const word = (column: number, fallback: string): string => cells[column]?.toLowerCase() ?? fallback;

    return {
      adhesionGroup: word(COLUMN.adhesionGroup, 'road'),
      beach: flag(COLUMN.beach),
      bulletFx: word(COLUMN.bulletFx, 'none'),
      carClean: flag(COLUMN.carClean),
      carDirt: flag(COLUMN.carDirt),
      climbable: flag(COLUMN.climbable),
      flammability: graded(COLUMN.flammability),
      footDust: flag(COLUMN.footDust),
      footsteps: flag(COLUMN.footsteps),
      frictionEffect: word(COLUMN.frictionEffect, 'none'),
      glass: flag(COLUMN.glass),
      name: word(COLUMN.name, ''),
      noSprint: flag(COLUMN.noSprint),
      pavement: flag(COLUMN.pavement),
      procObj: flag(COLUMN.procObj),
      procPlant: flag(COLUMN.procPlant),
      roughness: graded(COLUMN.roughness),
      sand: flag(COLUMN.sand),
      seeThrough: flag(COLUMN.seeThrough),
      shallowWater: flag(COLUMN.shallowWater),
      shootThrough: flag(COLUMN.shootThrough),
      skateable: flag(COLUMN.skateable),
      skidmark: word(COLUMN.skidmark, 'default'),
      softLand: flag(COLUMN.softLand),
      sparks: flag(COLUMN.sparks),
      stairs: flag(COLUMN.stairs),
      steepSlope: flag(COLUMN.steepSlope),
      tyreGrip: cells[COLUMN.tyreGrip] === undefined ? 1 : graded(COLUMN.tyreGrip),
      water: flag(COLUMN.water),
      wetGrip: graded(COLUMN.wetGrip),
      wheelDust: flag(COLUMN.wheelDust),
      wheelGrass: flag(COLUMN.wheelGrass),
      wheelGravel: flag(COLUMN.wheelGravel),
      wheelMud: flag(COLUMN.wheelMud),
      wheelSand: flag(COLUMN.wheelSand),
      wheelSpray: flag(COLUMN.wheelSpray),
    };
  });
}

/**
 * The surface NAMES alone (row index = COL material id) — what `procobj.dat` rules key off, and the shape
 * this module shipped before {@link parseSurfaceInfo} existed. Kept as its own entry point because the
 * procobj path wants one string per row and nothing else.
 */
export function parseSurfaceNames(text: string): string[] {
  return cleanLines(text).map((line) => line.split(/\s+/)[0].toLowerCase());
}
