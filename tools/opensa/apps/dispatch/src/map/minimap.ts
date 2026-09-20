import type { Operations, Selection } from '../ops/types';
/**
 * The radar (201/7-04): where the view is, relative to the whole world — and where everyone else is.
 *
 * **Round, on the user's call (2026-08-22), and the shape is not decoration.** A dispatch radar answers a
 * distance question — *how far off is my nearest available unit* — and a circle is the only frame in which
 * a pixel of travel means the same thing in every direction. A rectangle answers it differently along the
 * diagonal than along the edge, which is exactly the error an operator makes when they pick a unit off it.
 * It is also the shape San Andreas' own radar is, which costs nothing and is what a player expects.
 *
 * **It is drawn from data the console already has, not rendered a second time.** The step's own plan called
 * for the flat-2D tiles of [6/02](../../../../docs/plans/201-dispatch-console/6-display-modes/readme.md) at
 * their lowest zoom — which do not exist yet, and would be a raster for a picture that has no raster to
 * show. What this draws instead is the world's OWN description of itself: the baked district boxes (the
 * city's shape, 201/5-03's table), the board's units and calls, and the camera's ground footprint. That
 * makes it work on a total conversion the day it is built, and in every display mode including the
 * no-GPU plan view, which [chain 7's verification](../../../../docs/plans/201-dispatch-console/7-the-operator-map/readme.md)
 * requires of everything here.
 *
 * **North-up, always.** The world is fixed and the FOOTPRINT turns inside it, so a glance answers both
 * questions at once — where the view is, and which way it faces — without the operator having to re-learn
 * the city's shape every time they turn. Heading is the compass's job (7/06).
 *
 * **It repaints only when something it draws has changed** — the board tick (20 Hz), the pose, the
 * selection, or its own size. At 60 fps over a still map that is 20 repaints a second instead of 60, and
 * over an idle console it is none, which is what [chain 4](../../../../docs/plans/201-dispatch-console/4-a-console-is-not-a-game/readme.md)
 * will need of it rather than something to retrofit later.
 */
import type { MapPose } from './map-camera';

import { SET_COLORS } from './beacons';
import { type GtaGround } from './coords';
import { css } from './overlay-2d';

/** A district's GTA box, as the baked table states it. */
export interface MinimapBox {
  readonly max: readonly [number, number];
  readonly min: readonly [number, number];
}

/** Everything one repaint reads. Same object in, same pixels out — which is what the dirty check leans on. */
export interface MinimapFrame {
  /** The view's ground footprint, GTA, from {@link MapCamera.groundFootprint}. */
  readonly footprint: readonly (readonly [number, number])[];
  readonly ops: Operations;
  readonly pose: MapPose;
  readonly selection: Selection;
  /** The canvas' CSS size — square; the dial fills it. */
  readonly size: number;
  readonly world: MinimapWorld;
}

/** What the radar frames: the world's own extent, and the shape it draws inside it. */
export interface MinimapWorld {
  /** The city's outline — baked district boxes. Empty on a world that ships no `info.zon`. */
  readonly boxes: readonly MinimapBox[];
  /** Centre of everything the pak carries, GTA. */
  readonly centre: GtaGround;
  /** Half-extent of the same, world units — the radar's scale, derived rather than chosen. */
  readonly radius: number;
}

/** Ink for the parts that are not data: the dial, its ring, the outline, the north tick. */
const DIAL_FILL = 'rgba(7, 11, 17, 0.86)';
const DIAL_RING = 'rgba(56, 189, 248, 0.55)';
const OUTLINE = 'rgba(123, 138, 156, 0.42)';
const FOOTPRINT_FILL = 'rgba(56, 189, 248, 0.16)';
const FOOTPRINT_EDGE = 'rgba(56, 189, 248, 0.75)';
const NORTH_INK = 'rgba(232, 238, 246, 0.75)';
/** Inset from the canvas edge, CSS px — the ring needs a pixel of room and the north tick sits in it. */
const PADDING = 9;
/** Marker radii, CSS px. A unit has to be findable at 108 px and must not swallow its neighbour. */
const UNIT_DOT = 2.4;
const CALL_DOT = 2.8;

/** The half of {@link MapCamera} the radar reads — stated so the mount can be driven by a stub in a test. */
export interface MinimapCamera {
  groundFootprint(aspect: number): [number, number][];
  pose(): MapPose;
}

/** What the loop holds: one call a frame that usually does nothing, and the listener's undo. */
export interface MountedMinimap {
  dispose(): void;
  draw(ops: Operations, selection: Selection, camera: MinimapCamera, aspect: number): void;
}

export class MinimapLayer {
  /** The frame the last repaint drew, for the dirty check. Null until the first one. */
  private last: MinimapFrame | null = null;

  /**
   * The GTA point under a click on the dial, or null outside the circle — the operator's "take me there".
   * Answered against the frame that was last DRAWN, so a click resolves against the pixels they aimed at.
   */
  hitTest(x: number, y: number): GtaGround | null {
    if (this.last === null) {
      return null;
    }
    const { size, world } = this.last;
    const centre = size / 2;
    const radius = centre - PADDING;
    const dx = x - centre;
    const dy = y - centre;
    if (Math.hypot(dx, dy) > radius) {
      return null;
    }
    const perUnit = radius / world.radius;

    return [world.centre[0] + dx / perUnit, world.centre[1] - dy / perUnit];
  }

