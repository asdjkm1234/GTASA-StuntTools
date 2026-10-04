/**
 * Before/after model compare viewer (map-optimizer plan 019 Phase 2). Talks to the compare server
 * (`tsx tools/map-optimizer/src/compare-serve.ts --before <dir> --after <dir>`), which serves one model's
 * DFF/TXD bytes from two game trees, and shows them through the real parse → build path with one camera.
 *
 * Ported onto the own engine in plan 074/13 phase 4. **The layout changed and the change is deliberate:**
 * three's split screen was `setScissorTest` + two `render()` calls into half-viewports, which our engine
 * has no equivalent for — `frame()` owns the whole canvas and the whole post chain, so a true split would
 * mean running MSAA resolve, bloom and tonemap twice per frame for a dev tool. Instead both sides live in
 * ONE scene:
 *   - **Side by side** (default) — BEFORE left, AFTER right, one orbit camera, both visible at once.
 *   - **Stack (blink)** — both at the SAME origin with only one shown; `B` or the button flips between
 *     them. Exact pixel overlap, which is strictly better than a split for spotting small differences.
 *
 * Open at /viewer.html?tab=compare (run `npm run dev`; the compare server is its own process).
 */
import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import type { ViewedModel } from './engine/model-view';

import { loadModelFromClump, loadModelFromOsm } from './engine/model-view';
import { createViewerEngine } from './engine/viewer-engine';

/** A fetched side: either the converted `.osm`, or the stock DFF (+ its TXD). */
type Fetched = { dff: ArrayBuffer; txd: ArrayBuffer | null } | { osm: ArrayBuffer };

type Side = 'after' | 'before';

/** What one side rendered from: a parsed stock clump (+txd), or a converted own-engine `.osm` (self-contained). */
interface SideState {
  clump: null | RWClump;
  model: null | ViewedModel;
  /** The model name — `loadModelFromOsm` needs it (error messages, section labels). */
  name: null | string;
  /** Converted `.osm` bytes when this side is own-engine; null when it is a stock clump. */
  osm: ArrayBuffer | null;
  txd: ArrayBuffer | null;
}

const DEFAULT_SERVER = 'http://localhost:3002';
let serverUrl = DEFAULT_SERVER;

const viewer = createViewerEngine();

const sides: Record<Side, SideState> = {
  after: { clump: null, model: null, name: null, osm: null, txd: null },
  before: { clump: null, model: null, name: null, osm: null, txd: null },
};

const prelit = { double: false, on: true };
let nightColours = false;
let stacked = false;
/** In stack mode, which side is currently shown. */
let shown: Side = 'before';
const polyLabel = Object.assign(document.createElement('div'), { className: 'hint' });

/** Fixed corner labels, so it is always obvious which side you are looking at. */
function addSideLabel(text: string, corner: 'left' | 'right'): HTMLDivElement {
  const label = document.createElement('div');
  label.textContent = text;
  label.style.cssText = `position:fixed;bottom:12px;${corner}:16px;font:12px monospace;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none`;
  document.body.appendChild(label);

  return label;
}

function addToggle(parent: HTMLElement, label: string, initial: boolean, onChange: (on: boolean) => void): void {
  const wrapper = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = initial;
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  wrapper.append(checkbox, document.createTextNode(` ${label}`));
  parent.appendChild(wrapper);
}

const beforeLabel = addSideLabel('BEFORE', 'left');
const afterLabel = addSideLabel('AFTER', 'right');

/** Store a fetched side — the converted `.osm` bytes, or the parsed stock clump + its TXD. */
function applyFetched(state: SideState, fetched: Fetched, name: string): void {
  state.name = name;
  if ('osm' in fetched) {
    state.osm = fetched.osm;
    state.clump = null;
    state.txd = null;
  } else {
    state.clump = parseDff(fetched.dff);
    state.txd = fetched.txd;
    state.osm = null;
  }
}

function applyPrelit(): void {
  viewer.engine.debugPrelitScale = prelit.on ? (prelit.double ? 2 : 1) : 0;
}

function buildControls(): void {
  const panel = document.createElement('div');
  panel.className = 'panel';

  const server = document.createElement('input');
  server.value = DEFAULT_SERVER;
  server.title = 'compare server URL';
  const input = document.createElement('input');
  input.placeholder = 'model name…';
  input.setAttribute('list', 'compare-models');
  const datalist = document.createElement('datalist');
  datalist.id = 'compare-models';
  const status = document.createElement('div');
  status.className = 'hint';

  const submit = (): void => {
    const name = input.value.trim().toLowerCase();
    if (name) {
      void loadModel(name, status);
    }
  };
  const load = document.createElement('button');
  load.textContent = 'Load';
  load.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submit();
    }
  });
  server.addEventListener('change', () => {
    serverUrl = server.value.replace(/\/$/, '');
    void loadModelList(datalist, status);
  });

  panel.append(server, input, datalist, load, status);

  const flip = document.createElement('button');
  flip.textContent = 'Flip side (B)';
  flip.addEventListener('click', flipSide);
  panel.appendChild(flip);

  addToggle(panel, 'Stack (blink A/B)', stacked, (on) => {
    stacked = on;
    layout();
  });
  addToggle(panel, 'Lit', !viewer.engine.debugUnlit, (on) => {
    viewer.engine.debugUnlit = !on;
  });
  addToggle(panel, 'Prelit vertex colours', prelit.on, (on) => {
    prelit.on = on;
    applyPrelit();
  });
  addToggle(panel, 'Prelit ×2 (MODULATE2X)', prelit.double, (on) => {
    prelit.double = on;
    applyPrelit();
  });
  addToggle(panel, 'Night colours', nightColours, (on) => {
    nightColours = on;
    rebuildBoth();
  });

  panel.appendChild(polyLabel);
  document.body.appendChild(panel);
  void loadModelList(datalist, status);
}

