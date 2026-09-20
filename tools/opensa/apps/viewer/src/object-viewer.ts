/**
 * Standalone object viewer (map models) — a dev tool, isolated from the map/streaming/instancing layers.
 * It reuses the real asset path (fetch → parseDff/parseTxd → `buildVehicleModel` → the engine's rigid
 * upload), so what you see here is exactly what the SHIPPING renderer produces for one model.
 *
 * Ported off three.js in plan 074/13 phase 4. The toggles survived the port but changed nature: they used
 * to switch three MATERIALS the game never used (so the tool answered "is this dark because of the DFF or
 * because of the map pipeline?" by comparing two different render paths). They are now ENGINE features —
 * `debugPrelitScale` / `debugUnlit` ride spare frame-uniform lanes and the wireframes are a line-list
 * pipeline — so every view is the SHIPPING renderer with exactly one term changed.
 *
 * Models load on demand from the compare server (`--after` side) via the autocomplete box — run
 * `npx tsx tools/map-optimizer/src/compare-serve.ts --before <dir> --after <dir>` alongside `npm run dev`.
 * Open at /viewer.html?tab=object.
 */
import type { ColModel } from '@opensa/renderware/parsers/binary/col-types';

import { parseColLibrary } from '@opensa/renderware/parsers/binary/col';

import type { ViewedModel } from './engine/model-view';

import { loadModel, loadModelFromOsm } from './engine/model-view';
import { createViewerEngine } from './engine/viewer-engine';

/** Serialised COL (baked by scripts/test-viewer-fixtures.ts) — vertices as a plain array. */
type ColJson = Omit<ColModel, 'vertices'> & { vertices: number[] };

interface ModelEntry {
  /** Optional shared COL *library* (e.g. LODvegetation.col); collision is looked up inside it by dff name. */
  col?: string;
  dff: string;
  name: string;
  /** When set, DFF/TXD load from this compare server's `--after` side instead of the static `viewer/objects/` tree. */
  server?: string;
  txd: string;
}

const BASE = import.meta.env.VITE_STATIC_URL;
/** Compare server (same as the Compare tab); the object tab autocompletes + loads from its `--after` side. */
const DEFAULT_SERVER = 'http://localhost:3002';

const viewer = createViewerEngine();

// Several models overlaid at the origin (keyed by dff) so they can be compared side-by-side.
const loaded = new Map<string, ViewedModel>();
// Every known model (anchors + manifest), keyed by dff — so "Clear all" can resolve loaded entries.
const entriesByDff = new Map<string, ModelEntry>();
/** Live triangle count of the loaded (overlaid) models. */
const polyLabel = Object.assign(document.createElement('div'), { className: 'hint' });
/** Raw TXD bytes per source; the engine builds its own texture array per model. */
const txdCache = new Map<string, Promise<ArrayBuffer | null>>();
/** Parsed COL library (e.g. LODvegetation.col) → ColModel by lowercased name; fetched once per file. */
const colLibCache = new Map<string, Promise<Map<string, ColModel>>>();
const prelit = { double: false, on: true };
let collisionOn = false;
let wireframeOn = false;

