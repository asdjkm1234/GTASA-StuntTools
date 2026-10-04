/**
 * A panel that floats over the map, and that the operator can move and size.
 *
 * The layout argument is [201/7-08](../../../../docs/plans/201-dispatch-console/7-the-operator-map/readme.md):
 * every console in this field — SnailyCAD, SonoranCAD, Resgrid, CrowdCAD — keeps its map somewhere other
 * than the main screen, so a map-first console has no pattern to copy and has to earn its own. Windows over
 * the world are how it earns it: the map keeps the whole viewport, and the lists sit on top of it where the
 * operator put them.
 *
 * **Pointer Events rather than a library.** `react-rnd`, `react-draggable` and GridStack all do this, and
 * all three are the wrong shape here. GridStack is a GRID: tiles snap to columns and reflow, which takes
 * space away from the map in exactly the way this step exists to stop. The other two would be the app's
 * first runtime dependencies, in a package that ships as an embeddable widget (`vite.lib.config.ts`,
 * `embed.ts`) with none — and their touch stories are an afterthought, on a console whose primary device is
 * a phone. Pointer Events unify mouse, pen and touch in one handler, and the whole gesture is the sixty
 * lines below.
 */
import { type CSSProperties, type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import type { WindowBox, WindowRect } from './window-frame';

import { styles } from './styles';
import { clampWindow, KEY_STEP, loadWindowLayout, moveWindow, resizeWindow, saveWindowRect } from './window-frame';

/** What a drag started from, so every move is measured against the rect at pointer-down rather than the last frame. */
interface DragOrigin {
  readonly pointer: number;
  readonly px: number;
  readonly py: number;
  readonly rect: WindowRect;
}

export function PanelWindow({
  anchorRight = false,
  children,
  defaultRect,
  id,
  onFocus,
  title,
  touch,
  trailing,
  z,
}: {
  /** Measure `defaultRect.x` from the map's right edge rather than its left. */
  anchorRight?: boolean;
  children: ReactNode;
  /**
   * Where the window opens the first time, before the operator has moved it. With `anchorRight`, `x` is
   * the gap from the map's RIGHT edge instead of its left — which cannot be a fixed number, because the
   * map's width is not known until it has laid out.
   */
  defaultRect: WindowRect;
  /** Stable across releases — it is the storage key for this window's rect. */
  id: string;
  /** Raise this window above the other one. */
  onFocus: () => void;
  title: string;
  touch: boolean;
  /** Rendered at the right end of the title bar — the status tally. */
  trailing?: ReactNode;
  z: number;
}): ReactElement {
  const frameRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<null | WindowBox>(null);
  const [rect, setRect] = useState<null | WindowRect>(() => loadWindowLayout()[id] ?? null);
  const dragRef = useRef<DragOrigin | null>(null);
  const gripRef = useRef<DragOrigin | null>(null);

  // The map is the coordinate space, so the box is the map's size — and it changes on rotate, on a window
  // resize and when the phone's URL bar collapses. A window that was legal at 1280 px must not be left
  // hanging outside a 360-px map, so every change re-clamps rather than only the first one.
  useEffect(() => {
    const parent = frameRef.current?.offsetParent;
    if (!(parent instanceof HTMLElement)) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const next = { h: parent.clientHeight, w: parent.clientWidth };
      setBox(next);
      setRect((current) =>
        clampWindow(
          current ?? { ...defaultRect, x: anchorRight ? next.w - defaultRect.w - defaultRect.x : defaultRect.x },
          next,
        ),
      );
    });
    observer.observe(parent);

    return (): void => observer.disconnect();
  }, [anchorRight, defaultRect]);

  /** Commit a rect and remember it. Called at the END of a gesture, not on every move: a write per pointer
   *  event is a `JSON.stringify` of the whole layout per frame, and nothing reads it until the next boot. */
  const commit = useCallback(
    (next: WindowRect) => {
      setRect(next);
      saveWindowRect(id, next);
    },
    [id],
  );

  const onPointerDown = (origin: typeof dragRef, event: React.PointerEvent<HTMLElement>): void => {
    // Left button and touch only: a right-click on the title bar is a context menu, not a drag that never
    // ends because no `pointerup` follows.
    if (event.button !== 0 || !box || !rect) {
      return;
    }
    onFocus();
    origin.current = { pointer: event.pointerId, px: event.clientX, py: event.clientY, rect };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    if (!box) {
      return;
    }
    const moving = dragRef.current;
    const sizing = gripRef.current;
    if (moving?.pointer === event.pointerId) {
      setRect(moveWindow(moving.rect, event.clientX - moving.px, event.clientY - moving.py, box));
    } else if (sizing?.pointer === event.pointerId) {
      setRect(resizeWindow(sizing.rect, event.clientX - sizing.px, event.clientY - sizing.py, box));
    }
  };

  /** `pointerup` AND `pointercancel`: a touch that the browser takes back — a system gesture, a call
   *  arriving — fires only the second, and a drag that never ends leaves the window stuck to the finger. */
  const onPointerEnd = (origin: typeof dragRef, event: React.PointerEvent<HTMLElement>): void => {
    if (origin.current?.pointer !== event.pointerId || !rect) {
      return;
    }
    origin.current = null;
    commit(rect);
  };

  /** Arrows move, Shift+arrows size. The only way to arrange the board with no pointer at all (201/7-06). */
  const onKeyDown = (sizing: boolean, event: React.KeyboardEvent<HTMLElement>): void => {
    if (!box || !rect) {
      return;
    }
    const step = event.shiftKey ? KEY_STEP * 3 : KEY_STEP;
    const delta = DELTAS[event.key];
    if (!delta) {
      return;
    }
    event.preventDefault();
    commit(
      sizing
        ? resizeWindow(rect, delta.x * step, delta.y * step, box)
        : moveWindow(rect, delta.x * step, delta.y * step, box),
    );
  };

  // The first paint happens before `ResizeObserver` has answered, and a right-anchored window would flash
  // at the LEFT edge for that frame. An absent window for one frame is the smaller lie.
  if (!rect) {
    return <div ref={frameRef} style={styles.windowPending} />;
  }

  const frame: CSSProperties = {
    ...styles.windowFrame,
    height: rect.h,
    left: rect.x,
    top: rect.y,
    width: rect.w,
    zIndex: z,
  };

  return (
    <div ref={frameRef} style={frame}>
      <button
        onKeyDown={(event) => onKeyDown(false, event)}
        onPointerCancel={(event) => onPointerEnd(dragRef, event)}
        onPointerDown={(event) => onPointerDown(dragRef, event)}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(dragRef, event)}
        style={touch ? styles.windowHeaderTouch : styles.windowHeader}
        title="Drag to move · arrows move · shift+arrows resize"
        type="button"
      >
        <span>{title}</span>
        {trailing}
      </button>
      <div style={styles.windowBody}>{children}</div>
      <button
        aria-label={`Resize ${title}`}
        onKeyDown={(event) => onKeyDown(true, event)}
        onPointerCancel={(event) => onPointerEnd(gripRef, event)}
        onPointerDown={(event) => onPointerDown(gripRef, event)}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(gripRef, event)}
        style={touch ? styles.windowGripTouch : styles.windowGrip}
        title="Drag to resize · arrows resize"
        type="button"
      >
        <Grip />
      </button>
    </div>
  );
}

const DELTAS: Readonly<Record<string, undefined | { x: number; y: number }>> = {
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
};

/** Three lines in the corner — the shape every OS uses for this, so it needs no label to be understood. */
function Grip(): ReactElement {
  return (
    <svg aria-hidden="true" height="100%" preserveAspectRatio="xMaxYMax meet" viewBox="0 0 12 12" width="100%">
      <path d="M11 4 4 11M11 7.5 7.5 11" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" />
    </svg>
  );
}
