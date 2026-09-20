/**
 * Standalone vehicle viewer — a dev tool to inspect a car in isolation: select a body part, open/close its
 * door (button or `E`), swap it to its damaged mesh, and toggle the collision wireframe and the low-detail
 * `chassis_vlo` LOD.
 *
 * Ported onto the own engine in plan 074/13 phase 4. It reuses the real build path
 * (`parseDff` → `buildVehicleModel` → the engine's rigid upload), so what you see is what the game builds:
 * damage twins, the `_vlo` LOD and the door hinges are all the ENGINE's own per-submesh visibility and
 * part rotation, not viewer-side scene-graph surgery.
 *
 * Vehicles are loaded from the compare server (`--after` side); the autocomplete list comes from that side's
 * `vehicles.ide`. Run `npx tsx tools/map-optimizer/src/compare-serve.ts --before <dir> --after <dir>` alongside
 * `npm run dev`. Open at /viewer.html?tab=vehicle.
 */
import type { VehicleDoor } from '@opensa/renderware';
import type { ColModel } from '@opensa/renderware/parsers/binary/col-types';

import { parseDffCollision } from '@opensa/renderware/parsers/binary/col';

import type { Bounds, ViewedModel } from './engine/model-view';

import { loadModel, loadModelFromOsm } from './engine/model-view';
import { createViewerEngine } from './engine/viewer-engine';

/**
 * Debug paint (the carcol markers become these) + a neutral wheel scale.
 * 0..1 — the engine's `setPaint` space, NOT the 0..255 the three viewer used (255-scale values saturate
 * every paint slot to white, which reads as "the carcols markers were not found" and is a trap).
 */
const PRIMARY: readonly [number, number, number] = [0.78, 0.16, 0.16];
const SECONDARY: readonly [number, number, number] = [0.16, 0.2, 0.27];
const WHEEL_SCALE: [number, number] = [0.7, 0.7];
const DOOR_OPEN_ANGLE = -Math.PI / 3;

/** Compare server (same as the Compare/Object tabs); vehicles load from its `--after` side. */
const DEFAULT_SERVER = 'http://localhost:3002';
let serverUrl = DEFAULT_SERVER;

const viewer = createViewerEngine();

const partSelect = document.createElement('select');
const collisionToggle = document.createElement('input');
const lodToggle = document.createElement('input');
const wireframeToggle = document.createElement('input');
/** Live triangle count of the current car. */
const polyLabel = Object.assign(document.createElement('div'), { className: 'hint' });

let current: null | ViewedModel = null;
/** The door list — only the DFF (`VehicleModelData`) path carries it; a converted `.osm` has none (its parts
 *  are there, but not the door-hinge metadata the animation UI needs), so the door feature is DFF-only. */
let doors: readonly VehicleDoor[] = [];
let selectedPart = 0;
/** COL bounds of the current car — clamps the selection box (modded DFFs blow up the mesh bbox). */
let colBounds: Bounds | null = null;
const doorOpen = new Set<number>();
const damaged = new Set<string>();

function addButton(parent: HTMLElement, label: string, onClick: () => void): void {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', onClick);
  parent.appendChild(button);
}

function addToggle(parent: HTMLElement, label: string, input: HTMLInputElement, onChange: () => void): void {
  const wrapper = document.createElement('label');
  input.type = 'checkbox';
  input.addEventListener('change', onChange);
  wrapper.append(input, document.createTextNode(` ${label}`));
  parent.appendChild(wrapper);
}

/**
 * Submesh visibility is the ONE place LOD and damage meet: `lod` submeshes replace everything else, and
 * within the body set each damage group shows either its intact or its damaged twin. Computed from
 * scratch every time so the two toggles can never disagree about who owns a submesh.
 */
