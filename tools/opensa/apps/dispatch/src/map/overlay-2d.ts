/**
 * The 2D symbology layer: icons, callsigns, call chips, leader lines and the scale bar, drawn on a plain
 * canvas stacked over the WebGPU one.
 *
 * This is where the engine's missing text stops mattering. Everything a dispatcher reads is 2D by nature —
 * it must stay upright, stay legible at any zoom and never be occluded — so putting it in the 3D scene would
 * be the wrong call even if the renderer had a font. The only thing that has to live in the world is the
 * beacon, and that is `beacons.ts`.
 *
 * The layer also OWNS hit-testing: it remembers the screen rect of everything it drew, so a click resolves
 * against exactly the pixels the operator aimed at, chip included.
 */
import type { Incident, Operations, Selection, Unit } from '../ops/types';
import type { LabelBox } from './labels';
import type { ScreenProjector } from './projection';

import { PUBLISH_INTERVAL_MS } from '../ops/tracks';
import { incidentKey, type Rgba, SET_COLORS } from './beacons';
import { aheadOf, gtaToEngine } from './coords';
import { CollisionIndex, labelCandidates, labelRank } from './labels';

/** What the last draw put on screen, and what a click at those pixels selects. */
export interface HitArea {
  readonly height: number;
  readonly id: string;
  readonly kind: 'incident' | 'unit';
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/** What one frame of symbology drew, so a capture can be read against the load it was under. */
export interface SymbologyCounts {
  /** Label chips drawn. */
  readonly chips: number;
  /** Symbols whose chip was dropped for being past {@link CHIP_MAX_DEPTH} — the decluttering, counted. */
  readonly chipsDropped: number;
  /** `measureText` calls this frame. It is the claim of the width cache, stated rather than asserted: with
   *  the cache warm this is 0 however many symbols are on screen, and every new label costs exactly one. */
  readonly measures: number;
  /** Units drawn with an aging fix — older than one publish interval (201/8-02). */
  readonly stale: number;
  /** Icons drawn — units plus calls that projected onto the canvas. */
  readonly symbols: number;
}

/** Height above ground the unit/call icons are anchored at, so they clear the road surface. */
const ICON_LIFT = 4;
/** How far above the anchor the chip floats, in screen pixels. */
const CHIP_RISE = 26;
const CHIP_HEIGHT = 18;
/** Keep a clamped chip this far off the canvas edge. */
const CHIP_MARGIN = 4;
const FONT = '600 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
const FONT_SMALL = '500 10px ui-sans-serif, system-ui, -apple-system, sans-serif';
/** Past this distance from the eye a chip is dropped — a city view would otherwise be a wall of text. */
const CHIP_MAX_DEPTH = 2600;
/** Below this canvas width a call chip drops its title and keeps the code — the list carries the rest. */
const NARROW_CANVAS = 620;
/**
 * When a unit's last fix stops being current, and when the feed has given up on it (201/8-02).
 *
 * **Both numbers are PCAD's, not ours** ([202 §4](../../../../docs/plans/202-pcad-dispatch/readme.md), read
 * out of the plugin and the backend rather than chosen here): positions publish every **4 s**, so a fix
 * younger than that is not late — it is simply the newest one sent. The backend sweeps a unit as stale after
 * **300 s**, so past that the feed itself has stopped believing in the position and the map may not keep
 * drawing it as if it were current.
 *
 * Between the two the marker FADES rather than flipping, because that is the honest shape of the thing: a
 * fix does not become wrong at a threshold, it gets older. This is the half 8/02 owed — a stale marker, not
 * a confidently wrong one — and the interpolation half of that step is answered by not having any.
 */
/** A fix is CURRENT for one publish interval — derived, because a hardcoded twin of the feed's rate goes
 *  quietly wrong the day the rate changes: every unit would read as aging, or none would. */
const FIX_FRESH_MS = PUBLISH_INTERVAL_MS;
const FIX_LOST_MS = 300_000;
/** How faint a lost unit gets. Not zero: an operator must still be able to find it and ask why. */
const FIX_LOST_ALPHA = 0.35;

/** Horizontal padding inside a chip, added to the measured text width. */
const CHIP_PADDING = 14;
/** Distinct labels the width cache holds before it is dropped whole. */
const WIDTH_CACHE_CAP = 512;
/** Round distances the scale bar is allowed to show. */
const SCALE_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;

/** One entity's bid for a label: everything the placement pass needs, and nothing about the camera. */
interface LabelRequest {
  readonly color: string;
  readonly id: string;
  readonly kind: 'incident' | 'unit';
  /** Smaller wins — see {@link labelRank}. */
  readonly rank: number;
  readonly selected: boolean;
  readonly text: string;
  readonly width: number;
  /** The symbol's screen position, which the leader line runs from. */
  readonly x: number;
  readonly y: number;
}

export class SymbologyLayer {
  private areas: HitArea[] = [];
  /** Chip rects of the frame, held apart so the ICONS can be appended after them (see {@link render}). */
  private chipAreas: HitArea[] = [];
  private counts = { chips: 0, chipsDropped: 0, measures: 0, stale: 0, symbols: 0 };
  /**
   * Chip width by label text, because `measureText` is the layer's per-symbol cost and the labels do not
   * change: a callsign is a callsign for a whole shift. Before this, every chip re-set `ctx.font` (a font
   * re-parse) and re-measured its own text EVERY FRAME — at the nine units the 2026-08-09 capture ran,
   * `overlay-2d` was already the largest item in the body at 2.44 ms, more than `engine-frame`'s 2.10, and
   * the declared worst case is 150.
   *
   * Bounded by construction — a label is a callsign or a call code, both drawn from a fixed board — but
   * cleared past {@link WIDTH_CACHE_CAP} so a very long shift cannot turn it into a leak.
   */
  private readonly widths = new Map<string, number>();

