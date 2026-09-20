import type { SourceTexture, TextureSource } from './texture-source';

import { resolveFrom } from './texture-source';

/**
 * Scoped texture names for SHARED LOD dictionaries (plan 004): SA texture names are only unique per-TXD, so a
 * shared TXD (lod-trees' impostor atlas, the opensa cell-LOD TXD) mixing textures from many source TXDs must rename them
 * uniquely per (txd, name) pair — otherwise two species'/models' different pixels collide under one name.
 * The scheme is PURELY DERIVED from the pair (no shared state), so parallel bake workers assign identical
 * names without coordination; a {@link ScopedRegistry} records what each scoped name means so the encoder can
 * resolve pixels later (registries are plain data — worker-message friendly).
 */

/** What a scoped name stands for. */
export interface ScopedEntry {
  name: string;
  txd: string;
}

/** scopedName → its (txd, texture) pair. */
export type ScopedRegistry = Map<string, ScopedEntry>;

/** RW texture-name budget: 32 bytes including the NUL terminator. */
const MAX_NAME = 31;

/** Register the pair and return its scoped name (idempotent — derived, never sequential). */
export function registerScopedName(registry: ScopedRegistry, txd: string, name: string): string {
  const scoped = scopedTextureName(txd, name);
  registry.set(scoped, { name: name.toLowerCase(), txd: txd.toLowerCase() });

  return scoped;
}

/**
 * A {@link TextureSource} view that understands scoped names: a registered name resolves through the pair's
 * own TXD (`getFrom`), anything else passes through to the base source — so renamed meshes flow through the
 * modifier chain (foliage checks, texture stats) and `encodeLodTxd` without signature changes.
 */
export function scopedSource(base: TextureSource, registry: ScopedRegistry): TextureSource {
  return {
    get(name: string): null | SourceTexture {
      const entry = registry.get(name);

      return entry ? resolveFrom(base, entry.txd, entry.name) : base.get(name);
    },
    getFrom(txdName: string, name: string): null | SourceTexture {
      return base.getFrom?.(txdName, name) ?? null;
    },
  };
}

/** Deterministic RW-safe (≤ 31 chars) unique name for a (txd, texture) pair: `<txd>_<name>` verbatim when it
 *  fits (readable), else a 23-char prefix + fnv1a32 hex8 of the full pair (collision-safe across truncations). */
export function scopedTextureName(txd: string, name: string): string {
  const full = `${txd.toLowerCase()}_${name.toLowerCase()}`;
  if (full.length <= MAX_NAME) {
    return full;
  }

  return `${full.slice(0, MAX_NAME - 8)}${fnv1a32(full)}`;
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
