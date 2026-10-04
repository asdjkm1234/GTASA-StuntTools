import type { OspakManifest } from '@opensa/engine-formats';

import { ospakRequiredFeatures, validateOspakManifest } from '@opensa/engine-formats';

/**
 * Streaming-mode bootstrap (plan 074/05): manifest → worker (pak lives worker-side) → texture arrays
 * (eagerly for a pre-`textures` pak; PER RING otherwise, driven by the streamer) → a ready StreamingDriver.
 *
 * The first two of those need no GPU, and are reachable on their own as `openPakSource` so a host can run
 * them BESIDE `engine.init` rather than after it (201/4-03).
 */
import type { Engine } from '../engine';
import type { PakWorkerRequest, PakWorkerResponse } from './pak-worker';

import { PakCollisionSource } from './collision-source';
import { createDefaultPakWorker } from './default-pak-worker';
import { pakTraffic, postPakFetch } from './pak-traffic';
import { StreamingDriver, type StreamingRadii } from './streaming';

/**
 * A picked-folder pak source (folder mode): opens `manifest.json` / `world.ospak` / `water.bin` as disk-backed
 * Blobs from the install's `opensa/` folder. `null` ⇒ the file is absent, and the caller fails loudly rather
 * than silently reading the app's `public/` (the pak-source bug: the loading MODE must select the world).
 */
export interface LocalPakSource {
  open(name: string): Promise<Blob | null>;
}

/**
 * The half of a pak open that needs no GPU: the manifest, and a worker whose IO mode is probed and whose
 * slice cache is open. Split out so a host can START it beside `engine.init` (201/4-03) — the two contend
 * for nothing, one being a driver compiling shaders and the other a radio fetching bytes, and the GPU side
 * alone measured 2 607.5 ms on the phone. Hand the result to `setupStreaming` as `opened`; a caller that
 * does not want the overlap omits it and the setup opens the source itself, exactly as before.
 *
 * The worker belongs to whoever opened it until `setupStreaming` takes it: a host that starts this and then
 * fails before the handover has to `terminate()` it, or it idles for the rest of the session.
 */
export interface OpenedPak {
  readonly manifest: OspakManifest;
  readonly worker: Worker;
}

/** Where the world pak lives: a URL base (HTTP/fetch mode) or a picked-folder source (folder mode). */
export type PakSource = LocalPakSource | string;

/** How the host wants its pak worker built. Everything else about streaming is the engine's business. */
export interface StreamingHost {
  /**
   * Build the pak IO worker. Absent = the module-relative default, which is what every multi-file build
   * wants: Vite emits `assets/pak-worker-*.js` beside the entry and the URL below resolves to it.
   *
   * A host passes one when its bundle cannot serve that file — a SINGLE-FILE artifact is the case this
   * exists for (201/2-02): the chunk is not there, and the console 404s on the worker with the manifest
   * already fetched, which reads as a hang rather than a missing file. Such a host inlines the worker
   * itself (`?worker&inline`) and hands the constructor over, so the engine never learns how it was built.
   */
  readonly createWorker?: () => Worker;
}

export interface StreamSetup {
  /** When the pak was built (opensa-pack manifest `buildTime`, `HH:mm DD-MM-YYYY`) — the debugger shows it so
   *  the running pak version is visible. Absent for a pak converted before the field existed. */
  buildTime?: string;
  /** The pak's cell grid pitch (world units) — the map inspector's grid maths, and the truth over the
   *  runtime config's copy, which a pak converted at another size would contradict. */
  cellSize: number;
  center: [number, number, number];
  /** Baked cell collision (200/3-01), when the pak carries it — the host hands this to whatever streams
   *  collision, and a pak built without `--bake-collision` simply has none. */
  collision?: PakCollisionSource;
  /** Let the pak worker and the streaming go (201/6-03) — a host that can swap what draws the world calls
   *  this before it starts the next one. */
  dispose: () => void;
  /** Baked district table pointer (201/5-03) — a loose `districts.json` next to the manifest, holding
   *  `info.zon`'s boxes with their GXT text already resolved. Absent when the game ships no `info.zon`, or
   *  on a pak built before the field existed. */
  districts?: OspakManifest['districts'];
  driver: StreamingDriver;
  radius: number;
  /** Baked water mesh pointer (074/06 row 12 v2) — a loose binary next to the manifest. */
  water?: OspakManifest['water'];
}