function applyVisibility(): void {
  if (!current) {
    return;
  }
  const showLod = lodToggle.checked && current.data.submeshes.some((submesh) => submesh.kind === 'lod');
  const shownExtra = firstExtra(current.data.submeshes);

  current.data.submeshes.forEach((submesh, index) => {
    let visible: boolean;
    if (showLod) {
      visible = submesh.kind === 'lod';
    } else if (submesh.kind === 'lod') {
      visible = false;
    } else {
      const isDamaged = submesh.damageGroup !== null && damaged.has(submesh.damageGroup);
      visible = submesh.kind === 'dam' ? isDamaged : !isDamaged;
    }
    // A model ships every `extraN` alternative and the game picks one per spawn; the viewer inspects a
    // MODEL, so it shows the first and hides the rest rather than stacking them on top of each other.
    if (submesh.extra && submesh.extra !== shownExtra) {
      visible = false;
    }
    current?.instance.setSubmeshVisible(index, visible);
  });
}

function buildControls(): void {
  const panel = document.createElement('div');
  panel.className = 'panel';

  const server = document.createElement('input');
  server.value = DEFAULT_SERVER;
  server.title = 'compare server URL';
  const input = document.createElement('input');
  input.placeholder = 'vehicle name…';
  input.setAttribute('list', 'vehicle-models');
  const datalist = document.createElement('datalist');
  datalist.id = 'vehicle-models';
  const status = document.createElement('div');
  status.className = 'hint';
  const submit = (): void => {
    const name = input.value.trim().toLowerCase();
    if (name) {
      void loadVehicle(name, status);
    }
  };
  addButton(panel, 'Load', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submit();
    }
  });
  server.addEventListener('change', () => {
    serverUrl = server.value.replace(/\/$/, '');
    void loadVehicleList(datalist, status);
  });
  panel.append(server, input, datalist, status, partSelect);

  partSelect.addEventListener('change', () => selectPart(Number(partSelect.value)));

  const rule = document.createElement('hr');
  panel.appendChild(rule);
  addButton(panel, 'Open / close door (E)', toggleDoor);
  addButton(panel, 'Damage / repair part', toggleDamage);
  panel.appendChild(rule.cloneNode());
  addToggle(panel, 'Collision', collisionToggle, () => current?.showCollision(collisionToggle.checked));
  addToggle(panel, 'LOD (chassis_vlo)', lodToggle, applyVisibility);
  addToggle(panel, 'Wireframe (polygon mesh)', wireframeToggle, () => current?.showWireframe(wireframeToggle.checked));
  panel.appendChild(polyLabel);

  document.body.appendChild(panel);
  void loadVehicleList(datalist, status);
}

/** The door hinged on the selected part, if it is one. */
function doorOf(part: number): undefined | VehicleDoor {
  const name = current?.data.parts[part]?.name;

  return doors.find((entry) => entry.name === name || `door_${entry.side}` === name);
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

/** The alternative a model viewer shows out of a set that only a spawn can choose between. */
function firstExtra(submeshes: readonly { extra?: null | string }[]): null | string {
  return submeshes.find((submesh) => !!submesh.extra)?.extra ?? null;
}

/** Frame the car by its COL bounds when it has them, else by the mesh. */
function frameCar(): void {
  if (!current) {
    return;
  }
  if (!colBounds) {
    viewer.orbit.frame(current.bounds.center, current.bounds.radius * 2.2);

    return;
  }
  const { max, min } = colBounds;
  // COL bounds are native Z-up; the orbit rig works in engine (Y-up) space.
  viewer.orbit.frame(
    [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2, -(min[1] + max[1]) / 2],
    Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2) * 2.2,
  );
}