  /** What the last {@link render} drew — the inventory report's `symbology` block. */
  counted(): SymbologyCounts {
    return { ...this.counts };
  }

  /** What sits at a CSS-pixel position, topmost first. Chips count — they are half the click target. */
  hitTest(x: number, y: number): null | { id: string; kind: 'incident' | 'unit' } {
    for (let i = this.areas.length - 1; i >= 0; i -= 1) {
      const area = this.areas[i];
      if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
        return { id: area.id, kind: area.kind };
      }
    }

    return null;
  }

  /**
   * One frame of symbology. `projector` must already carry this frame's camera, and the caller must have
   * cleared the canvas — plan mode draws a ground grid under the symbols, so the clear cannot live here.
   *
   * **Two passes, since 201/3-03.** Every SYMBOL draws first, because an icon is the datum and is never
   * dropped; then the labels compete for pixels best-first through a collision index, and a label that
   * cannot find a free anchor is dropped rather than drawn over its neighbour. Which is why the passes are
   * separate: in one pass the winner of a collision is whichever entity the board happened to list last.
   */
  render(
    ctx: CanvasRenderingContext2D,
    projector: ScreenProjector,
    ops: Operations,
    selection: Selection,
    size: { readonly height: number; readonly width: number },
    fixAges?: ReadonlyMap<string, number>,
  ): void {
    this.areas = [];
    this.chipAreas = [];
    this.counts = { chips: 0, chipsDropped: 0, measures: 0, stale: 0, symbols: 0 };
    // Font and alignment are the chips' state and never vary, so they are set ONCE per frame rather than
    // once per chip: assigning `ctx.font` re-parses the shorthand every time.
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const wanted: LabelRequest[] = [];
    for (const incident of ops.incidents) {
      const request = this.drawIncident(ctx, projector, incident, selection, size);
      if (request) {
        wanted.push(request);
      }
    }
    for (const unit of ops.units) {
      const request = this.drawUnit(ctx, projector, unit, selection, size, fixAges?.get(unit.id) ?? 0);
      if (request) {
        wanted.push(request);
      }
    }
    wanted.sort((a, b) => a.rank - b.rank);
    const index = new CollisionIndex(size.width, size.height);
    for (const request of wanted) {
      this.placeChip(ctx, index, request, size);
    }
    // A chip is a click target for its own entity, but an ICON must still win where a neighbour's chip
    // covers it — so the icons go last in the list `hitTest` walks backwards.
    this.areas = [...this.chipAreas, ...this.areas];
    drawScaleBar(ctx, projector, ops, size);
  }

  /** The chip's width for one label, padded. */
  private chipWidth(ctx: CanvasRenderingContext2D, text: string): number {
    return this.textWidth(ctx, text) + CHIP_PADDING;
  }

  /**
   * A chip's width when part of it CHANGES every second — a callsign plus the age of its fix.
   *
   * Measured in PIECES, because the composite is not cacheable: `4-XRAY-7 · 12s` is a different string one
   * second later, so keying the cache on it re-measures every stale unit on every frame. Measured at 150
   * stale units: 150 `measureText` calls per frame, forever, against the 0 in steady state that
   * [5/02's count](../../../../docs/benchmarks/opensa-engine/2026-08-21-dispatch-symbology-call-counts.json)
   * exists to hold. Both parts are bounded — one string per callsign, and the age vocabulary is about a
   * hundred short strings — so both settle.
   */
  private chipWidthParts(ctx: CanvasRenderingContext2D, text: string, suffix: string): number {
    return this.textWidth(ctx, text) + this.textWidth(ctx, suffix) + CHIP_PADDING;
  }

