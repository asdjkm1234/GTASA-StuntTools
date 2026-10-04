/**
 * The flat map's content: one PMTiles archive on static storage, read by HTTP range requests (201/6-02).
 *
 * The whole pyramid is ONE file beside the pak, so the 2D mode adds no tile server, no directory of loose
 * PNGs and nothing for an operator to calibrate — the archive states the world square it was baked over and
 * the console projects GTA coordinates onto it exactly.
 *
 * Two failures this file refuses to have silently:
 *
 * - **a server that ignores `Range`** answers `200` with the WHOLE archive, and a reader that trusts the
 *   body would decode the header as tile pixels. The status is checked, and a full body is sliced instead;
 * - **an archive baked over a different square** would draw a plausible city in the wrong place. The scheme
 *   comes out of the archive's own metadata, and a file that does not carry one is refused by name.
 */
import {
  decodePmtilesDirectory,
  decodePmtilesHeader,
  findPmtilesEntry,
  PMTILES_ROOT_BYTES,
  type PmtilesEntry,
  type PmtilesHeader,
  pmtilesTileId,
  PmtilesTileType,
} from '@opensa/engine-formats';

import type { TileAddress, TileScheme } from './tiles';

import { tileKey } from './tiles';

/** Injected so the source is testable without a network, and so a host can serve tiles its own way. */
export type RangeFetch = (offset: number, length: number) => Promise<Uint8Array>;

/** What the baker wrote into the archive, and what the console needs back to place a pixel. */
export interface TileArchiveMeta {
  /** When the pyramid was baked — the status bar shows it beside the pak's own stamp. */
  readonly built: string;
  readonly scheme: TileScheme;
  /** Which build the world came from, in the baker's words. */
  readonly world: string;
}
/** Injected for the same reason — `createImageBitmap` does not exist in a test environment. */
export type TileDecode = (bytes: Uint8Array, mime: string) => Promise<CanvasImageSource>;

/** How many decoded tiles stay in memory. 256 × 256 px RGBA is 256 kB, so this cap is ~64 MB worst case and
 *  far less in practice — a phone's whole tile working set at city zoom is a few dozen. */
const CACHE_CAP = 256;

const MIME: Record<number, string> = {
  [PmtilesTileType.AVIF]: 'image/avif',
  [PmtilesTileType.JPEG]: 'image/jpeg',
  [PmtilesTileType.PNG]: 'image/png',
  [PmtilesTileType.WEBP]: 'image/webp',
};

export class TileSource {
  readonly meta: TileArchiveMeta;

  /** Tiles the archive answered "not here" for — a bake that skipped the sea, or a view off the square. */
  get absentCount(): number {
    return this.missing.size;
  }
  get pendingCount(): number {
    return this.pending.size;
  }
  private readonly cache = new Map<string, CanvasImageSource>();
  private readonly decode: TileDecode;
  private readonly header: PmtilesHeader;
  private readonly leaves = new Map<number, readonly PmtilesEntry[]>();
  private readonly missing = new Set<string>();
  private readonly pending = new Set<string>();

  private readonly range: RangeFetch;

  private readonly root: readonly PmtilesEntry[];

  private constructor(input: {
    decode: TileDecode;
    header: PmtilesHeader;
    meta: TileArchiveMeta;
    range: RangeFetch;
    root: readonly PmtilesEntry[];
  }) {
    this.decode = input.decode;
    this.header = input.header;
    this.meta = input.meta;
    this.range = input.range;
    this.root = input.root;
  }

  /**
   * Read the header and root directory in ONE request, the way the format is meant to be opened.
   *
   * Throws — with the archive's own words — rather than answering a source that draws nothing: a 2D mode
   * that silently shows an empty grid is indistinguishable from one that is still loading.
   */
  static async open(range: RangeFetch, decode: TileDecode): Promise<TileSource> {
    const head = await range(0, PMTILES_ROOT_BYTES);
    const header = decodePmtilesHeader(head);
    const root = await readDirectory(range, head, header.rootOffset, header.rootLength);
    const raw = await readSpan(range, head, header.metadataOffset, header.metadataLength);
    const meta = parseMeta(new TextDecoder().decode(raw));

    return new TileSource({ decode, header, meta, range, root });
  }

  /** Drop every decoded tile — the mode was left, or the archive was replaced. */
  dispose(): void {
    for (const image of this.cache.values()) {
      close(image);
    }
    this.cache.clear();
  }