async function addModel(model: ModelEntry): Promise<void> {
  if (loaded.has(model.dff)) {
    return;
  }
  const base = model.dff.replace(/\.dff$/i, '');
  await viewer.ready;
  // A server side may be CONVERTED (own-engine `.osm`): try that first — it decodes with the game's own
  // `readModelOsm`, textures inside — and fall back to the stock DFF+TXD path (404 ⇒ this side is stock).
  const osm = model.server ? await fetchOsm(model.server, base) : null;
  if (loaded.has(model.dff)) {
    return; // a second tick raced us while the bytes were in flight
  }
  let view;
  if (osm) {
    try {
      view = loadModelFromOsm(viewer.engine, base, osm);
    } catch (error) {
      // A world-textured map object can't be shown standalone (textures in the shared pak) — skip it.
      // eslint-disable-next-line no-console -- the reason belongs in the console
      console.warn(`[object] ${base}: ${error instanceof Error ? error.message : String(error)}`);

      return;
    }
  } else {
    const [dff, txd] = await Promise.all([
      fetchDff(model, base),
      model.server ? loadServerTxd(model.server, base) : loadTxd(model.txd),
    ]);
    if (loaded.has(model.dff)) {
      return;
    }
    view = loadModel(viewer.engine, dff, txd ? [txd] : []);
  }
  loaded.set(model.dff, view);
  view.showWireframe(wireframeOn);
  const col = await loadCollision(model);
  if (col) {
    view.setCollision(col);
    view.showCollision(collisionOn);
  }
  updatePolyCount();
  if (loaded.size === 1) {
    frameAll();
  }
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

/** Prelit is one engine scale: off = neutral white, on = as authored, ×2 = SA's MODULATE2X. */
function applyPrelit(): void {
  viewer.engine.debugPrelitScale = prelit.on ? (prelit.double ? 2 : 1) : 0;
}

function buildControls(): void {
  const panel = document.createElement('div');
  panel.className = 'panel';

  // Two multi-select lists split by the `lod` prefix — full-detail (HD) vs LOD — overlaid for comparison.
  // Populated on demand from the compare server (`--after`) via the autocomplete box (an added HD also lists
  // its LOD, resolved server-side from the IPL lod-index).
  const sections = { hd: makeSection(panel, 'HD'), lod: makeSection(panel, 'LOD') };

  const addRow = (model: ModelEntry, checked = false): void => {
    if (entriesByDff.has(model.dff)) {
      return; // already listed (e.g. typed twice into the compare-server box)
    }
    entriesByDff.set(model.dff, model);
    const section = model.dff.toLowerCase().startsWith('lod') ? sections.lod : sections.hd;
    const row = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.addEventListener('change', () => (checkbox.checked ? void addModel(model) : removeModel(model)));
    row.append(checkbox, document.createTextNode(` ${model.name}`));
    section.list.appendChild(row);
    section.heading.textContent = `${section.title} (${section.list.childElementCount})`;
  };

  buildServerControls(panel, addRow);

  const frameButton = document.createElement('button');
  frameButton.textContent = 'Frame all';
  frameButton.addEventListener('click', frameAll);
  const clearButton = document.createElement('button');
  clearButton.textContent = 'Clear all';
  clearButton.addEventListener('click', () => {
    for (const dff of [...loaded.keys()]) {
      const model = entriesByDff.get(dff);
      if (model) {
        removeModel(model);
      }
    }
    for (const input of panel.querySelectorAll<HTMLInputElement>('.model-list input')) {
      input.checked = false;
    }
  });
  panel.append(frameButton, clearButton);

  // The debug view knobs. Unlike the three era these are ENGINE features (074/13 phase 4): the prelit
  // scale and unlit flag ride spare frame-uniform lanes, the wireframes are a line-list pipeline. So
  // what they show is the shipping renderer with one term changed — not a second shading path.
  addToggle(panel, 'Lit', !viewer.engine.debugUnlit, (on) => {
    viewer.engine.debugUnlit = !on;
  });
  addToggle(panel, 'Prelit vertex colours', true, (on) => {
    prelit.on = on;
    applyPrelit();
  });
  addToggle(panel, 'Prelit ×2 (MODULATE2X)', false, (on) => {
    prelit.double = on;
    applyPrelit();
  });
  addToggle(panel, 'Collision', false, (on) => {
    collisionOn = on;
    for (const model of loaded.values()) {
      model.showCollision(on);
    }
  });
  addToggle(panel, 'Wireframe (polygon mesh)', false, (on) => {
    wireframeOn = on;
    for (const model of loaded.values()) {
      model.showWireframe(on);
    }
  });

  panel.appendChild(polyLabel);
  updatePolyCount();

  document.body.appendChild(panel);
  // e2e only: render the static fixtures (fixtures/viewer, served at /viewer). Dev stays compare-server-driven.
  if (import.meta.env.MODE === 'e2e') {
    void loadFixtures(addRow);
  }
}

/**
 * Compare-server autocomplete (same list as the Compare tab, but the `--after` side only). A model name typed
 * here loads its `--after` DFF/TXD from the server and overlays it like any other object-tab model.
 */
function buildServerControls(panel: HTMLElement, addRow: (model: ModelEntry, checked?: boolean) => void): void {
  const heading = document.createElement('div');
  heading.className = 'list-title';
  heading.textContent = 'Compare server (--after)';

  const server = document.createElement('input');
  server.value = DEFAULT_SERVER;
  server.title = 'compare server URL';

  const input = document.createElement('input');
  input.placeholder = 'model name…';
  input.setAttribute('list', 'object-server-models');
  const datalist = document.createElement('datalist');
  datalist.id = 'object-server-models';

  const status = document.createElement('div');
  status.className = 'hint';

  const add = document.createElement('button');
  add.textContent = 'Add';

  const serverUrl = (): string => server.value.replace(/\/$/, '');
  const submit = (): void => {
    const name = input.value.trim().toLowerCase();
    if (!name) {
      return;
    }
    const model: ModelEntry = { dff: `${name}.dff`, name, server: serverUrl(), txd: '' };
    addRow(model, true);
    status.textContent = `loading ${name}…`;
    addModel(model).then(
      () => (status.textContent = name),
      (error: unknown) => (status.textContent = error instanceof Error ? error.message : String(error)),
    );
    void listCompanionLod(name, serverUrl(), addRow);
    input.value = '';
  };

  add.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submit();
    }
  });
  server.addEventListener('change', () => void loadServerModels(serverUrl(), datalist, status, input));

  panel.append(heading, server, input, datalist, add, status);
  // Skip the compare-server probe under e2e (no server there — a refused fetch would log a console error).
  if (import.meta.env.MODE !== 'e2e') {
    void loadServerModels(serverUrl(), datalist, status, input);
  }
}