  private drawIncident(
    ctx: CanvasRenderingContext2D,
    projector: ScreenProjector,
    incident: Incident,
    selection: Selection,
    size: { readonly height: number; readonly width: number },
  ): LabelRequest | null {
    const point = projector.project(gtaToEngine(incident.at, ICON_LIFT));
    if (!point) {
      return null;
    }
    const color = css(SET_COLORS[incidentKey(incident.status, incident.priority)]);
    const selected = selection?.kind === 'incident' && selection.id === incident.id;
    diamond(ctx, point.x, point.y, incident.status === 'closed' ? 5 : 8, color, selected);
    this.counts.symbols += 1;
    this.areas.push({ height: 20, id: incident.id, kind: 'incident', width: 20, x: point.x - 10, y: point.y - 10 });
    if (point.depth > CHIP_MAX_DEPTH && !selected) {
      this.counts.chipsDropped += 1;

      return null;
    }
    const label = size.width < NARROW_CANVAS ? incident.code : `${incident.code} · ${incident.title}`;

    return {
      color,
      id: incident.id,
      kind: 'incident',
      rank: labelRank({ depth: point.depth, kind: 'incident', priority: incident.priority, selected }),
      selected,
      text: label,
      width: this.chipWidth(ctx, label),
      x: point.x,
      y: point.y,
    };
  }

  private drawUnit(
    ctx: CanvasRenderingContext2D,
    projector: ScreenProjector,
    unit: Unit,
    selection: Selection,
    size: { readonly height: number; readonly width: number },
    ageMs: number,
  ): LabelRequest | null {
    const point = projector.project(gtaToEngine(unit.at, ICON_LIFT));
    if (!point) {
      return null;
    }
    // The chevron's screen angle comes from projecting a point AHEAD of the unit, so it stays correct under
    // any camera yaw or tilt without the overlay having to know the camera's basis.
    const ahead = projector.project(gtaToEngine(aheadOf(unit.at, unit.heading, 14), ICON_LIFT));
    const stale = ageMs > FIX_FRESH_MS;
    const color = css(SET_COLORS[unit.status], stale ? fixAlpha(ageMs) : 1);
    const selected = selection?.kind === 'unit' && selection.id === unit.id;
    const angle = ahead ? Math.atan2(ahead.y - point.y, ahead.x - point.x) : 0;
    // A stale unit is drawn HOLLOW as well as faded: fade alone reads as distance on a tilted map, and the
    // difference between "far away" and "we have not heard from it" is the whole point of the mark.
    chevron(ctx, point.x, point.y, angle, color, selected, stale);
    this.counts.symbols += 1;
    this.areas.push({ height: 20, id: unit.id, kind: 'unit', width: 20, x: point.x - 10, y: point.y - 10 });
    if (stale) {
      this.counts.stale += 1;
    }
    if (point.depth > CHIP_MAX_DEPTH && !selected) {
      this.counts.chipsDropped += 1;

      return null;
    }
    // The age goes ON the chip rather than beside it: a callsign an operator cannot trust is a callsign
    // that has to say so in the same glance.
    const suffix = stale ? ` · ${age(ageMs)}` : '';
    const width = stale ? this.chipWidthParts(ctx, unit.callsign, suffix) : this.chipWidth(ctx, unit.callsign);

    return {
      color,
      id: unit.id,
      kind: 'unit',
      rank: labelRank({ depth: point.depth, kind: 'unit', selected, status: unit.status }),
      selected,
      text: `${unit.callsign}${suffix}`,
      width,
      x: point.x,
      y: point.y,
    };
  }

  /** One label, placed if the pixels are free. The symbol is already drawn; only the name is at stake. */
  private placeChip(
    ctx: CanvasRenderingContext2D,
    index: CollisionIndex,
    request: LabelRequest,
    size: { readonly height: number; readonly width: number },
  ): void {
    const candidates = labelCandidates(request.x, request.y, request.width, CHIP_HEIGHT, CHIP_RISE).map((box) =>
      clampToCanvas(box, size),
    );
    const box = index.placeFirst(candidates);
    if (box === null) {
      this.counts.chipsDropped += 1;

      return;
    }
    chip(ctx, request, box);
    this.counts.chips += 1;
    this.chipAreas.push({ ...box, id: request.id, kind: request.kind });
  }

