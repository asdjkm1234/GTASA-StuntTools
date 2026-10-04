import type { ToneMappingModeName } from '@opensa/game/interfaces/config.interface';
import type { PerfStats } from '@opensa/game/perf/perf-monitor';

import { type ReactElement, useEffect, useState } from 'react';

import { styles } from './debug-styles';

/** The slice of DebugActions the perf panel reads (kept narrow so the panel is reusable/testable). */
export interface PerfPanelActions {
  /** Own-engine readout: pre-formatted `[label, value]` rows (frame/GPU/streaming/residency). Absent on the
   *  three host, whose panel reads `renderer.info` counters instead — plan 074/22 phase 3.3. */
  engineStats?: () => readonly (readonly [string, string])[];
  gpuTimings: () => readonly (readonly [string, number])[];
  /** Whether the engine's on-screen HUD is drawn. Engine host only. */
  perfHud?: () => boolean;
  /** Whether the engine prints a CPU breakdown for slow frames (`[slow]` console lines). Engine host only. */
  perfLogs?: () => boolean;
  perfStats: () => null | PerfStats;
  setPerfEnabled: (enabled: boolean) => void;
  setPerfHud?: (enabled: boolean) => void;
  setPerfLogs?: (enabled: boolean) => void;
}

/** Generic labelled checkbox row — extracted so DebugOverlay stays under its complexity cap. */
export function DebugToggle({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: (next: boolean) => void;
}): ReactElement {
  return (
    <label style={styles.label}>
      <input checked={checked} onChange={() => onToggle(!checked)} style={styles.radio} type="checkbox" />
      <span style={checked ? styles.optionActive : styles.option}>{label}</span>
    </label>
  );
}

/** The Graphics-screen master-switch row (plan 063) — extracted so DebugOverlay stays under its complexity cap. */
export function PipelineToggle({
  onChange,
  pipeline,
  setPipeline,
}: {
  onChange: (pipeline: 'classic' | 'modern') => void;
  pipeline: 'classic' | 'modern';
  setPipeline: (pipeline: 'classic' | 'modern') => void;
}): ReactElement {
  const modern = pipeline === 'modern';

  return (
    <label style={styles.label}>
      <input
        checked={modern}
        onChange={() => {
          const next = modern ? 'classic' : 'modern';
          setPipeline(next);
          onChange(next);
        }}
        style={styles.radio}
        type="checkbox"
      />
      <span style={modern ? styles.optionActive : styles.option}>
        Modern pipeline (plan 063 — no visual change yet)
      </span>
    </label>
  );
}

/** The plan-067 sky-model switch (Graphics screen) — extracted to keep DebugOverlay under its complexity cap. */
export function SkyModelToggle({
  model,
  onChange,
  setModel,
}: {
  model: 'classic' | 'pbr';
  onChange: (model: 'classic' | 'pbr') => void;
  setModel: (model: 'classic' | 'pbr') => void;
}): ReactElement {
  const pbr = model === 'pbr';

  return (
    <label style={styles.label}>
      <input
        checked={pbr}
        onChange={() => {
          const next = pbr ? 'classic' : 'pbr';
          setModel(next);
          onChange(next);
        }}
        style={styles.radio}
        type="checkbox"
      />
      <span style={pbr ? styles.optionActive : styles.option}>PBR sky (plan 067 — Preetham)</span>
    </label>
  );
}