async function fetchDff(model: ModelEntry, base: string): Promise<ArrayBuffer> {
  if (!model.server) {
    return fetch(`${BASE}/viewer/objects/${model.dff}`).then((response) => response.arrayBuffer());
  }
  const response = await fetch(`${model.server}/dff?side=after&model=${encodeURIComponent(base)}`);
  if (!response.ok) {
    throw new Error(`${base}: not found on --after`);
  }

  return response.arrayBuffer();
}

/** The CONVERTED `.osm` bytes from a compare-server side, or null when that side is stock (404 → use DFF). */
async function fetchOsm(server: string, base: string): Promise<ArrayBuffer | null> {
  const response = await fetch(`${server}/osm?side=after&model=${encodeURIComponent(base)}`);

  return response.ok ? response.arrayBuffer() : null;
}

/** Aim the orbit rig at the union of every loaded model. */
function frameAll(): void {
  if (!loaded.size) {
    return;
  }
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const model of loaded.values()) {
    const [x, y, z] = model.bounds.center;
    const r = model.bounds.radius;
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    minZ = Math.min(minZ, z - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
    maxZ = Math.max(maxZ, z + r);
  }

  viewer.orbit.frame(
    [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2) * 1.6,
  );
}

/**
 * After adding an HD model, also list its LOD so it shows in the LOD graph. The LOD is resolved server-side
 * from the IPL lod-index (ground truth), since SA LOD names don't follow a reliable pattern (`carlshou1_LAe2`
 * → `LOD1carlshou1_LAe`). Listed unchecked; tick it to overlay for comparison. Silent no-op if there's none.
 */
async function listCompanionLod(
  name: string,
  server: string,
  addRow: (model: ModelEntry, checked?: boolean) => void,
): Promise<void> {
  if (name.startsWith('lod')) {
    return; // already a LOD
  }
  try {
    const response = await fetch(`${server}/lod?side=after&model=${encodeURIComponent(name)}`);
    if (!response.ok) {
      return;
    }
    const lodName = (await response.json()) as string;
    if (lodName) {
      addRow({ dff: `${lodName}.dff`, name: lodName, server, txd: '' });
    }
  } catch {
    /* server unreachable — no companion listed */
  }
}

function loadColLibrary(file: string): Promise<Map<string, ColModel>> {
  let promise = colLibCache.get(file);
  if (!promise) {
    promise = fetch(`${BASE}/viewer/objects/${file}`)
      .then((response) => response.arrayBuffer())
      .then((buffer) => new Map(parseColLibrary(buffer).map((col) => [col.name.toLowerCase(), col])));
    colLibCache.set(file, promise);
  }

  return promise;
}