  /** One string's width, measured once and remembered. The chip's padding is the caller's, so a width can
   *  be assembled from parts when half of it changes every second. */
  private textWidth(ctx: CanvasRenderingContext2D, text: string): number {
    const cached = this.widths.get(text);
    if (cached !== undefined) {
      return cached;
    }
    if (this.widths.size >= WIDTH_CACHE_CAP) {
      this.widths.clear();
    }
    const width = ctx.measureText(text).width;
    this.counts.measures += 1;
    this.widths.set(text, width);

    return width;
  }
}

/** A colour from the shared table, as CSS. */
export function css(rgba: Rgba, alpha = rgba[3]): string {
  const to255 = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);

  return `rgba(${to255(rgba[0])}, ${to255(rgba[1])}, ${to255(rgba[2])}, ${alpha})`;
}

/**
 * Touch the canvas's backing store before the loop does.
 *
 * **This is the one that mattered, and it was found by splitting the span rather than by reasoning.** The
 * phone's first overlay draw spent **212 ms of a 333 ms frame inside the first `clearRect`** — 64 % — while
 * the first glyph raster beside it was 22.6
 * ([the split capture](../../../../docs/benchmarks/opensa-engine/2026-08-25-mobile-first-draw-split.json)).
 * A 2D canvas on Android Chromium is GPU-backed, and the first drawing operation is what allocates that
 * store and wires up its raster path — at boot, in the same GPU process that is busy creating the WebGPU
 * device for the map canvas beside it. The same measurement under a taller viewport and a colder start read
 * 1 850 ms, so 212 is a floor rather than the number.
 *
 * Call it once the canvas has its FINAL backing size. Warming it earlier allocates a store at the wrong
 * size, which is thrown away and paid for again the moment the real one is needed.
 */