export async function openPakSource(source: PakSource = '/pak', host: StreamingHost = {}): Promise<OpenedPak> {
  const manifest = await loadManifest(source);
  validateOspakManifest(manifest);

  // Folder mode hands the worker the pak Blob (read off disk); HTTP mode hands it the `world.ospak` URL.
  const pakInit: PakWorkerRequest =
    typeof source === 'string'
      ? {
          ...(manifest.buildTime !== undefined ? { buildTime: manifest.buildTime } : {}),
          type: 'init',
          url: `${source}/world.ospak`,
        }
      : { blob: await openLocal(source, 'world.ospak'), type: 'init' };
  const worker = host.createWorker ? host.createWorker() : createDefaultPakWorker();
  // The one place a cache hit is counted (201/4-03). `postPakFetch` counts what the world ASKED for; this
  // says how much of it the disk answered, and a capture that reports both is the only way to see the cache
  // working on a device with no devtools.
  worker.addEventListener('message', (event: MessageEvent<PakWorkerResponse>): void => {
    const message = event.data;
    if (message.type === 'blob' && message.cached === true) {
      pakTraffic.recordCacheHit(message.wire ?? 0);
    }
  });
  await new Promise<void>((resolve, reject) => {
    worker.addEventListener(
      'message',
      (event: MessageEvent<PakWorkerResponse>): void => {
        if (event.data.type === 'ready') {
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve();
          }
        }
      },
      { once: true },
    );
    worker.postMessage(pakInit);
  });

  return { manifest, worker };
}

/**
 * Can this device display this world? Asked ONCE, from the manifest, before a single cell streams.
 *
 * The demand belongs to the content and is decided by the converter — a pak built from SA assets is BC
 * throughout, and mobile GPUs ship ETC2/ASTC and never BC. `beginOstexUpload` catches that too, but only when
 * the first array reaches the upload drain: by then the boot looks successful, the world is streaming, and
 * the message arrives as one texture's name. Read from the manifest it is a property of the WORLD, stated
 * before anything is loaded — which is also the difference between telling a phone "your browser cannot run
 * this" (false) and "this world needs a BC-capable GPU" (true).
 */
export function requireWorldSupport(
  device: { features: { has(name: string): boolean } },
  manifest: OspakManifest,
): void {
  const missing = ospakRequiredFeatures(manifest).filter((feature) => !device.features.has(feature));
  if (missing.length > 0) {
    throw new Error(
      `this world's textures need GPU feature(s) this device does not have: ${missing.join(', ')}. ` +
        `The format was chosen when the pak was built and cannot be changed at runtime — build the world for ` +
        `this device (opensa-pack --rgba8) or run it on a GPU that carries the feature.`,
    );
  }
}

