/**
 * Measuring and drawing on the map (201/7-05): a distance, a radius, a cordon.
 *
 * **These are SYMBOLOGY, not world geometry, and that is the step's one real decision.** The plan called for
 * Cesium's classification technique — render a volume, classify the fragments it covers — so a shape drapes
 * over the ground like paint. That is the right answer for a shape that has to look like it is ON the road.
 * It is the wrong answer for an operator's cordon, which has to be visible THROUGH the buildings it is drawn
 * around: a draped cordon disappears behind the first block it crosses, and the thing the dispatcher drew to
 * see is the thing they can no longer see. So a sketch is projected onto the overlay canvas with the frame's
 * own view-projection, exactly as the unit chips are, and it is never occluded.
 *
 * What that costs is stated rather than hidden: a shape does not FOLLOW the ground. Over a hill its line
 * still runs where the operator put it, and the distance it reports is the ground distance between two
 * points, not the length of the drive between them. Both are in
 * [`docs/edge-cases/dispatch-console.md`](../../../../docs/edge-cases/dispatch-console.md), and the
 * classification pass stays available for the day an annotation must read as paint.
 *
 * **Every number here is a plain planar measure in GTA units**, which are metres in San Andreas: a polyline
 * sums its segments, a polygon takes the shoelace area, a circle takes its radius from the second tap. No
 * projection, no datum, no curvature — the world is flat and 6 km across, and pretending otherwise would be
 * borrowing precision from a problem we do not have.
 */
import type { GtaGround } from './coords';

import { gtaDistance } from './coords';

/** What a tap on the map does. `none` is the console's normal behaviour: taps select. */
export type MapTool = 'none' | SketchKind;

/** What the operator gets back for what they drew. Every field is world units (metres) or their square. */
export interface Measurement {
  /** Enclosed area — an `area` polygon and a `circle`. */
  readonly area?: number;
  readonly kind: SketchKind;
  /** Along the line for a `ruler`, around the edge for an `area`, the circumference for a `circle`. */
  readonly length: number;
  /** A `circle` only. */
  readonly radius?: number;
}

/** One finished or in-progress sketch. `points` is the tap order; a circle is exactly centre then edge. */
export interface Sketch {
  readonly id: string;
  readonly kind: SketchKind;
  readonly points: readonly GtaGround[];
}

export type SketchKind = 'area' | 'circle' | 'ruler';

/**
 * The sketches a session has drawn, and the one being drawn. Owned by the map (not by React and not by the
 * board): it is view state, it is read inside the frame loop, and a re-render must never be able to lose it.
 */
export class SketchStore {
  private changes = 0;
  private current: MapTool = 'none';
  private drawing: GtaGround[] = [];
  private readonly finished: Sketch[] = [];
  private next = 0;

  /**
   * Take a tap. A circle finishes itself on the second point — there is nothing more to say about it — and
   * everything else grows until the operator says it is done.
   */
  addPoint(at: GtaGround): void {
    if (this.current === 'none') {
      return;
    }
    this.drawing.push(at);
    this.changes += 1;
    if (this.current === 'circle' && this.drawing.length === 2) {
      this.finish();
    }
  }

  /** Drop everything drawn this session, in progress included. */
  clear(): void {
    this.finished.length = 0;
    this.drawing = [];
    this.changes += 1;
  }

  /** Close the shape in progress, if it has enough points to mean anything. */
  finish(): void {
    if (this.current === 'none' || this.drawing.length < minimumPoints(this.current)) {
      return;
    }
    this.finished.push({ id: `s${String((this.next += 1))}`, kind: this.current, points: this.drawing });
    this.drawing = [];
    this.changes += 1;
  }

  /**
   * What the operator is being told right now: the shape in progress while there is one, else the last one
   * they finished. Null when nothing has been drawn — the panel then shows the tool's own hint instead.
   */
  measurement(): Measurement | null {
    const pending = this.pending();
    if (pending !== null) {
      return measure(pending);
    }
    const last = this.finished[this.finished.length - 1];

    return last === undefined ? null : measure(last);
  }

  /** The shape being drawn, or null. A single tap is already a shape — it just measures zero. */
  pending(): null | Sketch {
    return this.current === 'none' || this.drawing.length === 0
      ? null
      : { id: 'pending', kind: this.current, points: this.drawing };
  }

  /** Bumped by every mutation — what the render gate compares, since a tap changes the picture (201/4-01). */
  revision(): number {
    return this.changes;
  }

  /** Switch tools. The shape in progress is closed if it can be, and dropped if it cannot. */
  setTool(tool: MapTool): void {
    this.finish();
    this.drawing = [];
    this.current = tool;
    this.changes += 1;
  }

  /** Everything finished, oldest first — the draw order, so a later cordon sits over an earlier one. */
  shapes(): readonly Sketch[] {
    return this.finished;
  }

  tool(): MapTool {
    return this.current;
  }

  /** Step back one tap, then one whole shape — the only undo an operator drawing with a finger needs. */
  undo(): void {
    this.changes += 1;
    if (this.drawing.length > 0) {
      this.drawing.pop();

      return;
    }
    this.finished.pop();
  }
}

/** One shape's label: what it measures, in the words the panel uses. */
export function describeMeasurement(measurement: Measurement): string {
  if (measurement.kind === 'circle') {
    return `r ${formatLength(measurement.radius ?? 0)} · ${formatArea(measurement.area ?? 0)}`;
  }

  return measurement.kind === 'area'
    ? `${formatArea(measurement.area ?? 0)} · ${formatLength(measurement.length)}`
    : formatLength(measurement.length);
}

