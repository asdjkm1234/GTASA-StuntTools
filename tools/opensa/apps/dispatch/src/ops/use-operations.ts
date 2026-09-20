/**
 * The board, as React owns it. The simulation ticks here; the map loop reads the same snapshot through the
 * stable getters in `read`, so the 60 fps loop never subscribes to React and React never re-renders per frame.
 *
 * Since 201/8-03 there are TWO boards in here and only one of them leaves: `live` is what the feed is doing
 * right now and what the history records, and `ops` is the board AT THE CLOCK — the same object while live,
 * and the reconstructed past while the operator is scrubbing. Everything downstream takes `ops` and cannot
 * tell which it was handed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GtaGround } from '../map/coords';
import type { Clock, PlaybackRate } from './clock';
import type { HistoryStats } from './history';
import type { Operations, Selection } from './types';

import { dispatchParams } from '../world/boot';
import { seedSize } from './budget';
import { addBookmark, advance, createClock, goLive, removeBookmark, scrubTo, setRate } from './clock';
import { BoardHistory } from './history';
import { initialOperations } from './seed';
import { assignUnit, clearUnit, createIncidentAt, stepOperations } from './sim';

/** Simulation tick. 20 Hz is smooth on the map and cheap for the panels; the render loop is independent. */
const TICK_MS = 50;

export interface DispatchActions {
  assign: (unitId: string, incidentId: string) => void;
  /** Mark the moment on screen so it can be returned to (201/8-03). */
  bookmark: (label: string) => void;
  clear: (unitId: string) => void;
  /** Open a call at a point. `district` is the world's own name for it (201/5-03), or null when the world
   *  ships none — the board then falls back to its landmark table. */
  createAt: (at: GtaGround, district?: null | string) => void;
  /** Back to following the wall clock. */
  live: () => void;
  removeBookmark: (t: number) => void;
  /** Drag the shift clock to a moment. Enters replay. */
  scrub: (t: number) => void;
  select: (selection: Selection) => void;
  setAutoDispatch: (enabled: boolean) => void;
  setRate: (rate: PlaybackRate) => void;
}

export interface DispatchStore {
  readonly actions: DispatchActions;
  readonly autoDispatch: boolean;
  readonly clock: Clock;
  /** The span a scrub may ask for, or null before anything was recorded. */
  readonly historyWindow: null | { newest: number; oldest: number };
  /** The board AT THE CLOCK — live while live, the reconstructed one while replaying. Nothing downstream
   *  knows the difference, which is the whole shape of 201/8-03. */
  readonly ops: Operations;
  /** Stable getters for the render loop — identity never changes, so the host binds them once. */
  readonly read: {
    /** How old each unit's last fix is, ms (201/8-02). Same rate and same source as {@link trails}. */
    fixAges: () => ReadonlyMap<string, number>;
    ops: () => Operations;
    selection: () => Selection;
    trackStats: () => HistoryStats;
    /** Each unit's current leg, GTA `x, y` pairs (201/8-04). Resolved at the board's tick, not the frame's. */
    trails: () => ReadonlyMap<string, Float32Array>;
  };
  readonly selection: Selection;
}

export function useOperations(): DispatchStore {
  // `?units=150&calls=40` opens the board at the declared worst case — the load 201/5-02's numbers are
  // taken at. Read once, in the initializer, so a re-render never reseeds the shift.
  const [live, setLive] = useState<Operations>(() => initialOperations(performance.now(), seedSize(dispatchParams())));
  const [selection, setSelection] = useState<Selection>(null);
  const [autoDispatch, setAutoDispatch] = useState(true);
  const [clock, setClock] = useState<Clock>(() => createClock(performance.now()));

  // The time axis, owned beside the board rather than inside it: `Operations` is an immutable snapshot and
  // a ring buffer cannot be (see `tracks.ts`). One writer — the tick below.
  const historyRef = useRef<BoardHistory | null>(null);
  historyRef.current ??= new BoardHistory();
  const history = historyRef.current;

  // The board AT THE CLOCK. While live this IS the live board; while replaying it is the reconstructed one,
  // and every consumer below is handed it without knowing which — the whole substitution 8/03 is built on.
  const ops = useMemo(
    () => (clock.mode === 'live' ? live : history.at(clock.t, live)),
    [clock.mode, clock.t, history, live],
  );
  const historyWindow = history.window();
  // Resolved at the board's rate rather than the frame's: a trail only changes when a sample lands or the
  // clock moves, and the map redraws from the same object in between.
  const trails = useMemo(() => history.trails(ops.now), [history, ops]);
  const fixAges = useMemo(() => history.fixAges(ops.now), [history, ops]);

  const opsRef = useRef(ops);
  const trailsRef = useRef(trails);
  const fixAgesRef = useRef(fixAges);
  const liveRef = useRef(live);
  const selectionRef = useRef(selection);
  const autoRef = useRef(autoDispatch);
  opsRef.current = ops;
  trailsRef.current = trails;
  fixAgesRef.current = fixAges;
  liveRef.current = live;
  selectionRef.current = selection;
  autoRef.current = autoDispatch;

  useEffect(() => {
    const timer = window.setInterval(() => {
      // The time axis (201/8-01) observes the board OUTSIDE the state updater. A side effect inside one is
      // run twice by StrictMode and again by any React retry, and a track written twice is a track that
      // cannot be scrubbed. What it reads is the snapshot React last rendered — one tick behind, which for
      // an observation at 20 Hz against a 4 s sampling policy is nothing.
      // ALWAYS the live board, never the replayed one: recording what a scrub is showing would write the
      // past back into the history as if it had just happened.
      history.record(liveRef.current);
      setLive((previous) =>
        stepOperations(previous, {
          autoDispatch: autoRef.current,
          dtSeconds: TICK_MS / 1000,
          now: performance.now(),
          random: Math.random,
        }),
      );
      setClock((previous) => advance(previous, performance.now(), TICK_MS, history.window()));
    }, TICK_MS);

    return (): void => window.clearInterval(timer);
  }, [history]);

  const createAt = useCallback((at: GtaGround, district: null | string = null): void => {
    setLive((previous) => createIncidentAt(previous, at, performance.now(), Math.random, district));
  }, []);

  const actions = useMemo<DispatchActions>(
    () => ({
      assign: (unitId, incidentId): void => setLive((previous) => assignUnit(previous, unitId, incidentId)),
      bookmark: (label): void => setClock((previous) => addBookmark(previous, label)),
      clear: (unitId): void => setLive((previous) => clearUnit(previous, unitId)),
      createAt,
      live: (): void => setClock((previous) => goLive(previous, performance.now())),
      removeBookmark: (t): void => setClock((previous) => removeBookmark(previous, t)),
      scrub: (t): void => setClock((previous) => scrubTo(previous, t, history.window())),
      select: setSelection,
      setAutoDispatch,
      setRate: (rate): void => setClock((previous) => setRate(previous, rate, history.window())),
    }),
    [createAt, history],
  );

  const read = useMemo(
    () => ({
      fixAges: (): ReadonlyMap<string, number> => fixAgesRef.current,
      ops: (): Operations => opsRef.current,
      selection: (): Selection => selectionRef.current,
      trackStats: (): HistoryStats => history.stats(),
      trails: (): ReadonlyMap<string, Float32Array> => trailsRef.current,
    }),
    [history],
  );

  return { actions, autoDispatch, clock, historyWindow, ops, read, selection };
}