  /** One repaint, or none when nothing it draws has moved. Answers whether it touched the canvas. */
  render(ctx: CanvasRenderingContext2D, frame: MinimapFrame): boolean {
    if (!changed(this.last, frame)) {
      return false;
    }
    this.last = frame;
    const centre = frame.size / 2;
    const radius = centre - PADDING;
    const perUnit = radius / Math.max(1, frame.world.radius);
    const toDial = (at: GtaGround): [number, number] => [
      centre + (at[0] - frame.world.centre[0]) * perUnit,
      centre - (at[1] - frame.world.centre[1]) * perUnit,
    ];

    ctx.clearRect(0, 0, frame.size, frame.size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(centre, centre, radius, 0, Math.PI * 2);
    ctx.fillStyle = DIAL_FILL;
    ctx.fill();
    ctx.clip(); // everything below is the world, and the world stops at the dial's edge
    drawOutline(ctx, frame.world.boxes, toDial);
    drawFootprint(ctx, frame.footprint, toDial);
    drawIncidents(ctx, frame, toDial);
    drawUnits(ctx, frame, toDial);
    ctx.restore();
    drawRing(ctx, centre, radius);

    return true;
  }
}

/**
 * The DOM half: a canvas that sizes itself, a click that becomes a flight, and a draw call the loop makes
 * every frame and which usually does nothing. Kept apart from {@link MinimapLayer} so the drawing is
 * testable without a document, which is the only way this repo can test a canvas at all.
 */
export function mountMinimap(
  canvas: HTMLCanvasElement,
  world: MinimapWorld,
  onPick: (at: GtaGround) => void,
  dpr: number,
): MountedMinimap {
  const ctx = canvas.getContext('2d');
  const layer = new MinimapLayer();
  let size = 0;
  const pick = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const at = layer.hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (at !== null) {
      onPick(at);
    }
  };
  canvas.addEventListener('pointerdown', pick);

  return {
    dispose: (): void => canvas.removeEventListener('pointerdown', pick),
    draw: (ops, selection, camera, aspect): void => {
      if (!ctx) {
        return;
      }
      const css = canvas.clientWidth;
      if (css === 0) {
        return; // hidden (a compact layout may drop the inset) — nothing to draw and nothing to size
      }
      if (css !== size) {
        size = css;
        canvas.width = Math.max(2, Math.floor(css * dpr));
        canvas.height = canvas.width;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      layer.render(ctx, {
        footprint: camera.groundFootprint(aspect),
        ops,
        pose: camera.pose(),
        selection,
        size,
        world,
      });
    },
  };
}

/** Has anything the radar draws moved? Object identity for the board — it is replaced whole per tick. */
function changed(last: MinimapFrame | null, next: MinimapFrame): boolean {
  return (
    last === null ||
    last.ops !== next.ops ||
    last.selection !== next.selection ||
    last.size !== next.size ||
    last.world !== next.world ||
    last.pose.at[0] !== next.pose.at[0] ||
    last.pose.at[1] !== next.pose.at[1] ||
    last.pose.yaw !== next.pose.yaw ||
    last.pose.pitch !== next.pose.pitch ||
    last.pose.height !== next.pose.height
  );
}

function drawFootprint(
  ctx: CanvasRenderingContext2D,
  footprint: readonly (readonly [number, number])[],
  toDial: (at: GtaGround) => [number, number],
): void {
  if (footprint.length < 3) {
    return;
  }
  ctx.beginPath();
  for (const [index, corner] of footprint.entries()) {
    const [x, y] = toDial(corner);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = FOOTPRINT_FILL;
  ctx.fill();
  ctx.strokeStyle = FOOTPRINT_EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawIncidents(
  ctx: CanvasRenderingContext2D,
  frame: MinimapFrame,
  toDial: (at: GtaGround) => [number, number],
): void {
  for (const incident of frame.ops.incidents) {
    if (incident.status === 'closed') {
      continue; // a closed call is history; the radar carries what is still work
    }
    const [x, y] = toDial(incident.at);
    const selected = frame.selection?.kind === 'incident' && frame.selection.id === incident.id;
    // A diamond, so a call is not a unit at a glance — shape carries the kind, colour carries the priority.
    ctx.beginPath();
    ctx.moveTo(x, y - CALL_DOT);
    ctx.lineTo(x + CALL_DOT, y);
    ctx.lineTo(x, y + CALL_DOT);
    ctx.lineTo(x - CALL_DOT, y);
    ctx.closePath();
    ctx.fillStyle = css(SET_COLORS[`call${incident.priority}`]);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

/** The district boxes, thin and dim: this is the ground everything else is read against, never the subject. */
function drawOutline(
  ctx: CanvasRenderingContext2D,
  boxes: readonly MinimapBox[],
  toDial: (at: GtaGround) => [number, number],
): void {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (const box of boxes) {
    const [x0, y0] = toDial([box.min[0], box.min[1]]);
    const [x1, y1] = toDial([box.max[0], box.max[1]]);
    ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
  ctx.stroke();
}

/** The dial's edge and its north tick — drawn OUTSIDE the clip, so the ring is a full circle. */
function drawRing(ctx: CanvasRenderingContext2D, centre: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.strokeStyle = DIAL_RING;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centre, centre - radius - 1);
  ctx.lineTo(centre, centre - radius - 5);
  ctx.strokeStyle = NORTH_INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawUnits(
  ctx: CanvasRenderingContext2D,
  frame: MinimapFrame,
  toDial: (at: GtaGround) => [number, number],
): void {
  for (const unit of frame.ops.units) {
    const [x, y] = toDial(unit.at);
    ctx.beginPath();
    ctx.arc(x, y, UNIT_DOT, 0, Math.PI * 2);
    ctx.fillStyle = css(SET_COLORS[unit.status]);
    ctx.fill();
    if (frame.selection?.kind === 'unit' && frame.selection.id === unit.id) {
      ctx.beginPath();
      ctx.arc(x, y, UNIT_DOT + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}
