/**
 * Standalone character viewer — a dev tool to inspect a skinned ped in isolation: pick an animation clip
 * from `ped.ifp`, loop it or play it once, and toggle the skeleton, the collision capsule and the mesh
 * wireframe.
 *
 * Ported onto the own engine in plan 074/13 phase 4. It reuses the real build path
 * (`parseDff` → `buildPedModel` → `engine.setPedProbe`, animated by the engine's own `IfpSampler`), so a
 * bad bind pose or a mismatched bone track here is the same one the game would show.
 *
 * Peds are loaded from the compare server (`--after` side); the list comes from that side's `peds.ide` and
 * the clips from its `anim/ped.ifp`. Run
 * `npx tsx tools/map-optimizer/src/compare-serve.ts --before <dir> --after <dir>` alongside `npm run dev`.
 * Open at /viewer.html?tab=character.
 */
import type { IfpAnimation } from '@opensa/renderware';

import { parseIfp } from '@opensa/renderware/parsers/binary/ifp';

import type { ViewedPed } from './engine/ped-view';

import { loadPed, loadPedFromOsm } from './engine/ped-view';
import { boxLines, createViewerEngine } from './engine/viewer-engine';

/** Mirrors the game's PLAYER_HALF_EXTENTS: feet at z = 0, so the box stands on the ground. */
const HALF: readonly [number, number, number] = [0.3, 0.3, 0.9];
const DEFAULT_CLIP = 'IDLE_stance';

/** Compare server (same as the other tabs); peds load from its `--after` side. */
const DEFAULT_SERVER = 'http://localhost:3002';
let serverUrl = DEFAULT_SERVER;

const viewer = createViewerEngine();

const clipSelect = document.createElement('select');
const loopToggle = document.createElement('input');
const skeletonToggle = document.createElement('input');
const collisionToggle = document.createElement('input');
const wireframeToggle = document.createElement('input');
const polyLabel = Object.assign(document.createElement('div'), { className: 'hint' });

let current: null | ViewedPed = null;
/** Parsed once per server — the whole `ped.ifp`, shared by every ped from that side. */
let animations: null | Promise<IfpAnimation[]> = null;
let capsule: null | number = null;

function addToggle(parent: HTMLElement, label: string, input: HTMLInputElement, onChange: () => void): void {
  const wrapper = document.createElement('label');
  input.type = 'checkbox';
  input.addEventListener('change', onChange);
  wrapper.append(input, document.createTextNode(` ${label}`));
  parent.appendChild(wrapper);
}

/** The player capsule as a static box — the game's collision shape, not the mesh's. */
function applyCapsule(): void {
  if (capsule === null && collisionToggle.checked) {
    capsule = viewer.engine.createDebugLines(
      boxLines([-HALF[0], 0, -HALF[1]], [HALF[0], HALF[2] * 2, HALF[1]]),
      [0, 1, 0.53, 1],
    );
  }
  if (capsule !== null) {
    viewer.engine.setDebugLinesVisible(capsule, collisionToggle.checked);
  }
}

function buildControls(): void {
  const panel = document.createElement('div');
  panel.className = 'panel';

  const server = document.createElement('input');
  server.value = DEFAULT_SERVER;
  server.title = 'compare server URL';
  const input = document.createElement('input');
  input.placeholder = 'ped name…';
  input.setAttribute('list', 'ped-models');
  const datalist = document.createElement('datalist');
  datalist.id = 'ped-models';
  const status = document.createElement('div');
  status.className = 'hint';

  const submit = (): void => {
    const name = input.value.trim().toLowerCase();
    if (name) {
      void loadCharacter(name, status);
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
    animations = null; // clips are per-side
    void loadPedList(datalist, status);
  });

  panel.append(server, input, datalist, load, status, clipSelect);
  clipSelect.addEventListener('change', playSelected);

  addToggle(panel, 'Loop', loopToggle, playSelected);
  addToggle(panel, 'Skeleton', skeletonToggle, () => current?.showSkeleton(skeletonToggle.checked));
  addToggle(panel, 'Collision (capsule)', collisionToggle, applyCapsule);
  addToggle(panel, 'Wireframe (polygon mesh)', wireframeToggle, () => current?.showWireframe(wireframeToggle.checked));

  const hint = Object.assign(document.createElement('div'), { className: 'hint' });
  hint.textContent = 'click scene to replay';
  panel.append(hint, polyLabel);

  document.body.appendChild(panel);
  loopToggle.checked = true;
  skeletonToggle.checked = true;
  viewer.canvas.addEventListener('click', playSelected);
  void loadPedList(datalist, status);
}

