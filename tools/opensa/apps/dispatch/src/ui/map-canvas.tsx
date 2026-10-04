/**
 * The map surface: the WebGPU canvas the engine draws the city on, and the 2D canvas the symbology is drawn
 * on, stacked. The 2D layer is `pointer-events: none` — every gesture belongs to the engine canvas underneath,
 * which is also what hit-tests the symbology, so there is exactly one input owner.
 */
import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { GtaGround } from '../map/coords';
import type { HistoryStats } from '../ops/history';
import type { Operations, Selection } from '../ops/types';
import type { DispatchActions } from '../ops/use-operations';
import type { AgentStatus } from '../world/agent-link';
import type { BootOptions, DispatchHandle, DispatchReadout } from '../world/boot';
import type { BootedMode, MapMode, ModeReport } from '../world/mode-switch';

import { commandFor } from '../map/keymap';
import { startAgentLink } from '../world/agent-link';
import { bootDispatch } from '../world/boot';
import { dispatchParams } from '../world/boot';
import { bootStep } from '../world/boot-progress';
import { ModeSwitch } from '../world/mode-switch';
import { bootPlanMode } from '../world/plan-mode';
import { AgentBand } from './agent-band';
import { AgentNotices, useAgentNotices } from './agent-notices';
import { InventoryPanel } from './inventory-panel';
import { styles } from './styles';

/** Module scope, so StrictMode's dev double-mount boots the engine on the canvas exactly once. */
let switcher: ModeSwitch | null = null;
/** The same, for the panel link: one page, one link, however many times React mounts this. */
let agentLink: null | { stop: () => void } = null;

