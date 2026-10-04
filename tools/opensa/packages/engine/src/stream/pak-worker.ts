/**
 * Pak IO worker (plan 074/05): pak BYTES never touch the main thread (the 073 memory lesson).
 *
 * Two modes, auto-detected at init (074/10 integration round):
 * - RANGE mode — the server honours `Range:` (probed with `bytes=0-0` → 206): entries are fetched on
 *   demand as range slices; the multi-GB pak never resides in memory. The `.ospak` 4 KiB alignment exists
 *   for exactly this.
 * - WHOLE-PAK fallback — dev middlewares that ignore `Range` (some vite setups): fetch once, serve slices
 *   from worker memory (the M1 behaviour).
 *
 * RANGE mode also keeps its slices between sessions when the context allows it ([pak-cache](./pak-cache.ts),
 * plan 201/4-03) — a second open of the same district reads the pak off the disk instead of the network.
 * The whole-pak fallback is NOT cached: it is a dev-server shape, and the body it holds is the entire pak.
 */
import { decodeOswire, type OspakWireEnc, rebuildOscell } from '@opensa/engine-formats';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

import { openPakCache, type PakRangeCache } from './pak-cache';

export interface PakWorkerRequest {
  /** Folder mode (074/10 pak-source fix): the picked install's `world.ospak` as a disk-backed Blob. `slice()`
   *  reads ranges off disk in the worker, so the multi-GB pak never loads whole and never touches main. */
  blob?: Blob;
  /** The pak's `buildTime` — what the slice cache is keyed on. Absent ⇒ nothing is cached (see pak-cache). */
  buildTime?: string;
  /** Wire encoding of the entry (074/10 A1) — the worker decodes before transfer. */
  enc?: OspakWireEnc;
  key?: string;
  length?: number;
  offset?: number;
  type: 'fetch' | 'init';
  url?: string;
}

export interface PakWorkerResponse {
  buffer?: ArrayBuffer;
  /** The slice came from the range cache rather than the network — counted so a capture can prove it. */
  cached?: boolean;
  error?: string;
  key: string;
  /** Which IO mode init picked (surfaced to the HUD/logs). */
  mode?: 'local' | 'range' | 'whole';
  type: 'blob' | 'ready';
  /** The slice's WIRE length — what the request cost, which the decoded buffer no longer says. */
  wire?: number;
}

let pak: null | Uint8Array = null;
let pakBlob: Blob | null = null;
let pakUrl = '';
let rangeMode = false;
let rangeCache: PakRangeCache | undefined;

async function init(url: string, buildTime?: string): Promise<void> {
  pakUrl = url;
  // Probe: a 1-byte range request. 206 = the server slices; 200 = it ignored Range (falls through with
  // the whole body — abort it and go whole-pak once, not per entry).
  const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  if (probe.status === 206) {
    rangeMode = true;
    probe.body?.cancel().catch(() => undefined);
    rangeCache = await openPakCache(url, buildTime);
    self.postMessage({ key: '', mode: 'range', type: 'ready' } satisfies PakWorkerResponse);

    return;
  }
  if (!probe.ok) {
    throw new Error(`pak fetch ${probe.status}`);
  }
  pak = new Uint8Array(await probe.arrayBuffer());
  self.postMessage({ key: '', mode: 'whole', type: 'ready' } satisfies PakWorkerResponse);
}

/** Folder mode: the pak is a local Blob (a File handle). No probe — `slice()` ranges it straight off disk. */
function initLocal(blob: Blob): void {
  pakBlob = blob;
  self.postMessage({ key: '', mode: 'local', type: 'ready' } satisfies PakWorkerResponse);
}

async function serve(key: string, offset: number, length: number, enc?: OspakWireEnc): Promise<void> {
  let buffer: ArrayBuffer;
  let cached = false;
  if (pakBlob) {
    // Folder mode: slice the disk-backed Blob — the range read happens in the worker, off disk.
    buffer = await pakBlob.slice(offset, offset + length).arrayBuffer();
  } else if (rangeMode) {
    const hit = await rangeCache?.read(offset, length);
    if (hit) {
      buffer = hit;
      cached = true;
    } else {
      const response = await fetch(pakUrl, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (response.status !== 206) {
        throw new Error(`range fetch ${response.status} (server stopped honouring Range?)`);
      }
      buffer = await response.arrayBuffer();
      // Left running on purpose — the Response has already copied the bytes, and the frame does not wait
      // on the disk. The slice is stored BEFORE inflate, which is both smaller and the shape a re-read wants.
      rangeCache?.put(offset, length, buffer);
    }
  } else {
    if (!pak) {
      throw new Error('pak not initialized');
    }
    // slice() copies out of the worker-resident pak; the copy transfers (zero-copy handoff to main).
    buffer = (pak.buffer as ArrayBuffer).slice(offset, offset + length);
  }
  if (enc === 'deflate-raw' || enc === 'oswire-deflate-raw') {
    // Inflate WORKER-side (074/10 A1): main thread keeps receiving GPU-ready bytes.
    buffer = await new Response(
      new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
    ).arrayBuffer();
  }
  if (enc === 'oswire-deflate-raw') {
    // meshopt cell payloads (074/14 A1 stage 2): rebuild the exact raw `.oscell` before transfer.
    await MeshoptDecoder.ready;
    buffer = rebuildOscell(decodeOswire(new Uint8Array(buffer)), MeshoptDecoder).buffer as ArrayBuffer;
  }
  (self as unknown as Worker).postMessage(
    { buffer, cached, key, type: 'blob', wire: length } satisfies PakWorkerResponse,
    [buffer],
  );
}

self.onmessage = (event: MessageEvent<PakWorkerRequest>): void => {
  const message = event.data;
  if (message.type === 'init') {
    if (message.blob) {
      initLocal(message.blob);

      return;
    }
    if (message.url) {
      init(message.url, message.buildTime).catch((error: unknown) => {
        self.postMessage({
          error: error instanceof Error ? error.message : String(error),
          key: '',
          type: 'ready',
        } satisfies PakWorkerResponse);
      });
    }

    return;
  }
  if (
    message.type === 'fetch' &&
    message.key !== undefined &&
    message.offset !== undefined &&
    message.length !== undefined
  ) {
    const key = message.key;
    serve(key, message.offset, message.length, message.enc).catch((error: unknown) => {
      self.postMessage({
        error: error instanceof Error ? error.message : String(error),
        key,
        type: 'blob',
      } satisfies PakWorkerResponse);
    });
  }
};