/** The CONVERTED `.osm` bytes from the `--after` side, or null when it's stock (404 → use DFF+TXD). */
async function fetchOsm(model: string): Promise<ArrayBuffer | null> {
  const response = await fetch(`${serverUrl}/osm?side=after&model=${encodeURIComponent(model)}`);

  return response.ok ? response.arrayBuffer() : null;
}

async function fetchServer(endpoint: 'dff' | 'txd', model: string): Promise<ArrayBuffer> {
  const response = await fetch(`${serverUrl}/${endpoint}?side=after&model=${encodeURIComponent(model)}`);
  if (!response.ok) {
    throw new Error(`${model}: ${endpoint} not found on --after`);
  }

  return response.arrayBuffer();
}

/** `ped.ifp` from the `--after` game dir, parsed once and shared by every ped on that side. */
function loadAnimations(): Promise<IfpAnimation[]> {
  animations ??= fetch(`${serverUrl}/ifp?side=after`)
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .then((bytes) => (bytes ? parseIfp(bytes) : []));

  return animations;
}

async function loadCharacter(name: string, status: HTMLElement): Promise<void> {
  status.textContent = `loading ${name}…`;
  try {
    // AFTER may be a converted build (`.osm`): try that first, fall back to the stock DFF+TXD.
    const [osm, clips] = await Promise.all([fetchOsm(name), loadAnimations()]);
    await viewer.ready;
    current?.dispose();
    if (osm) {
      current = loadPedFromOsm(viewer.engine, name, osm, clips);
    } else {
      const [dff, txd] = await Promise.all([fetchServer('dff', name), fetchServer('txd', name)]);
      current = loadPed(viewer.engine, dff, [txd], clips);
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);

    return;
  }

  if (!current) {
    status.textContent = `${name}: not skinned (no skeleton)`;
    polyLabel.textContent = '';

    return;
  }

  clipSelect.replaceChildren(
    ...current.clipNames.map((clip) =>
      Object.assign(document.createElement('option'), { textContent: clip, value: clip }),
    ),
  );
  clipSelect.value = current.clipNames.includes(DEFAULT_CLIP) ? DEFAULT_CLIP : (current.clipNames[0] ?? '');
  playSelected();

  current.showSkeleton(skeletonToggle.checked);
  current.showWireframe(wireframeToggle.checked);
  applyCapsule();
  polyLabel.textContent = `Triangles: ${Math.round(current.data.indices.length / 3).toLocaleString()}`;
  viewer.orbit.frame(current.bounds.center, current.bounds.radius * 2.4);
  status.textContent = `${name} — ${current.clipNames.length} clip(s)`;
}

/** Fetch the `--after` ped list (from `peds.ide`) into the datalist. */
async function loadPedList(datalist: HTMLDataListElement, status: HTMLElement): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/models?side=after&kind=ped`);
    if (!response.ok) {
      status.textContent = `compare server not reachable at ${serverUrl}`;

      return;
    }
    const names = (await response.json()) as string[];
    datalist.replaceChildren(...names.map((name) => Object.assign(document.createElement('option'), { value: name })));
    status.textContent = `${names.length} ped(s) on --after`;
  } catch {
    status.textContent = `compare server not reachable at ${serverUrl}`;
  }
}

function playSelected(): void {
  if (clipSelect.value) {
    current?.play(clipSelect.value, loopToggle.checked);
  }
}

buildControls();
viewer.start((dt) => current?.update(dt));