/**
 * Paint every sketch onto the overlay, with the one in progress dashed and labelled live.
 *
 * The ink is deliberately NOT a status colour: green, amber, blue and red all mean something on this screen
 * already (`SET_COLORS`), and a cordon drawn in one of them would read as a claim about a unit. A sketch is
 * the operator's own mark, so it wears the text colour with a dark halo — legible over road, roof and water
 * without competing with anything that carries data.
 */
export function drawSketches(
  ctx: CanvasRenderingContext2D,
  project: (at: GtaGround) => null | { readonly x: number; readonly y: number },
  store: SketchStore,
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  for (const shape of store.shapes()) {
    paint(ctx, project, shape, false);
  }
  const pending = store.pending();
  if (pending !== null) {
    paint(ctx, project, pending, true);
  }
  ctx.restore();
}

export function formatArea(squareMetres: number): string {
  return squareMetres >= 1_000_000
    ? `${(squareMetres / 1_000_000).toFixed(2)} km²`
    : `${Math.round(squareMetres).toLocaleString('en-GB')} m²`;
}

/** Metres and square metres as an operator reads them: metres up to a kilometre, kilometres past it. */
export function formatLength(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

/** One shape's numbers. A shape with too few points measures zero rather than refusing to answer. */
export function measure(sketch: Sketch): Measurement {
  if (sketch.kind === 'circle') {
    const radius = sketch.points.length < 2 ? 0 : gtaDistance(sketch.points[0], sketch.points[1]);

    return { area: Math.PI * radius * radius, kind: 'circle', length: 2 * Math.PI * radius, radius };
  }
  const closed = sketch.kind === 'area';

  return closed
    ? { area: polygonArea(sketch.points), kind: 'area', length: polylineLength(sketch.points, true) }
    : { kind: 'ruler', length: polylineLength(sketch.points, false) };
}

/** Shoelace area of a ring of GTA points, always positive — winding is the operator's, not a meaning. */
export function polygonArea(points: readonly GtaGround[]): number {
  if (points.length < 3) {
    return 0;
  }
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }

  return Math.abs(twice) / 2;
}

/** Ground distance along a polyline; `closed` adds the segment back to the first point. */
export function polylineLength(points: readonly GtaGround[], closed: boolean): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += gtaDistance(points[i - 1], points[i]);
  }

  return closed && points.length > 2 ? total + gtaDistance(points[points.length - 1], points[0]) : total;
}

const SKETCH_INK = 'rgba(232, 238, 246, 0.92)';
const SKETCH_HALO = 'rgba(5, 8, 12, 0.75)';
const SKETCH_FILL = 'rgba(232, 238, 246, 0.10)';
const SKETCH_FONT = '600 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
/** Vertex handle radius, CSS px — big enough to see where a tap landed, small enough not to hide it. */
const VERTEX = 2.5;

function label(ctx: CanvasRenderingContext2D, at: { readonly x: number; readonly y: number }, text: string): void {
  ctx.font = SKETCH_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width + 12;
  ctx.fillStyle = SKETCH_HALO;
  ctx.fillRect(at.x - width / 2, at.y - 26, width, 16);
  ctx.fillStyle = SKETCH_INK;
  ctx.fillText(text, at.x, at.y - 18);
}

/** Below this a shape is not yet a shape: a line needs two ends, a polygon needs a triangle. */
function minimumPoints(kind: SketchKind): number {
  return kind === 'area' ? 3 : 2;
}

/** One shape, painted. A shape whose points are all behind the eye simply does not draw. */
function paint(
  ctx: CanvasRenderingContext2D,
  project: (at: GtaGround) => null | { readonly x: number; readonly y: number },
  shape: Sketch,
  pending: boolean,
): void {
  const screen = shape.points.map(project);
  if (screen.some((point) => point === null)) {
    return; // partly behind the eye: a line to a point that is not there would run across the whole screen
  }
  const points = screen as { readonly x: number; readonly y: number }[];
  ctx.setLineDash(pending ? [5, 4] : []);
  if (shape.kind === 'circle') {
    paintCircle(ctx, points);
  } else {
    paintPath(ctx, points, shape.kind === 'area');
  }
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, VERTEX, 0, Math.PI * 2);
    ctx.fillStyle = SKETCH_INK;
    ctx.fill();
  }
  ctx.setLineDash([]);
  label(ctx, points[points.length - 1], describeMeasurement(measure(shape)));
}

function paintCircle(
  ctx: CanvasRenderingContext2D,
  points: readonly { readonly x: number; readonly y: number }[],
): void {
  if (points.length < 2) {
    return;
  }
  const radius = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  ctx.beginPath();
  ctx.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2);
  ctx.fillStyle = SKETCH_FILL;
  ctx.fill();
  stroke(ctx);
}

function paintPath(
  ctx: CanvasRenderingContext2D,
  points: readonly { readonly x: number; readonly y: number }[],
  closed: boolean,
): void {
  ctx.beginPath();
  for (const [index, point] of points.entries()) {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  if (closed && points.length > 2) {
    ctx.closePath();
    ctx.fillStyle = SKETCH_FILL;
    ctx.fill();
  }
  stroke(ctx);
}

/** The halo first, then the line — one stroke over a dark one is what keeps a thin line legible on a road. */
function stroke(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = SKETCH_HALO;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.strokeStyle = SKETCH_INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