export function warmOverlaySurface(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Resolve the fonts this layer draws with, ONCE, before the first frame is timed.
 *
 * Measured on the phone 2026-08-25: the console's first drawn frame cost **1654.9 ms, of which `overlay-2d`
 * was 1528.1** — with zero cells resident and twelve draws, so there was nothing else in it. The layer's
 * first `ctx.font` assignment is where a browser resolves the family stack
 * (`ui-sans-serif, system-ui, -apple-system, sans-serif`), and on this device that walk is most of a second.
 *
 * Warming it at boot does not make the work cheaper — it moves it out of the frame loop and into the wait
 * the console already spends on the pak, which is the difference between a first frame the operator feels
 * and a cost nobody can see. It is also a test: if a later capture still shows a first frame like that one,
 * the font is ruled out and the cost is somewhere else.
 */
export function warmTextMetrics(ctx: CanvasRenderingContext2D): void {
  for (const font of [FONT, FONT_SMALL]) {
    ctx.font = font;
    // The measure is what forces the resolution; assigning the shorthand alone can be lazy.
    ctx.measureText('0');
    // And a DRAW, because measuring is not rasterizing: `measureText` resolves the face and its metrics and
    // leaves the glyph atlas cold, so the first real `fillText` still paid for it. Measured on the device
    // 2026-08-25: `overlay:symbols` cost 22.6 ms on the first frame against 0.09 ms after. Off-canvas, so
    // nothing of this reaches a pixel anybody sees.
    ctx.fillText('0', -50, -50);
  }
}

/** A fix's age as the chip says it: `12s`, `4m`, `1h 20m`. */
function age(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) {
    return `${total}s`;
  }
  if (total < 3600) {
    return `${Math.floor(total / 60)}m`;
  }

  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`;
}

/**
 * The unit symbol: a disc with a heading chevron, the way a moving-map AVL display draws one.
 *
 * `stale` draws it HOLLOW — the disc is outlined rather than filled — which is the part a fade alone cannot
 * carry, because a faded symbol on a tilted map reads as distance.
 */
function chevron(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string,
  selected: boolean,
  stale = false,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, selected ? 9 : 7, 0, Math.PI * 2);
  ctx.fillStyle = stale ? 'rgba(8, 12, 18, 0.7)' : color;
  ctx.fill();
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0, 0, 0, 0.65)';
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.stroke();

  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(5, -5);
  ctx.lineTo(5, 5);
  ctx.closePath();
  if (stale) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A label chip with its leader line back to the icon. Returns the rect it occupies, for hit-testing.
 *
 * `width` comes from the caller's cache and the font is the frame's — neither is re-established here,
 * because both are per-symbol costs at a count where the layer already dominates the frame.
 */
function chip(ctx: CanvasRenderingContext2D, request: LabelRequest, box: LabelBox): void {
  const centre = box.x + box.width / 2;
  const middle = box.y + box.height / 2;
  // The leader runs from the symbol to the box, whichever of the four anchors the placement found — the
  // chip may sit above, below or beside its icon now (201/3-03), and a line that assumed "above" would
  // point at nothing.
  const toward = leaderEnd(request.x, request.y, box);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(request.x, request.y);
  ctx.lineTo(toward.x, toward.y);
  ctx.stroke();

  // Square, and nearly opaque. A rounded chip at 82 % over a moving world is the shape and the material of
  // a web badge; a unit label on an operations map is a stamped plate, and it has to stay readable when the
  // thing under it is a lit street rather than a flat panel.
  ctx.fillStyle = request.selected ? 'rgba(12, 18, 26, 0.98)' : 'rgba(8, 12, 18, 0.94)';
  roundRect(ctx, box.x, box.y, box.width, box.height, 1);
  ctx.fill();
  ctx.strokeStyle = request.selected ? '#ffffff' : request.color;
  ctx.lineWidth = request.selected ? 1.6 : 1;
  ctx.stroke();

  ctx.fillStyle = '#e8eef6';
  ctx.fillText(request.text, centre, middle + 0.5);
}

/** Slide a candidate box inside the canvas. A chip centred on an icon near the edge hangs half off screen,
 *  which on a phone is most of them; the leader stays on the icon, so sliding is not ambiguous. */
function clampToCanvas(box: LabelBox, size: { readonly height: number; readonly width: number }): LabelBox {
  return {
    ...box,
    x: Math.min(Math.max(box.x, CHIP_MARGIN), Math.max(CHIP_MARGIN, size.width - box.width - CHIP_MARGIN)),
    y: Math.min(Math.max(box.y, CHIP_MARGIN), Math.max(CHIP_MARGIN, size.height - box.height - CHIP_MARGIN)),
  };
}

/** The call symbol: a diamond, as every CAD map draws an incident. */
function diamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  selected: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  ctx.rect(-size, -size, size * 2, size * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0, 0, 0, 0.7)';
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.stroke();
  ctx.restore();
}

/**
 * The scale bar, measured rather than assumed: project two ground points a known distance apart at the view
 * centre and read the pixels back. It stays honest under tilt, which a "pixels per unit" constant would not.
 */
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  projector: ScreenProjector,
  ops: Operations,
  size: { readonly height: number; readonly width: number },
): void {
  const anchor = ops.units[0]?.at ?? [0, 0];
  const a = projector.project(gtaToEngine(anchor));
  const b = projector.project(gtaToEngine([anchor[0] + 100, anchor[1]]));
  if (!a || !b) {
    return;
  }
  const pixelsPer100 = Math.hypot(b.x - a.x, b.y - a.y);
  if (pixelsPer100 < 0.01) {
    return;
  }
  const metres = SCALE_STEPS.find((step) => (step / 100) * pixelsPer100 > 70) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
  const width = (metres / 100) * pixelsPer100;
  const x = 18;
  const y = size.height - 26;

  ctx.strokeStyle = 'rgba(232, 238, 246, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y - 5);
  ctx.stroke();
  ctx.font = FONT_SMALL;
  ctx.fillStyle = 'rgba(232, 238, 246, 0.85)';
  ctx.textAlign = 'left';
  ctx.fillText(`${metres} m`, x, y - 12);
  // Drawn last, so putting the chip state back costs nothing — but a caller that adds a pass after this one
  // would otherwise inherit the scale bar's font and alignment.
  ctx.font = FONT;
  ctx.textAlign = 'center';
}

/**
 * How solid an aging marker is drawn: full at one publish interval, {@link FIX_LOST_ALPHA} once the backend
 * has swept the unit as stale, linear between. A fix does not become wrong at a threshold — it gets older.
 */
function fixAlpha(ageMs: number): number {
  const past = Math.min(1, (ageMs - FIX_FRESH_MS) / Math.max(1, FIX_LOST_MS - FIX_FRESH_MS));

  return 1 - past * (1 - FIX_LOST_ALPHA);
}

/** Where the leader line meets the chip: the point on the box's edge nearest the symbol. */
function leaderEnd(x: number, y: number, box: LabelBox): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, box.x), box.x + box.width),
    y: Math.min(Math.max(y, box.y), box.y + box.height),
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
