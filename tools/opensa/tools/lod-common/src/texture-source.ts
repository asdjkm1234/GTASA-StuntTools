import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt, type DxtFormat } from '@opensa/rw-codec/dxt';

/** A decoded source texture: top-mip RGBA8888 + dimensions. */
export interface SourceTexture {
  hasAlpha: boolean;
  height: number;
  rgba: Uint8Array;
  width: number;
}

/** Resolves a texture name to its decoded RGBA, loaded from the archives' TXDs and cached. */
export interface TextureSource {
  get(name: string): null | SourceTexture;
  /** Resolve inside one specific TXD (a model's IDE `txd`) — SA texture names are only unique per-TXD, and
   *  the same name carries different pixels in different TXDs (area recolours; see plan 004). `null` when
   *  that TXD doesn't hold the name. Optional so simple test fakes stay valid — use {@link resolveFrom}. */
  getFrom?(txdName: string, name: string): null | SourceTexture;
}

/**
 * Build a {@link TextureSource} over every TXD in the archives (Phase 2a). On first use it indexes all
 * `TEXTURE_NATIVE`s by TXD + name (read-only reuse of the engine `parseTxd`); `get` decodes the requested
 * texture's top mip to RGBA (DXT via the map-optimizer decoder, or raw rgba8888) and memoizes it. Missing /
 * unparseable textures resolve to null so the atlas can fall back. `get` keeps the legacy flat view (first
 * TXD wins on a name clash); `getFrom` resolves within one TXD (plan 004 — the correct per-model path).
 */
interface IndexedTexture {
  format: string;
  hasAlpha: boolean;
  height: number;
  mip: Uint8Array;
  width: number;
}

export function createTextureSource(archives: readonly ImgArchive[]): TextureSource {
  const flat = new Map<string, IndexedTexture>();
  const byTxd = new Map<string, Map<string, IndexedTexture>>();
  const cache = new Map<string, null | SourceTexture>();
  let indexed = false;

  const buildIndex = (): void => {
    for (const archive of archives) {
      for (const name of archive.names.filter((entry) => entry.toLowerCase().endsWith('.txd'))) {
        const buffer = archive.get(name);
        if (buffer) {
          indexDictionary(name.toLowerCase().replace(/\.txd$/, ''), buffer, flat, byTxd);
        }
      }
    }
    indexed = true;
  };

  const lookup = (cacheKey: string, entry: IndexedTexture | undefined): null | SourceTexture => {
    const cached = cache.get(cacheKey);
    if (cached !== undefined || cache.has(cacheKey)) {
      return cached ?? null;
    }
    const texture = entry ? decode(entry) : null;
    cache.set(cacheKey, texture);

    return texture;
  };

  return {
    get(name: string): null | SourceTexture {
      if (!indexed) {
        buildIndex();
      }
      const key = name.toLowerCase();

      return lookup(`|${key}`, flat.get(key));
    },
    getFrom(txdName: string, name: string): null | SourceTexture {
      if (!indexed) {
        buildIndex();
      }
      const txd = txdName.toLowerCase();
      const key = name.toLowerCase();

      return lookup(`${txd}|${key}`, byTxd.get(txd)?.get(key));
    },
  };
}

/** Scoped-first resolution: the model's own TXD, then the global index (names genuinely absent from the
 *  model's TXD resolve like SA's own TXD fallbacks do). */
export function resolveFrom(source: TextureSource, txdName: string, name: string): null | SourceTexture {
  return source.getFrom?.(txdName, name) ?? source.get(name);
}

function decode(entry: IndexedTexture): null | SourceTexture {
  try {
    const rgba =
      entry.format === 'rgba8888'
        ? entry.mip
        : decodeDxt(entry.format as DxtFormat, entry.mip, entry.width, entry.height);

    return { hasAlpha: entry.hasAlpha, height: entry.height, rgba, width: entry.width };
  } catch {
    return null;
  }
}

function indexDictionary(
  txdName: string,
  buffer: ArrayBuffer,
  flat: Map<string, IndexedTexture>,
  byTxd: Map<string, Map<string, IndexedTexture>>,
): void {
  let textures;
  try {
    textures = parseTxd(buffer).textures;
  } catch {
    return; // unreadable TXD — skip
  }
  let own = byTxd.get(txdName);
  if (!own) {
    own = new Map();
    byTxd.set(txdName, own);
  }
  for (const texture of textures) {
    const key = texture.name.toLowerCase();
    if (texture.mipmaps.length === 0) {
      continue;
    }
    const entry: IndexedTexture = {
      format: texture.format,
      hasAlpha: texture.hasAlpha,
      height: texture.height,
      mip: texture.mipmaps[0].data,
      width: texture.width,
    };
    if (!flat.has(key)) {
      flat.set(key, entry); // legacy flat view — first TXD wins
    }
    if (!own.has(key)) {
      own.set(key, entry);
    }
  }
}