async function loadVehicle(name: string, status?: HTMLElement): Promise<void> {
  if (status) {
    status.textContent = `loading ${name}…`;
  }
  let osm: ArrayBuffer | null = null;
  let dffBuffer: ArrayBuffer | null = null;
  try {
    // AFTER may be a converted build (`.osm`): try that first, fall back to the stock DFF+TXD.
    osm = await fetchOsm(name);
    let txdBuffer: ArrayBuffer | null = null;
    if (!osm) {
      [dffBuffer, txdBuffer] = await Promise.all([fetchServer('dff', name), fetchServer('txd', name)]);
    }
    await viewer.ready;
    current?.dispose();
    doorOpen.clear();
    damaged.clear();
    if (osm) {
      // The converted car renders + paints + toggles submesh LOD/damage; doors (hinge metadata) and the
      // mesh COL overlay are DFF-only, so they degrade quietly here.
      current = loadModelFromOsm(viewer.engine, name, osm);
      doors = [];
    } else {
      const view = loadModel(viewer.engine, dffBuffer!, [txdBuffer!], { wheelScale: WHEEL_SCALE });
      current = view;
      doors = view.data.doors;
    }
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }

    return;
  }

  current.instance.setPaint({
    primary: PRIMARY,
    quaternary: SECONDARY,
    secondary: SECONDARY,
    tertiary: PRIMARY,
  });

  const col: ColModel | null = dffBuffer ? parseDffCollision(dffBuffer) : null;
  if (col) {
    current.setCollision(col);
    current.showCollision(collisionToggle.checked);
    // The authored COL is clean; the mesh bbox is not (modded DFFs like admiral carry stray vertices).
    colBounds = { max: [...col.bounds.max], min: [...col.bounds.min] };
  } else {
    colBounds = null;
  }

  rebuildPartSelect();
  applyVisibility();
  current.showWireframe(wireframeToggle.checked);
  polyLabel.textContent = `Triangles: ${Math.round(current.triangles).toLocaleString()}`;
  frameCar();
  if (status) {
    status.textContent = name;
  }
}

/** Fetch the `--after` vehicle list (from `vehicles.ide`) into the datalist. */
async function loadVehicleList(datalist: HTMLDataListElement, status: HTMLElement): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/models?side=after&kind=vehicle`);
    if (!response.ok) {
      status.textContent = `compare server not reachable at ${serverUrl}`;

      return;
    }
    const names = (await response.json()) as string[];
    datalist.replaceChildren(...names.map((name) => Object.assign(document.createElement('option'), { value: name })));
    status.textContent = `${names.length} vehicle(s) on --after`;
  } catch {
    status.textContent = `compare server not reachable at ${serverUrl}`;
  }
}

function rebuildPartSelect(): void {
  partSelect.replaceChildren();
  current?.data.parts.forEach((part, index) => partSelect.append(new Option(part.name, String(index))));
  selectPart(0);
}

/** The box tracks the part's LIVE pose, so it follows a door that is standing open. */
function refreshHighlight(): void {
  const door = doorOf(selectedPart);
  const angle = door && doorOpen.has(door.part) ? DOOR_OPEN_ANGLE : 0;
  current?.highlightPart(selectedPart, {
    ...(colBounds ? { clamp: colBounds } : {}),
    rotation: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)],
  });
}

function selectPart(index: number): void {
  selectedPart = index;
  partSelect.value = String(index);
  refreshHighlight();
}

/** Swap the selected part's damage group to its `_dam` twin (or back). */
function toggleDamage(): void {
  const group = current?.data.submeshes.find(
    (submesh) => submesh.part === selectedPart && submesh.damageGroup !== null,
  )?.damageGroup;
  if (!group) {
    return;
  }
  if (damaged.has(group)) {
    damaged.delete(group);
  } else {
    damaged.add(group);
  }
  applyVisibility();
}

function toggleDoor(): void {
  const door = doorOf(selectedPart);
  if (!current || !door) {
    return;
  }
  const open = !doorOpen.has(door.part);
  if (open) {
    doorOpen.add(door.part);
  } else {
    doorOpen.delete(door.part);
  }
  // The hinge is the part's own Z axis; the engine composes this over the bind pose.
  const half = (open ? DOOR_OPEN_ANGLE : 0) / 2;
  current.instance.entity.setPartRotation(door.part, [0, 0, Math.sin(half), Math.cos(half)]);
  refreshHighlight(); // the door moved — the box follows it
}

window.addEventListener('keydown', (event) => {
  // `key` is absent on some synthetic keydowns (datalist autocomplete pick, IME/autofill) — guard it.
  if (event.key?.toLowerCase() === 'e') {
    toggleDoor();
  }
});
buildControls();
viewer.start();