export function MapCanvas({
  actions,
  children,
  compact,
  createPakWorker,
  onMode,
  onReadout,
  onReady,
  read,
}: {
  actions: DispatchActions;
  /** Rendered inside the map's positioned wrapper — the selection panel floats over the canvas. */
  children?: React.ReactNode;
  /** Phone layout: the radar takes its smaller size (201/7-04). */
  compact: boolean;
  /** How to build the pak worker, for a bundle that cannot serve the chunk beside it (201/2-02). */
  createPakWorker?: () => Worker;
  /** Which surface is drawing, and how to change it (201/6-03) — called on the first open and after every
   *  switch, so the chrome shows the mode the operator actually has rather than the one they asked for. */
  onMode?: (state: { mode: MapMode; toggle: () => void; why: string }) => void;
  onReadout: (readout: DispatchReadout) => void;
  onReady: (handle: DispatchHandle) => void;
  read: {
    fixAges: () => ReadonlyMap<string, number>;
    ops: () => Operations;
    selection: () => Selection;
    trackStats: () => HistoryStats;
    trails: () => ReadonlyMap<string, Float32Array>;
  };
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  /** Why the 3D map is absent, when it is — shown as a banner over a WORKING plan-mode board. */
  const [degraded, setDegraded] = useState('');
  /** Which surface is drawing. Null until the first one is up, so the chrome shows no mode it does not have. */
  const [mode, setMode] = useState<MapMode | null>(null);
  /** What the panel link is doing to this page. Null until a panel actually answers one of its polls. */
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  /** What it is doing right NOW, command by command — the half the band could not carry (201/3-05). */
  const notices = useAgentNotices();
  /** The sink through a ref, because the boot effect runs once and the hook's `push` is a new function on
   *  every render: capturing it directly would freeze the feed at the first one. */
  const pushNotice = useRef(notices.push);
  pushNotice.current = notices.push;
  /** Held for the inventory panel only (201/1-01) — it reads the collector, it does not drive the loop. */
  const handleRef = useRef<DispatchHandle | null>(null);
  /** The last readout, for the agent link's heartbeat — a ref, so mirroring it costs no render. */
  const lastReadout = useRef<DispatchReadout | null>(null);
  // Callbacks reach the loop through a ref so the boot effect never re-runs: re-booting the engine on a
  // re-render would leak a device and a streaming worker per render.
  const liveRef = useRef({ actions, createPakWorker, onMode, onReadout, read });
  liveRef.current = { actions, createPakWorker, onMode, onReadout, read };

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) {
      return;
    }
    const boot: BootOptions = {
      canvas,
      ...(minimapRef.current ? { minimap: minimapRef.current } : {}),
      // Read from the ref like every other callback: the boot effect must not re-run, and a factory prop
      // that arrives one render later would otherwise re-boot the engine and leak a device.
      ...(liveRef.current.createPakWorker ? { createPakWorker: liveRef.current.createPakWorker } : {}),
      fixAges: () => liveRef.current.read.fixAges(),
      onClick: (click) => {
        const { select } = liveRef.current.actions;
        if (click.kind === 'ground') {
          select(null);
        } else if (click.kind === 'world') {
          select({ at: click.at, district: click.district, kind: 'world', model: click.model, txd: click.txd });
        } else {
          select({ id: click.id, kind: click.kind });
        }
      },
      onGround: (at: GtaGround, district: null | string) => liveRef.current.actions.createAt(at, district),
      onReadout: (readout) => {
        lastReadout.current = readout;
        liveRef.current.onReadout(readout);
      },
      ops: () => liveRef.current.read.ops(),
      overlay,
      selection: () => liveRef.current.read.selection(),
      trackStats: () => liveRef.current.read.trackStats(),
      trails: () => liveRef.current.read.trails(),
    };
    /**
     * Start one mode, and own the FALLBACK here rather than in the switch: this is the layer that knows how
     * the failure looked. The 3D map is the preferred surface, never a requirement — a browser without
     * WebGPU, or a world this GPU cannot read, comes up on the 2D plan with every unit, call and gesture
     * working, and says why (201/6-03: an automatic floor, never a silent downgrade).
     *
     * `?mode=flat` and the operator's own switch reach the same function, and neither raises a banner: a
     * mode that was CHOSEN is not a degraded one.
     */
    const bootMode = (mode: MapMode): Promise<BootedMode> =>
      mode === 'flat'
        ? Promise.resolve({ mode, surface: bootPlanMode(boot, 'flat map'), why: '' })
        : bootDispatch(boot)
            .then((surface): BootedMode => ({ mode: 'live', surface, why: '' }))
            .catch((error: unknown) => {
              // eslint-disable-next-line no-console -- a degraded map must say why, in the console as well as on it
              console.warn('[dispatch] 3D map unavailable, falling back to plan mode:', error);
              // The shell is still up at this point and its last phase is whatever the 3D boot died in. Say
              // what is happening instead of leaving that on screen while the fallback wires itself up —
              // `bootPlanMode` releases the shell when it is ready.
              bootStep('no 3D map here — switching to the plan view…');

              return { mode: 'flat' as const, surface: bootPlanMode(boot, reason(error)), why: reason(error) };
            });

    switcher ??= new ModeSwitch(bootMode, (report: ModeReport) => {
      const handle = switcher?.surface as DispatchHandle | undefined;
      setDegraded(report.why);
      setMode(report.mode);
      if (handle) {
        handleRef.current = handle;
        onReady(handle);
      }
      // The map answers the phone panel while `?agent=1` is on (phone-console plan 002) — started once, on
      // the first surface, and left alone by later switches: the link reads through the switcher, so what
      // it reports is whatever is drawing now.
      if (agentLink === null && dispatchParams().get('agent') === '1') {
        agentLink = startAgentLink(
          panelUrl(),
          {
            errors: () => handleRef.current?.inventory()?.errors ?? [],
            image: () => handleRef.current?.exportImage() ?? Promise.resolve(null),
            inventory: () => handleRef.current?.inventory() ?? null,
            mode: () => switcher?.current() ?? null,
            moveTo: (pose) => handleRef.current?.recallView(pose),
            ops: () => liveRef.current.read.ops(),
            readout: () => lastReadout.current,
            setMode: (wanted) => void switcher?.to(wanted),
          },
          setAgent,
          (report) => pushNotice.current(report),
        );
      }
      // The cost the step owes, on whatever device is running it — the first open included, since that is
      // the number a field report compares a switch against.
      // eslint-disable-next-line no-console -- the switch cost is a measurement, and a phone has no devtools
      console.log(`[mode] ${report.requested} → ${report.mode} in ${Math.round(report.ms)} ms`);
      rememberMode(report.mode);
      liveRef.current.onMode?.({
        mode: report.mode,
        toggle: () => void switcher?.to(report.mode === 'live' ? 'flat' : 'live'),
        why: report.why,
      });
    });
    void switcher.to(dispatchParams().get('mode') === 'flat' ? 'flat' : 'live');
  }, [onReady]);

  // `m` belongs to the chrome for the same reason the help sheet's `?` does — and a stronger one: a mode
  // change disposes the surface a key handler inside it would be running in.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey || commandFor(event) !== 'toggleMode') {
        return;
      }
      event.preventDefault();
      void switcher?.to(switcher.current() === 'live' ? 'flat' : 'live');
    };
    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div style={styles.canvasWrap}>
      <canvas ref={canvasRef} style={styles.canvas} />
      <canvas ref={overlayRef} style={{ ...styles.fill, pointerEvents: 'none', zIndex: 2 }} />
      {/* The radar (201/7-04). Absent in plan mode, which has no 3D view to locate and draws its own board. */}
      {mode === 'live' && <canvas ref={minimapRef} style={compact ? styles.minimapCompact : styles.minimap} />}
      {children}
      {agent && <AgentBand compact={compact} status={agent} />}
      <AgentNotices notices={notices.notices} />
      {degraded && <DegradedBanner message={degraded} />}
      {dispatchParams().get('inventory') === '1' && (
        <InventoryPanel read={() => handleRef.current?.inventory() ?? null} />
      )}
    </div>
  );
}

