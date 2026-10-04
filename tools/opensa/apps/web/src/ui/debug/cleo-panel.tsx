/**
 * The F2 CLEO tab (plan 097/07 decision 3): what the script VM is actually doing, while it does it.
 *
 * Four answers a field round needs without a decompiler: IS it on (both wheel reports began as
 * "cleo was just off"), WHAT runs (thread list with state/wait/cost), WHAT is missing (coverage:
 * unimplemented opcodes with their tier + unserved atlas rows), and WHAT HAPPENED (the per-thread
 * trace, readable as a story). Tracing is toggled here and costs nothing while off; the readout
 * poll runs only while the tab is open.
 */
import { type ReactElement, useEffect, useState } from 'react';

import { styles } from './debug-styles';

/** One unimplemented-opcode row, pre-labelled ("0AF0 READ_INT_FROM_INI_FILE"). */
export interface CleoCoverageRow {
  readonly count: number;
  readonly declared: boolean;
  readonly label: string;
  readonly tier: string;
}

/** One unserved atlas access, pre-labelled ("read vehicle+0x590 (size 4)"). */
export interface CleoMissRow {
  readonly declared: boolean;
  readonly label: string;
  readonly tier: string;
}

/** The slice of DebugActions this panel reads (kept narrow so the panel is reusable/testable). */
export interface CleoPanelActions {
  /** The live readout; null when the build carries no `cleo/*.cs` scripts at all. */
  cleoReadout?: () => CleoReadout | null;
  /** Dispatch ONE instruction on the named thread (works while the runner is disabled). */
  cleoStep?: (thread: string) => void;
  /** The trace ring's story — all threads, or one thread's lines only. */
  cleoTraceLines?: (thread?: string) => readonly string[];
  setCleoEnabled?: (enabled: boolean) => void;
  setCleoTracing?: (enabled: boolean) => void;
}

export interface CleoReadout {
  readonly coverage: readonly CleoCoverageRow[];
  readonly enabled: boolean;
  /** "thread: message" per killed thread. */
  readonly faults: readonly string[];
  readonly instructionsLastTick: number;
  readonly misses: readonly CleoMissRow[];
  readonly objects: number;
  readonly threads: readonly CleoThreadRow[];
  readonly tracing: boolean;
}

/** One thread-list row (already resolved by the host — the panel only formats). */
export interface CleoThreadRow {
  readonly instructions: number;
  readonly name: string;
  readonly state: 'done' | 'fault' | 'run' | 'sleep';
  readonly waitMs: number;
}

/** 4 Hz: the thread list and trace are read by humans, not graphed. */
const POLL_MS = 250;
/** Trace lines shown — the ring holds more; the tab shows the tail that fits. */
const TRACE_TAIL = 40;

export function CleoPanel({ actions }: { actions: CleoPanelActions }): ReactElement {
  // `undefined` = the first poll has not landed yet; `null` = polled, and the build has no scripts.
  const [readout, setReadout] = useState<CleoReadout | null | undefined>(undefined);
  const [selected, setSelected] = useState<null | string>(null);
  const [traceTail, setTraceTail] = useState<readonly string[]>([]);

  useEffect(() => {
    // Interval-only, like PhysicsPanel: the first readout lands one poll later, never mid-render.
    const timer = window.setInterval(() => {
      const next = actions.cleoReadout?.() ?? null;
      setReadout(next);
      if (next?.tracing) {
        const lines = actions.cleoTraceLines?.(selected ?? undefined) ?? [];
        setTraceTail(lines.slice(-TRACE_TAIL));
      }
    }, POLL_MS);

    return (): void => window.clearInterval(timer);
  }, [actions, selected]);

  if (readout === undefined) {
    return <div style={styles.hint}>reading…</div>;
  }
  if (readout === null) {
    return <div style={styles.hint}>no CLEO scripts in this build (nothing under cleo/*.cs)</div>;
  }

  return (
    <div style={styles.group}>
      <button onClick={() => actions.setCleoEnabled?.(!readout.enabled)} style={styles.actionButton} type="button">
        {readout.enabled ? '■ RUNNER ON — click to pause' : '□ RUNNER OFF — click to run'}
      </button>
      <button onClick={() => actions.setCleoTracing?.(!readout.tracing)} style={styles.actionButton} type="button">
        {readout.tracing ? '■ TRACE ON — click to stop' : '□ TRACE OFF — click to record'}
      </button>
      <div style={styles.statRow}>
        <span>instructions / tick</span>
        <span>{readout.instructionsLastTick}</span>
      </div>
      <div style={styles.statRow}>
        <span>script objects</span>
        <span>{readout.objects}</span>
      </div>

      <div style={styles.groupLabel}>THREADS — CLICK ONE TO FILTER THE TRACE / STEP IT</div>
      {readout.threads.map((row) => (
        <button
          key={row.name}
          onClick={() => setSelected(selected === row.name ? null : row.name)}
          style={styles.actionButton}
          type="button"
        >
          {selected === row.name ? '● ' : ''}
          {row.name} — {threadValue(row)}
        </button>
      ))}
      {selected !== null && (
        <button onClick={() => actions.cleoStep?.(selected)} style={styles.actionButton} type="button">
          STEP ONE INSTRUCTION — {selected}
        </button>
      )}

      <div style={styles.groupLabel}>COVERAGE — UNIMPLEMENTED OPCODES THIS RUN HIT</div>
      {readout.coverage.length === 0 ? (
        <div style={styles.hint}>every dispatched opcode was served</div>
      ) : (
        readout.coverage.map((row) => (
          <div key={row.label} style={styles.statRow}>
            <span>{row.label}</span>
            <span>{coverageValue(row)}</span>
          </div>
        ))
      )}

      <div style={styles.groupLabel}>ATLAS — UNSERVED NATIVE ACCESSES</div>
      {readout.misses.length === 0 ? (
        <div style={styles.hint}>every native access was served</div>
      ) : (
        readout.misses.map((row) => (
          <div key={row.label} style={styles.statRow}>
            <span>{row.label}</span>
            <span>{coverageValue(row)}</span>
          </div>
        ))
      )}

      {readout.faults.length > 0 && (
        <>
          <div style={styles.groupLabel}>FAULTS — THREADS KILLED WITH A LOCATED CAUSE</div>
          {readout.faults.map((fault) => (
            <div key={fault} style={styles.info}>
              {fault}
            </div>
          ))}
        </>
      )}

      <div style={styles.groupLabel}>TRACE{selected === null ? '' : ` — ${selected}`}</div>
      {!readout.tracing ? (
        <div style={styles.hint}>trace is off — toggle it above, then watch the story here</div>
      ) : traceTail.length === 0 ? (
        <div style={styles.hint}>no lines yet — the traced threads have not dispatched</div>
      ) : (
        <div style={styles.traceLog}>{traceTail.join('\n')}</div>
      )}
    </div>
  );
}

/** The value cell of one coverage row: `×299 tier b (conditional-false)` + UNDECLARED when so. */
export function coverageValue(row: { count?: number; declared: boolean; tier: string }): string {
  const count = row.count === undefined ? '' : `×${row.count} `;

  return `${count}${row.tier}${row.declared ? '' : ' · UNDECLARED'}`;
}

/** The value cell of one thread row: `run · 34 instr` / `sleep 240 ms` / `done` / `FAULT`. */
export function threadValue(row: CleoThreadRow): string {
  switch (row.state) {
    case 'done':
      return 'done';
    case 'fault':
      return 'FAULT';
    case 'run':
      return `run · ${row.instructions} instr`;
    case 'sleep':
      return `sleep ${row.waitMs} ms`;
  }
}
