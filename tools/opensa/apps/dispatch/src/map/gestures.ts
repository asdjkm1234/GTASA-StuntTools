/**
 * Pointer input for the map, mouse and touch through one set of handlers.
 *
 * Touch is not "mouse without a right button" — three of the desk's five gestures have no touch equivalent at
 * all (there is no wheel, no second button and no hover), so they are re-cast the way every map application
 * casts them: one finger pans, two fingers pinch to zoom and drag to orbit, and a long press stands in for the
 * right click. Everything is Pointer Events, so a stylus and a trackpad fall out for free.
 *
 * The canvas must carry `touch-action: none`, or the browser claims the drag for scrolling before a single
 * `pointermove` is delivered.
 */

/** What a gesture does. The host binds these to the camera and to its own click resolution. */
export interface GestureTarget {
  /** One wheel notch (±1). */
  dolly: (notch: number) => void;
  /** "Open something here" — right click, or a touch long press. */
  longPress: (x: number, y: number) => void;
  /** Turn and tilt, in pixels of travel. */
  orbit: (dxPixels: number, dyPixels: number) => void;
  /** Slide the view, in NDC deltas. */
  pan: (ndcDelta: readonly [number, number]) => void;
  /** A press that did not travel — select what is under it. CSS pixels, canvas-relative. */
  tap: (x: number, y: number) => void;
  /** Continuous zoom: multiply the view distance. <1 moves closer. */
  zoomBy: (factor: number) => void;
}

/** Pixels of travel a press may accumulate and still count as a tap rather than a drag. */
const SLOP = 6;
/** How long a still finger has to rest before it counts as a long press. */
const LONG_PRESS_MS = 550;

export function bindGestures(canvas: HTMLCanvasElement, target: GestureTarget): () => void {
  const active = new Map<number, { x: number; y: number }>();
  let travel = 0;
  /** The two-finger state carried between moves: null whenever fewer than two fingers are down. */
  let pinch: null | { distance: number; midX: number; midY: number } = null;
  let longPressTimer: null | number = null;

  const cancelLongPress = (): void => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const local = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();

    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onContextMenu = (event: Event): void => event.preventDefault();

  const onPointerDown = (event: PointerEvent): void => {
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    if (active.size === 1) {
      travel = 0;
      if (event.pointerType === 'touch') {
        const at = local(event);
        longPressTimer = window.setTimeout(() => {
          longPressTimer = null;
          travel = Number.POSITIVE_INFINITY; // consumed: the lift must not also fire a tap
          target.longPress(at.x, at.y);
        }, LONG_PRESS_MS);
      }
    } else {
      // A second finger ends any press-and-hold and starts the pinch fresh.
      cancelLongPress();
      pinch = null;
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    const previous = active.get(event.pointerId);
    if (!previous) {
      return;
    }
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });
    travel += Math.abs(dx) + Math.abs(dy);
    if (travel > SLOP) {
      cancelLongPress();
    }

    if (active.size >= 2) {
      applyPinch();

      return;
    }
    if (event.pointerType !== 'touch' && event.buttons === 0) {
      return; // a mouse moving with nothing held is hover, not a drag
    }
    if (event.pointerType !== 'touch' && (event.buttons & 2) !== 0) {
      target.orbit(dx, dy);

      return;
    }
    target.pan([(2 * dx) / canvas.clientWidth, (-2 * dy) / canvas.clientHeight]);
  };

  /** Two fingers: the distance between them zooms, their midpoint orbits — the map-app convention. */
  const applyPinch = (): void => {
    const [a, b] = [...active.values()];
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (pinch && pinch.distance > 0 && distance > 0) {
      target.zoomBy(pinch.distance / distance);
      target.orbit(midX - pinch.midX, midY - pinch.midY);
    }
    pinch = { distance, midX, midY };
  };

  const onPointerUp = (event: PointerEvent): void => {
    cancelLongPress();
    const wasSingle = active.size === 1;
    active.delete(event.pointerId);
    if (active.size < 2) {
      pinch = null;
    }
    canvas.releasePointerCapture(event.pointerId);
    // Only a lone press that never travelled is a tap. Lifting one finger of a pinch is not a selection.
    if (wasSingle && travel <= SLOP) {
      const at = local(event);
      if (event.pointerType === 'touch' || event.button === 0) {
        target.tap(at.x, at.y);
      } else if (event.button === 2) {
        target.longPress(at.x, at.y);
      }
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    target.dolly(Math.sign(event.deltaY));
  };

  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return (): void => {
    cancelLongPress();
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
  };
}
