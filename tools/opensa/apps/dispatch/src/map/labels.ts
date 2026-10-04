/**
 * Which label gets the pixels (201/3-03): the decluttering rule for a screen with 150 units on it.
 *
 * At city zoom the console's symbology collides with itself — chips overlap chips, a callsign sits on top of
 * a call's code, and which one survives is whichever the loop drew last. That is not a drawing problem, it
 * is the label-conflict problem every map engine has solved, and the shape of the answer is
 * [MapLibre's](../../../../docs/links.md): rank the labels, walk them best-first, and give each one the
 * pixels only if nothing better has taken them.
 *
 * Three parts, and each answers one thing the step owes:
 *
 * - **Which label wins.** {@link labelRank} — the operator's own priority, derived from the job rather than
 *   chosen: what they selected, then open calls worst-first, then the units committed to a call, then
 *   whatever is nearest the eye. Colour never carries it (`dataviz`), because the rank decides an ORDER and
 *   the colour already means a status.
 * - **What happens to the loser.** Its SYMBOL still draws — an icon is the datum and is never dropped — and
 *   only its name goes. The count comes back in `SymbologyCounts.chipsDropped` so the chrome can say how
 *   many names are hidden rather than letting the operator believe the map is complete.
 * - **The budget.** There is no constant: a screen holds `floor(area / chipArea)` labels and the index
 *   cannot place more than that however many are asked for. The ceiling is therefore a property of the
 *   viewport, which is what makes one rule serve a 360 px phone and a 4K desk alike.
 *
 * The index is grid-bucketed for the same reason MapLibre's is: at 150 units a naive all-pairs test is
 * ~11 000 comparisons a frame, and a 32 px grid turns each placement into a handful.
 */

/** A label's claim on the screen, in CSS pixels of the overlay canvas. */
export interface LabelBox {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/** Grid cell side in CSS px. About a chip's height, so a chip touches two or three cells rather than twenty. */
const CELL = 32;

/**
 * The screen's occupied space, as a grid of buckets. Boxes are registered in every cell they touch; a
 * placement tests only the cells its own box covers.
 */
export class CollisionIndex {
  /** How many labels this frame has placed — the number the budget bounds. */
  get placed(): number {
    return this.count;
  }
  private readonly cells = new Map<number, LabelBox[]>();
  private readonly columns: number;

  private count = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.columns = Math.max(1, Math.ceil(width / CELL));
  }

  /** Take the pixels if they are free. A box that hangs off the canvas is rejected — a label half on screen
   *  is a label an operator cannot read and a click target they cannot hit. */
  place(box: LabelBox): boolean {
    if (box.x < 0 || box.y < 0 || box.x + box.width > this.width || box.y + box.height > this.height) {
      return false;
    }
    for (const key of this.keysOf(box)) {
      for (const other of this.cells.get(key) ?? []) {
        if (overlaps(box, other)) {
          return false;
        }
      }
    }
    for (const key of this.keysOf(box)) {
      const bucket = this.cells.get(key);
      if (bucket) {
        bucket.push(box);
      } else {
        this.cells.set(key, [box]);
      }
    }
    this.count += 1;

    return true;
  }

  /** Place the first candidate that fits, or null when every one of them is taken (MapLibre's variable
   *  placement: a label that cannot go above may still go below or beside). */
  placeFirst(candidates: readonly LabelBox[]): LabelBox | null {
    for (const box of candidates) {
      if (this.place(box)) {
        return box;
      }
    }

    return null;
  }

  private *keysOf(box: LabelBox): Generator<number> {
    const x0 = Math.max(0, Math.floor(box.x / CELL));
    const y0 = Math.max(0, Math.floor(box.y / CELL));
    const x1 = Math.floor((box.x + box.width) / CELL);
    const y1 = Math.floor((box.y + box.height) / CELL);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        yield y * this.columns + x;
      }
    }
  }
}

/** Where a chip may sit relative to its symbol, best first — above, below, then either side. */
export function labelCandidates(
  x: number,
  y: number,
  width: number,
  height: number,
  rise: number,
): readonly LabelBox[] {
  const half = width / 2;
  const halfHeight = height / 2;

  return [
    { height, width, x: x - half, y: y - rise - halfHeight },
    { height, width, x: x - half, y: y + rise - halfHeight },
    { height, width, x: x + rise, y: y - halfHeight },
    { height, width, x: x - rise - width, y: y - halfHeight },
  ];
}

/** How many labels a viewport can hold at all — the budget, as a property of the screen (201/3-03). */
export function labelCeiling(width: number, height: number, chipWidth: number, chipHeight: number): number {
  return Math.floor((width * height) / Math.max(1, chipWidth * chipHeight));
}

/**
 * The order labels compete in — SMALLER wins. Every term is the operator's job rather than a preference:
 *
 * 1. what they selected, because they asked for it;
 * 2. an open call, worst priority first — the thing the shift is about;
 * 3. a unit committed to a call before one that is free, because it is the one being tracked;
 * 4. nearest the eye, which breaks every remaining tie the same way a map always has.
 *
 * `depth` is the projected distance from the eye, so the last term needs no camera and no zoom level.
 */
export function labelRank(entry: {
  readonly depth: number;
  readonly kind: 'incident' | 'unit';
  /** 1..3 for a call (1 is worst), undefined for a unit. */
  readonly priority?: number;
  readonly selected: boolean;
  /** A unit's status, undefined for a call. */
  readonly status?: 'available' | 'busy' | 'enRoute' | 'onScene';
}): number {
  if (entry.selected) {
    return -1;
  }
  const band = entry.kind === 'incident' ? (entry.priority ?? 3) : 3 + UNIT_ORDER[entry.status ?? 'busy'];

  // The band decides; the depth only orders inside it, and is scaled so no distance can cross a band.
  return band + Math.min(0.999, entry.depth / 100_000);
}

/** Committed units first: an operator is tracking the ones working a call, not the ones patrolling. */
const UNIT_ORDER: Readonly<Record<'available' | 'busy' | 'enRoute' | 'onScene', number>> = {
  available: 2,
  busy: 3,
  enRoute: 0,
  onScene: 1,
};

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