/** The board still works; say what is missing and why, without covering it. */
function DegradedBanner({ message }: { message: string }): ReactElement {
  return (
    <div style={styles.degradedBanner}>
      <strong>2D plan mode</strong> — no 3D world: {message}
    </div>
  );
}

/** Where the phone panel is — `?panel=` for anything unusual, otherwise the port it serves on. */
function panelUrl(): string {
  const override = dispatchParams().get('panel');

  return override && override !== '' ? override.replace(/\/$/, '') : `${window.location.protocol}//localhost:8787`;
}

/** The short version of a boot error, for a banner that has one line. */
function reason(error: unknown): string {
  const text = String(error);
  // These two look alike and are fixed differently, so they must not share a message: no `navigator.gpu` is a
  // browser that never shipped WebGPU, while a null adapter is a browser that HAS it and refused this GPU
  // (Android below 12, no Vulkan 1.1, or a blocklisted device — the last of which a flag can override).
  if (text.includes('WebGPU is not available')) {
    return 'this browser has no WebGPU at all';
  }
  if (text.includes('adapter request failed')) {
    return 'this browser has WebGPU but no usable GPU adapter (blocklisted, or the OS/driver is too old)';
  }
  if (text.includes('texture-compression-bc')) {
    return "this GPU cannot read the world's BC textures (rebuild the pak with --rgba8)";
  }
  if (text.includes('no pak manifest')) {
    return 'no built game to stream (pass ?src=, or ?demo=1 for the synthetic city)';
  }

  return text.replace(/^Error:\s*/, '').slice(0, 160);
}

/**
 * Keep the chosen mode in the address bar, so a reload — or a link an operator sends — opens the same one.
 *
 * `replaceState`, never `pushState`: a mode is a view setting, and filling somebody's Back button with them
 * is how Back stops meaning "the page I came from".
 *
 * **It writes nothing when the console does not own the address bar** — an embedded map lives in a host's
 * URL and must not touch it (201/7-07), and a host that configures the surface through
 * `window.__opensaDispatch` is not reading `window.location` at all, so a write there would be a lie as well
 * as a trespass.
 */
function rememberMode(mode: MapMode): void {
  const embedded =
    (window as { __opensaDispatch?: string }).__opensaDispatch !== undefined ||
    new URLSearchParams(window.location.search).get('embed') === '1';
  if (embedded) {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set('mode', mode);
  window.history.replaceState(window.history.state, '', url);
}