export async function setupStreaming(
  engine: Engine,
  source: PakSource = '/pak',
  radii: StreamingRadii = {},
  host: StreamingHost = {},
  opened?: OpenedPak,
): Promise<StreamSetup> {
  const { manifest, worker } = opened ?? (await openPakSource(source, host));
  requireWorldSupport(engine.device, manifest);
  // UV-scroll animations (B7·c / plan 074/18): global by dict name, advanced engine-side; kind-4 draws slot in.
  engine.setUvAnimations(manifest.uvAnimations ?? []);
  // Missing-texture stand-ins (plan 085 row B): the highlight repaints these layers magenta on demand.
  engine.textures.setMissingLayers(manifest.missingLayers ?? []);

  // Texture arrays up-front — ONLY for a pak that does not say which cell needs which array (003 phase 4).
  // When every cell entry carries `textures`, the streaming driver loads an array with the first cell that
  // draws it and releases it with the last: the district's whole texture set (~1.7 GB on a full map) never
  // has to be resident, and boot stops paying for the far side of the world.
  const lazyTextures = Object.values(manifest.cells).every((entry) => entry.textures !== undefined);
  const textureEntries = lazyTextures ? [] : Object.entries(manifest.textures);
  await new Promise<void>((resolve) => {
    let remaining = textureEntries.length;
    if (remaining === 0) {
      resolve();

      return;
    }
    const listener = (event: MessageEvent<PakWorkerResponse>): void => {
      const message = event.data;
      if (message.type !== 'blob' || !message.key.startsWith('array-') || !message.buffer) {
        return;
      }
      engine.textures.load(Number(message.key.replace('array-', '')), new Uint8Array(message.buffer));
      remaining -= 1;
      if (remaining === 0) {
        worker.removeEventListener('message', listener);
        resolve();
      }
    };
    worker.addEventListener('message', listener);
    for (const [key, entry] of textureEntries) {
      postPakFetch(worker, key, entry);
    }
  });

  // District centre/extent from the cell keys (engine coords).
  const cellSize = manifest.cellSize ?? 250;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const key of Object.keys(manifest.cells)) {
    const [cx, cy] = key.split(',').map(Number);
    const x = (cx + 0.5) * cellSize;
    const z = -(cy + 0.5) * cellSize;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  const driver = new StreamingDriver(engine, manifest, worker, radii);

  return {
    ...(manifest.buildTime !== undefined ? { buildTime: manifest.buildTime } : {}),
    cellSize,
    center: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2],
    // Both fields or neither: `buildOspak` writes `collisionCellSize` with the entries and
    // `validateOspakManifest` rejects a manifest carrying one without the other.
    ...(manifest.collision !== undefined && manifest.collisionCellSize !== undefined
      ? { collision: new PakCollisionSource(manifest, worker) }
      : {}),
    ...(manifest.districts !== undefined ? { districts: manifest.districts } : {}),
    ...(manifest.water !== undefined ? { water: manifest.water } : {}),
    dispose: () => driver.dispose(),
    driver,
    radius: Math.max((maxX - minX) / 2, (maxZ - minZ) / 2, 400),
  };
}

/** Load + validate the manifest from either source (fetch URL or picked folder). */
async function loadManifest(source: PakSource): Promise<OspakManifest> {
  if (typeof source !== 'string') {
    return JSON.parse(await (await openLocal(source, 'manifest.json')).text()) as OspakManifest;
  }
  const response = await fetch(`${source}/manifest.json`);
  // `ok` alone does not mean a pak lives here: a dev server answers an unknown non-asset path with its SPA
  // `index.html` at HTTP 200, so the guard passed and `.json()` failed on the markup instead — the useless
  // `SyntaxError: Unexpected token '<', "<!doctype "...`. Sniff the body so the actionable message survives.
  const body = response.ok ? await response.text() : '';
  if (!response.ok || body.trimStart().startsWith('<')) {
    throw new Error(
      `no pak at ${source}/manifest.json — point the dev server's public dir at an opensa-pack output ` +
        `(the pmb 'opensa' target), or pass ?src=<dir> for one served elsewhere`,
    );
  }

  return JSON.parse(body) as OspakManifest;
}

/** Open a required pak file from a folder source, throwing a loud, actionable error when it is absent. */
async function openLocal(source: LocalPakSource, name: string): Promise<Blob> {
  const blob = await source.open(name);
  if (!blob) {
    throw new Error(
      `no pak ${name} in the picked folder — pick the game dir (build/<game>/opensa: self-contained, ` +
        `pak/ inside), or reconvert the install first`,
    );
  }

  return blob;
}