  /**
   * The decoded tile if it is already here, else null — and a fetch is started for it.
   *
   * Synchronous by design: this is called from inside a frame, and a frame that awaits a tile is a frame
   * that stutters every time the operator pans. `onReady` wakes the render gate when one lands.
   */
  get(tile: TileAddress, onReady: () => void): CanvasImageSource | null {
    const key = tileKey(tile);
    const cached = this.cache.get(key);
    if (cached) {
      // Re-insert so the map's iteration order is least-recently-used first.
      this.cache.delete(key);
      this.cache.set(key, cached);

      return cached;
    }
    if (this.pending.has(key) || this.missing.has(key)) {
      return null;
    }
    this.pending.add(key);
    void this.load(tile, key).then(onReady, () => onReady());

    return null;
  }

  private async entryFor(tile: TileAddress): Promise<null | PmtilesEntry> {
    const id = pmtilesTileId(tile.z, tile.x, tile.y);
    const found = findPmtilesEntry(this.root, id);
    if (found === null) {
      return null;
    }
    if (found.runLength > 0) {
      return found;
    }
    let leaf = this.leaves.get(found.offset);
    if (!leaf) {
      const bytes = await this.range(this.header.leafDirsOffset + found.offset, found.length);
      leaf = decodePmtilesDirectory(bytes);
      this.leaves.set(found.offset, leaf);
    }
    const inLeaf = findPmtilesEntry(leaf, id);

    return inLeaf === null || inLeaf.runLength === 0 ? null : inLeaf;
  }

  private async load(tile: TileAddress, key: string): Promise<void> {
    try {
      const entry = await this.entryFor(tile);
      if (entry === null) {
        this.missing.add(key);

        return;
      }
      const bytes = await this.range(this.header.tileDataOffset + entry.offset, entry.length);
      const image = await this.decode(bytes, MIME[this.header.tileType] ?? 'image/png');
      this.cache.set(key, image);
      while (this.cache.size > CACHE_CAP) {
        const oldest = this.cache.keys().next();
        if (oldest.done === true) {
          break;
        }
        close(this.cache.get(oldest.value));
        this.cache.delete(oldest.value);
      }
    } finally {
      this.pending.delete(key);
    }
  }
}

/**
 * A range reader over a URL, with the `200` case handled rather than trusted.
 *
 * The whole-body fallback is kept — a static host without range support still serves a small district
 * pyramid correctly, just once and whole — but it is a fact about the SERVER, so the caller is told through
 * `onWholeBody` instead of discovering it as memory.
 */
export function httpRange(url: string, onWholeBody?: (bytes: number) => void): RangeFetch {
  let whole: null | Promise<Uint8Array> = null;

  return async (offset, length) => {
    if (whole !== null) {
      return (await whole).subarray(offset, offset + length);
    }
    const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (!response.ok) {
      throw new Error(`tiles: ${url} answered ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (response.status === 206) {
      return bytes;
    }
    // 200 with the whole archive: keep it, say so, and slice from here on.
    whole = Promise.resolve(bytes);
    onWholeBody?.(bytes.byteLength);

    return bytes.subarray(offset, offset + length);
  };
}

/** `createImageBitmap` where it exists, an `<img>` where it does not (older WebKit, and any test). */
export const decodeTile: TileDecode = async (bytes, mime) => {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve());
      image.addEventListener('error', () => reject(new Error('tiles: image decode failed')));
      image.src = url;
    });

    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
};

function close(image: CanvasImageSource | undefined): void {
  if (image !== undefined && 'close' in image && typeof image.close === 'function') {
    image.close();
  }
}

function parseMeta(json: string): TileArchiveMeta {
  const parsed: unknown = JSON.parse(json);
  const record = parsed as Partial<TileArchiveMeta> & Record<string, unknown>;
  const scheme = record.scheme;
  if (
    scheme === undefined ||
    typeof scheme.span !== 'number' ||
    typeof scheme.tileSize !== 'number' ||
    !Array.isArray(scheme.origin)
  ) {
    throw new Error('tiles: the archive carries no world square — it was not baked by this console');
  }

  return {
    built: typeof record.built === 'string' ? record.built : 'unknown',
    scheme,
    world: typeof record.world === 'string' ? record.world : 'unknown',
  };
}

async function readDirectory(
  range: RangeFetch,
  head: Uint8Array,
  offset: number,
  length: number,
): Promise<readonly PmtilesEntry[]> {
  return decodePmtilesDirectory(await readSpan(range, head, offset, length));
}

/** Read a span that may already be inside the bytes the first request brought back. */
async function readSpan(range: RangeFetch, head: Uint8Array, offset: number, length: number): Promise<Uint8Array> {
  if (offset + length <= head.byteLength) {
    return head.subarray(offset, offset + length);
  }

  return range(offset, length);
}
