/**
 * The 201/1-01 readout: a small panel that says how much has been sampled and hands the table over.
 *
 * It exists because the development machine is a phone ([`docs/development/termux.md`]) — there is no
 * headless browser to capture from, so the capture has to leave through something a thumb can press.
 *
 * Two things it does not do. It does not re-render on the frame loop: it polls a getter twice a second, and
 * the numbers it shows are only enough to tell that collection is alive. And it does not assume the
 * clipboard: `navigator.clipboard` needs a secure context, which `http://localhost` is and a LAN address is
 * NOT — so a phone reaching a dev server at `192.168.x.x` falls back to a selected textarea to long-press.
 *
 * **Since 2026-08-27 it can also FILE the capture itself**, straight into the phone panel
 * (`tools-debug/phone-console`), which writes it under `docs/benchmarks/` and stamps the pak facts on it.
 * That removes the step where a measurement was actually being lost: copy the JSON, leave the map, switch
 * apps, paste, type a name. The button is offered only when a panel answers — on a desk there is none, and a
 * button that can only fail is worse than no button.
 *
 * **And since 201/3-05 it FOLDS.** Fourteen rows of monospace over a 360-px phone is most of the screen, and
 * the screen is the map — so it opens folded where the pointer is a finger, keeps the operator's choice, and
 * folded it still carries the two things that must not be hidden: that collection is alive, and that
 * something warned. A panel that could swallow a warning would be worse than one that is in the way.
 */
import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { InventoryReport } from '../world/inventory';

import { readJson, STORAGE_KEYS, writeJson } from '../map/storage';
import { styles } from './styles';
import { useCoarsePointer } from './use-compact';

const POLL_MS = 500;