/** The model's COL: either a shared library (`model.col`, looked up by dff name) or `<model>.col.json`. */
async function loadCollision(model: ModelEntry): Promise<ColModel | null> {
  if (model.server) {
    return null; // the compare server serves no collision
  }
  const base = model.dff.replace(/\.dff$/i, '');
  if (model.col) {
    return (await loadColLibrary(model.col)).get(base.toLowerCase()) ?? null;
  }
  const response = await fetch(`${BASE}/viewer/objects/${base}.col.json`);
  if (!response.ok) {
    return null;
  }
  const json = (await response.json()) as ColJson;

  return { ...json, vertices: new Float32Array(json.vertices) };
}

/**
 * `--mode e2e` only: list + auto-render the object fixtures from `objects/manifest.json` (extracted by
 * `npm run test:fixtures` into the gitignored `fixtures/viewer/`, served at `/viewer`). Lets the object-viewer
 * e2e render real geometry without the compare server or the full game. A 404 (dev) is a silent no-op.
 */
async function loadFixtures(addRow: (model: ModelEntry, checked?: boolean) => void): Promise<void> {
  const response = await fetch(`${BASE}/viewer/objects/manifest.json`);
  if (!response.ok) {
    return;
  }
  const models = (await response.json()) as ModelEntry[];
  models.forEach((model, index) => {
    addRow(model, index === 0);
    if (index === 0) {
      void addModel(model);
    }
  });
}

/** Fetch the `--after` model list into the datalist (autocomplete). */
async function loadServerModels(
  server: string,
  datalist: HTMLDataListElement,
  status: HTMLElement,
  input: HTMLInputElement,
): Promise<void> {
  try {
    const response = await fetch(`${server}/models?side=after`);
    if (!response.ok) {
      status.textContent = `compare server not reachable at ${server}`;

      return;
    }
    const models = (await response.json()) as string[];
    datalist.replaceChildren(...models.map((name) => Object.assign(document.createElement('option'), { value: name })));
    status.textContent = `${models.length} model(s) on --after`;
    input.placeholder = 'model name (autocomplete)…';
  } catch {
    status.textContent = `compare server not reachable at ${server}`;
  }
}

/** Textures for a compare-server model: its TXD is resolved from the `--after` IDEs server-side (404 → none). */
function loadServerTxd(server: string, base: string): Promise<ArrayBuffer | null> {
  const key = `server:${server}:${base}`;
  let promise = txdCache.get(key);
  if (!promise) {
    promise = fetch(`${server}/txd?side=after&model=${encodeURIComponent(base)}`).then((response) =>
      response.ok ? response.arrayBuffer() : null,
    );
    txdCache.set(key, promise);
  }

  return promise;
}

function loadTxd(txd: string): Promise<ArrayBuffer | null> {
  let promise = txdCache.get(txd);
  if (!promise) {
    promise = fetch(`${BASE}/viewer/objects/${txd}`).then((response) => (response.ok ? response.arrayBuffer() : null));
    txdCache.set(txd, promise);
  }

  return promise;
}

/** A labelled, scrollable list section appended to the panel. */
function makeSection(
  panel: HTMLElement,
  title: string,
): { heading: HTMLDivElement; list: HTMLDivElement; title: string } {
  const heading = document.createElement('div');
  heading.className = 'list-title';
  heading.textContent = title;
  const list = document.createElement('div');
  list.className = 'model-list';
  panel.append(heading, list);

  return { heading, list, title };
}

function removeModel(model: ModelEntry): void {
  const entry = loaded.get(model.dff);
  if (!entry) {
    return;
  }
  entry.dispose();
  loaded.delete(model.dff);
  updatePolyCount();
}

/** Sum the triangle count of every loaded (overlaid) model and show it. */
function updatePolyCount(): void {
  let triangles = 0;
  for (const model of loaded.values()) {
    triangles += model.triangles;
  }
  polyLabel.textContent = `Triangles: ${Math.round(triangles).toLocaleString()} (${loaded.size} obj)`;
}

buildControls();
viewer.start();