/** The plan-063 colour-spike selector (Graphics screen): where tone mapping runs, live-switchable for A/B. */
export function ToneMappingModeSelector({
  mode,
  onChange,
  setMode,
}: {
  mode: ToneMappingModeName;
  onChange: (mode: ToneMappingModeName) => void;
  setMode: (mode: ToneMappingModeName) => void;
}): ReactElement {
  const options: readonly { label: string; value: ToneMappingModeName }[] = [
    { label: 'ACES (current)', value: 'aces' },
    { label: 'AgX', value: 'agx' },
    { label: 'Neutral (Khronos)', value: 'neutral' },
    { label: 'None (raw)', value: 'none' },
  ];

  return (
    <div style={styles.group}>
      <div style={styles.groupLabel}>TONE MAPPING (063 colour spike)</div>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => {
            setMode(option.value);
            onChange(option.value);
          }}
          style={styles.actionButton}
          type="button"
        >
          {mode === option.value ? '● ' : ''}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The own-engine Perf screen (plan 074/22 phase 3.3): the engine's own ledger — frame, GPU passes, streaming,
 * residency — plus ownership of the two developer readouts it replaces. The on-screen HUD and the `[slow]`
 * console breakdown default ON in development and OFF in a production build; both are toggled from here.
 */
function EnginePerfPanel({
  actions,
  rows,
}: {
  actions: PerfPanelActions;
  rows: readonly (readonly [string, string])[];
}): ReactElement {
  const [hud, setHud] = useState(() => actions.perfHud?.() ?? false);
  const [logs, setLogs] = useState(() => actions.perfLogs?.() ?? false);

  return (
    <div style={styles.group}>
      <div style={styles.groupLabel}>PERF (own engine)</div>
      {rows.length === 0 && <div>collecting…</div>}
      {rows.map(([label, value]) => (
        // Long values (the residency breakdown, the draw-distance note) stack under their label instead of
        // fighting it for the panel's width.
        <div
          key={label}
          style={{
            display: 'flex',
            flexDirection: value.length > 20 ? 'column' : 'row',
            justifyContent: 'space-between',
          }}
        >
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
      <DebugToggle
        checked={hud}
        label="On-screen HUD"
        onToggle={(next) => {
          setHud(next);
          actions.setPerfHud?.(next);
        }}
      />
      <DebugToggle
        checked={logs}
        label="Slow-frame console logs"
        onToggle={(next) => {
          setLogs(next);
          actions.setPerfLogs?.(next);
        }}
      />
    </div>
  );
}

/** HUD refresh cadence — 4 Hz is readable without spamming React renders. */
const POLL_MS = 250;

/**
 * Perf HUD (plan 063): rolling frame stats + `renderer.info` + GPU pass timings. Sampling is enabled only
 * while this panel is mounted — the monitor costs nothing when the HUD is closed.
 */
export function PerfPanel({ actions }: { actions: PerfPanelActions }): ReactElement {
  const [stats, setStats] = useState<null | PerfStats>(null);
  const [gpu, setGpu] = useState<readonly (readonly [string, number])[]>([]);
  const [engine, setEngine] = useState<readonly (readonly [string, string])[]>([]);

  useEffect(() => {
    actions.setPerfEnabled(true);
    const timer = window.setInterval(() => {
      setStats(actions.perfStats());
      setGpu(actions.gpuTimings());
      setEngine(actions.engineStats?.() ?? []);
    }, POLL_MS);

    return (): void => {
      window.clearInterval(timer);
      actions.setPerfEnabled(false);
    };
  }, [actions]);

  if (actions.engineStats) {
    return <EnginePerfPanel actions={actions} rows={engine} />;
  }

  if (!stats) {
    return <div style={styles.group}>collecting…</div>;
  }

  const rows: [string, string][] = [
    ['FPS', stats.fps.toFixed(0)],
    ['frame avg', `${stats.avgMs.toFixed(2)} ms`],
    ['frame p95', `${stats.p95Ms.toFixed(2)} ms`],
    ['draw calls', String(stats.drawCalls)],
    ['triangles', stats.triangles.toLocaleString('en-US')],
    ['programs', String(stats.programs)],
    ['geometries', String(stats.geometries)],
    ['textures', String(stats.textures)],
    ...gpu.map(([label, ms]): [string, string] => [`gpu ${label}`, `${ms.toFixed(2)} ms`]),
  ];

  return (
    <div style={styles.group}>
      <div style={styles.groupLabel}>PERF</div>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}