export function InventoryPanel({ read }: { read: () => InventoryReport | null }): null | ReactElement {
  const [report, setReport] = useState<InventoryReport | null>(null);
  // A finger and a mouse get different defaults on purpose: on a desk the panel costs a corner of a large
  // map and is worth having open, on a phone it costs the map. The operator's own choice outranks both.
  const touch = useCoarsePointer();
  const [open, setOpen] = useState<boolean>(() => initiallyOpen(touch));
  const [copied, setCopied] = useState('');
  const [fallback, setFallback] = useState('');
  const [filed, setFiled] = useState('');
  /** Whether the phone panel is up. Null while unknown — the button appears only once one has answered. */
  const [panel, setPanel] = useState<null | string>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * The getter through a REF, so the poll below depends on nothing and is started exactly once.
   *
   * With `[read]` as the dependency this panel froze at the first tick and stayed there. `read` is an inline
   * arrow in the host's JSX, so it is a new function on every render of the host — and the host re-renders
   * on every readout, four times a second. The effect therefore tore the interval down and rebuilt it every
   * 250 ms, and a 500 ms interval never got to fire.
   *
   * It failed in the one direction nothing catches: while the console is BUSY. Idle, the readouts stop, the
   * interval survives and the panel updates — which is why the 2026-08-23 capture carried a 65 s window and
   * the 2026-08-25 one, taken while flying the map, carried a single frame from just after boot. Every
   * capture of a MOVING map was a capture of the boot until this line changed.
   */
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    const id = setInterval((): void => setReport(readRef.current()), POLL_MS);

    return (): void => clearInterval(id);
  }, []);

  useEffect(() => {
    if (fallback && areaRef.current) {
      areaRef.current.select();
    }
  }, [fallback]);

  // Ask once, at mount: is a panel listening? A failure here is the ordinary case (a desk, a shared link)
  // and must be silent — the button simply is not offered.
  useEffect(() => {
    const url = panelUrl();
    const abort = new AbortController();
    fetch(`${url}/api/state`, { signal: abort.signal })
      .then((response) => (response.ok ? setPanel(url) : undefined))
      .catch(() => undefined);

    return (): void => abort.abort();
  }, []);

  if (!report) {
    return null;
  }

  /**
   * Hand the capture to the panel, with the conditions the MAP knows and the panel cannot: which district,
   * which mode, how many units were on the board. The panel adds what IT knows — the pak's own recipe, the
   * device, the node version — and writes the file. Nothing is typed on a phone.
   */
  const file = (): void => {
    const params = new URLSearchParams(window.location.search);
    const district = params.get('district') ?? 'world';
    const mode = params.get('mode') === 'flat' ? 'flat' : 'live';
    setFiled('filing…');
    void fetch(`${panel ?? ''}/api/capture`, {
      body: JSON.stringify({
        note: `${mode} map, ${report.symbology.units} units · ${window.location.search || 'no query'}`,
        out: outOf(params.get('src')),
        payload: report,
        slug: `mobile-${district}-${mode}-${report.symbology.units}u`,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
      .then(async (response) => {
        const body = (await response.json()) as { error?: string; path?: string };
        setFiled(body.path ? `filed → ${body.path}` : `panel refused: ${body.error ?? response.status}`);
      })
      .catch((error: unknown) => setFiled(`panel unreachable: ${error instanceof Error ? error.message : 'failed'}`));
  };
  const copy = (): void => {
    // Serialised on the press, never on the render. This panel polls at 2 Hz, so a report stringified in the
    // body ran twice a second on a phone for a button nobody had touched — and folded, for one not on screen.
    const json = JSON.stringify(report, null, 2);
    void navigator.clipboard
      ?.writeText(json)
      .then(() => {
        setCopied('copied');
        setTimeout(() => setCopied(''), 1500);
      })
      .catch(() => setFallback(json));
    if (!navigator.clipboard) {
      setFallback(json);
    }
  };

  const alerts = report.warnings.length + report.errors.length + report.unavailable.length;
  const fold = (): void => {
    const next = !open;
    setOpen(next);
    writeJson(STORAGE_KEYS.inventoryOpen, next);
  };

  return (
    <div style={open ? styles.inventoryPanel : { ...styles.inventoryPanel, ...styles.inventoryPanelFolded }}>
      {/* The header is the control. Folded it is the whole panel, so it carries what may not be hidden:
          that collection is alive (`frames`), what the frame cost, and whether anything warned. */}
      <button
        aria-expanded={open}
        onClick={fold}
        style={touch ? { ...styles.inventoryHeader, ...styles.inventoryHeaderTouch } : styles.inventoryHeader}
        type="button"
      >
        <span>{open ? '▾' : '▸'}</span>
        <strong>inventory</strong>
        <span>
          {report.frames - report.rest.frames}f · {report.frame.dtP50Ms.toFixed(0)} ms
        </span>
        {alerts > 0 && (
          <span style={styles.inventoryWarn} title="Warnings and errors — open the panel to read them">
            ⚠ {alerts}
          </span>
        )}
      </button>
      {open && (
        <>
          <div>
            window {(report.windowMs / 1000).toFixed(0)}s · {report.frames} frames
          </div>
          <div>
            frame p50 {report.frame.dtP50Ms.toFixed(0)} · p95 {report.frame.dtP95Ms.toFixed(0)} · max{' '}
            {report.frame.dtMaxMs.toFixed(0)} ms
          </div>
          {/* 201/3-05: how much of the window was the render gate resting rather than a frame costing
              anything. Without it a capture whose numbers came from 129 frames out of 835 reads as though
              every one of them was a frame — which is how the record read for nine days. */}
          {report.rest.frames > 0 && (
            <div>
              rest {report.rest.frames} of {report.frames} frames ·{' '}
              {Math.round((report.rest.totalMs / Math.max(1, report.windowMs)) * 100)}% of the window
            </div>
          )}
          <div>
            cpu {report.cpu.bodyMeanMs.toFixed(1)} · outside {report.cpu.outsideMeanMs.toFixed(1)} ms (
            {Math.round(report.cpu.shareOfFrame * 100)}% in the loop)
          </div>
          <div>
            {report.world.cellsVisible}/{report.world.cellsTotal} cells · {report.world.draws} draws ·{' '}
            {report.world.residencyMb.toFixed(0)} MB
          </div>
          <div>
            pak read {(report.bytes.totalBytes / (1024 * 1024)).toFixed(1)} MB in {report.bytes.requests} requests
            {report.bytes.byKind.length > 0 && ` · ${report.bytes.byKind[0].kind} leads`}
          </div>
          <div>
            stream blob {report.streaming.blobMeanMs.toFixed(1)} · upload {report.streaming.uploadMeanMs.toFixed(1)} ms
            · worst blob {report.streaming.worstBlobMs.toFixed(0)} ms · {report.streaming.cellsCreated} created
          </div>
          <div>
            board {report.symbology.units}u/{report.symbology.incidents}c · {report.symbology.symbols} symbols ·{' '}
            {report.symbology.chips} chips ({report.symbology.chipsDropped} dropped)
            {report.symbology.stale > 0 && ` · ${report.symbology.stale} stale`}
          </div>
          <div>
            cars {report.symbology.unitsAsModels}/{report.symbology.units} · {report.symbology.modelTypes} types ·{' '}
            {report.symbology.modelTextureMb.toFixed(1)} MB
            {report.symbology.unitsUnresolvedModels > 0 && ` · ${report.symbology.unitsUnresolvedModels} unresolved`}
          </div>
          {report.tracks !== null && (
            <div>
              tracks {report.tracks.tracks} × {report.tracks.capacity} · {report.tracks.samples} samples ·{' '}
              {(report.tracks.bytes / (1024 * 1024)).toFixed(1)} MB host
              {report.tracks.window !== null &&
                ` · ${((report.tracks.window[1] - report.tracks.window[0]) / 60_000).toFixed(0)} min held`}
            </div>
          )}
          {report.symbology.beaconGrowths > 0 && (
            <div style={styles.inventoryWarn}>
              beacon buffers grown {report.symbology.beaconGrowths}× past the declared budget
            </div>
          )}
          {report.cpu.worstFrame.bodyMs > 0 && (
            <div>
              worst body {report.cpu.worstFrame.bodyMs.toFixed(0)} ms
              {report.cpu.worstFrame.segmentsMs.length > 0 &&
                ` — ${report.cpu.worstFrame.segmentsMs[0][0]} ${report.cpu.worstFrame.segmentsMs[0][1].toFixed(0)}`}
            </div>
          )}
          {report.unavailable.length > 0 && (
            <div style={styles.inventoryWarn}>GPU timings unavailable on this adapter</div>
          )}
          {report.warnings.map((warning) => (
            <div key={warning} style={styles.inventoryWarn}>
              {warning}
            </div>
          ))}
          {/* On the phone there is no devtools to open, so an error the page logged has to be readable HERE —
          copying the JSON out of a browser that is failing is the harder half of the round trip. */}
          {report.errors.map((error) => (
            <div key={error} style={styles.inventoryWarn}>
              error: {error}
            </div>
          ))}
          <button onClick={copy} style={styles.inventoryButton} type="button">
            {copied || 'copy JSON'}
          </button>
          {panel !== null && (
            <button onClick={file} style={styles.inventoryButton} type="button">
              {filed || 'file to the panel'}
            </button>
          )}
          {fallback && <textarea readOnly ref={areaRef} style={styles.inventoryFallback} value={fallback} />}
        </>
      )}
    </div>
  );
}

/**
 * Whether the panel opens open. The operator's stored choice first; failing that the POINTER decides, which
 * is the cross-platform-surface rule rather than a preference: on a phone this panel is most of the map.
 */
function initiallyOpen(touch: boolean): boolean {
  const stored = readJson(STORAGE_KEYS.inventoryOpen);

  return typeof stored === 'boolean' ? stored : !touch;
}

/**
 * The build folder behind a `?src=`, which is what the panel stamps its pak facts from. A src is a URL to
 * the served build (`http://localhost:3001/build/phone`), and the panel wants the repo-relative path.
 */
function outOf(src: null | string): string {
  if (!src) {
    return './build/phone';
  }
  const path = src.startsWith('http') ? new URL(src).pathname : src;

  return `./${path.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

/**
 * Where the panel is. `?panel=` for anything unusual, otherwise the port it serves on — the map and the
 * panel are two pages on one phone, so "localhost" is the whole of the addressing.
 */
function panelUrl(): string {
  const override = new URLSearchParams(window.location.search).get('panel');

  return override && override !== '' ? override.replace(/\/$/, '') : `${window.location.protocol}//localhost:8787`;
}