async function fetchSide(side: Side, model: string): Promise<Fetched> {
  const q = `side=${side}&model=${encodeURIComponent(model)}`;
  const tryOsm = async (): Promise<Fetched | null> => {
    const response = await fetch(`${serverUrl}/osm?${q}`);

    return response.ok ? { osm: await response.arrayBuffer() } : null;
  };
  const tryDff = async (): Promise<Fetched | null> => {
    const [dff, txd] = await Promise.all([
      fetch(`${serverUrl}/dff?${q}`).then((response) => (response.ok ? response.arrayBuffer() : null)),
      fetch(`${serverUrl}/txd?${q}`).then((response) => (response.ok ? response.arrayBuffer() : null)),
    ]);

    return dff ? { dff, txd } : null;
  };
  // BEFORE is conventionally stock (DFF), AFTER converted (OSM) — try the likely format first so the common
  // workflow makes no 404s; fall back to the other for the rare mismatch.
  const [first, second] = side === 'after' ? [tryOsm, tryDff] : [tryDff, tryOsm];
  const result = (await first()) ?? (await second());
  if (!result) {
    throw new Error(`${side}: ${model} not found`);
  }

  return result;
}

function flipSide(): void {
  shown = shown === 'before' ? 'after' : 'before';
  layout();
}

function frameBoth(width: number): void {
  const model = sides.before.model ?? sides.after.model;
  if (!model) {
    return;
  }
  const [x, y, z] = model.bounds.center;
  viewer.orbit.frame([stacked ? x : 0, y, z], (model.bounds.radius + (stacked ? 0 : width)) * 2);
}

/**
 * Place both sides and set their visibility. Side-by-side pushes each half a model-width outward;
 * stack mode puts them both at the origin and hides one.
 */
function layout(): void {
  const width = Math.max(sides.before.model?.bounds.radius ?? 0, sides.after.model?.bounds.radius ?? 0) * 1.15;

  for (const side of ['before', 'after'] as const) {
    const model = sides[side].model;
    if (!model) {
      continue;
    }
    const offset = stacked ? 0 : side === 'before' ? -width : width;
    model.setOffset([offset, 0, 0]);
    model.setVisible(!stacked || shown === side);
  }

  beforeLabel.style.opacity = !stacked || shown === 'before' ? '1' : '0.25';
  afterLabel.style.opacity = !stacked || shown === 'after' ? '1' : '0.25';
  frameBoth(width);
}

async function loadModel(name: string, status: HTMLElement): Promise<void> {
  status.textContent = `loading ${name}…`;
  try {
    const [before, after] = await Promise.all([fetchSide('before', name), fetchSide('after', name)]);
    await viewer.ready;
    applyFetched(sides.before, before, name);
    applyFetched(sides.after, after, name);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);

    return;
  }
  rebuildBoth();
  status.textContent = name;
}

/** Fetch the both-sides model list (no `side` param = the intersection of the two trees). */
async function loadModelList(datalist: HTMLDataListElement, status: HTMLElement): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/models`);
    if (!response.ok) {
      status.textContent = `compare server not reachable at ${serverUrl}`;

      return;
    }
    const names = (await response.json()) as string[];
    datalist.replaceChildren(...names.map((name) => Object.assign(document.createElement('option'), { value: name })));
    status.textContent = `${names.length} models on both sides`;
  } catch {
    status.textContent = `compare server not reachable at ${serverUrl}`;
  }
}

/**
 * Rebuild both sides from their CACHED clumps — no refetch. The night-colours view swaps each geometry's
 * night vertex-colour set in as its prelit set (a shallow copy; the parsed clump is never mutated), which
 * is exactly the data the prelight passes correct.
 */
function rebuildBoth(): void {
  let triangles = 0;
  const skipped: string[] = [];

  for (const side of ['before', 'after'] as const) {
    const state = sides[side];
    state.model?.dispose();
    state.model = null;
    try {
      if (state.osm && state.name) {
        // A converted side is already baked (incl. night colours) — the night-colours swap is a clump-only view.
        state.model = loadModelFromOsm(viewer.engine, state.name, state.osm);
      } else if (state.clump) {
        const clump = nightColours ? withNightColours(state.clump) : state.clump;
        state.model = loadModelFromClump(viewer.engine, clump, state.txd ? [state.txd] : []);
      } else {
        continue;
      }
      triangles += state.model.triangles;
    } catch (error) {
      // A world-textured map object can't be shown standalone — skip THIS side, keep the other rendering.
      skipped.push(side);
      // eslint-disable-next-line no-console -- the reason (textures in the shared pak) belongs in the console
      console.warn(`[compare] ${side}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  polyLabel.textContent =
    `Triangles: ${Math.round(triangles).toLocaleString()} (both sides)` +
    (skipped.length > 0 ? ` — ${skipped.join(' + ')} not viewable standalone (map object)` : '');
  applyPrelit();
  layout();
}

function withNightColours(clump: RWClump): RWClump {
  return {
    ...clump,
    geometries: clump.geometries.map((geometry) => ({
      ...geometry,
      prelitColors: geometry.nightColors ?? geometry.prelitColors,
    })),
  };
}

window.addEventListener('keydown', (event) => {
  // `key` is absent on some synthetic keydowns (datalist autocomplete pick, IME/autofill) — guard it.
  if (event.key?.toLowerCase() === 'b') {
    flipSide();
  }
});
buildControls();
viewer.start();
