/**
 * Texture planner (plan 074/03): resolves every material's texture through the `txdp` chain, classifies and
 * processes the ALPHA subset (dilate/premult/mips/coverage → RGBA8 in M0), passes OPAQUE DXT payloads through
 * untouched (BC1/BC2/BC3), and buckets everything into `texture_2d_array`s by exact (format, W, H, mips).
 * Assignment is EAGER and deterministic: first use appends the layer; overflow opens the next array.
 */
import type { AssetFileSystem, RWTexture } from '@opensa/renderware';

import {
  encodeOstex,
  fnv1a,
  type Ostex,
  OstexAlphaClass,
  OstexFormat,
  type OstexFormatId,
  ostexMaxMips,
} from '@opensa/engine-formats';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';

import {
  type AlphaClass,
  classifyAlpha,
  effectiveAlphaClass,
  isAlphaMask,
  processAlphaTexture,
  resampleToPow2,
} from './alpha';
import { packOstexPayload } from './ostex-payload';

const MAX_LAYERS = 256;
const CUTOUT_REF = 128;

export interface PlannedLayer {
  alphaClass: AlphaClass;
  /** Mip payloads, level 0 first — pass-through DXT rows or processed RGBA8 rows (both tight). */
  mips: { data: Uint8Array; height: number; width: number }[];
  name: string;
}

export interface ResolvedTexture {
  alphaClass: AlphaClass;
  arrayRef: number;
  layer: number;
  /** De-tiling candidate (074/12): the welder sets bit 15 of the layer u16 for these. */
  stochastic: boolean;
}

interface Bucket {
  format: OstexFormatId;
  height: number;
  layers: PlannedLayer[];
  mipCount: number;
  refs: number[]; // arrayRef per MAX_LAYERS chunk
  width: number;
}

const DXT_TO_FORMAT: Record<string, OstexFormatId> = {
  dxt1: OstexFormat.BC1,
  dxt3: OstexFormat.BC2,
  dxt5: OstexFormat.BC3,
};

/** Where a journal starts — what {@link TexturePlanner.journalSince} returns for the next call. */
export interface PlannerCursor {
  readonly byContent: number;
  readonly layers: Readonly<Record<string, number>>;
  readonly missingLayers: number;
}

/**
 * The planner's state that a chunked convert must persist between chunks to be RESUMABLE (opensa-pack
 * checkpoints, pmb plan 006): everything `build()` reads plus everything `resolve()` dedups against.
 * Incremental — {@link TexturePlanner.journalSince} returns only what was added after a cursor, and
 * {@link TexturePlanner.restore} replays journals in order onto a fresh planner. Caches (`rawCache`,
 * `globalIndex`) are not state: they rebuild from the same filesystem.
 */
export interface PlannerJournal {
  /** Buckets touched since the cursor, in bucket insertion order; `layers` holds only the NEW layers. */
  readonly buckets: readonly {
    readonly format: OstexFormatId;
    readonly height: number;
    readonly key: string;
    readonly layers: readonly PlannedLayer[];
    readonly mipCount: number;
    /** The bucket's FULL refs list (small; a snapshot is simpler than a delta). */
    readonly refs: readonly number[];
    readonly width: number;
  }[];
  /** New content-hash → resolution entries, in insertion order. */
  readonly byContent: readonly (readonly [number, ResolvedTexture])[];
  /** New stand-in layers, in insertion order. */
  readonly missingLayers: readonly { array: number; color: [number, number, number, number]; layer: number }[];
  readonly nextArrayRef: number;
  /** Full snapshot of the ledger (small). */
  readonly report: TexturePlanner['report'];
}

export const PLANNER_CURSOR_START: PlannerCursor = { byContent: 0, layers: {}, missingLayers: 0 };

export class TexturePlanner {
  /** Stand-in layers minted for MISSING textures (plan 085 row B) — written into the pak manifest so the
   *  runtime can repaint them magenta on demand. `color` is the PACKED texel of the layer. Deliberately a
   *  pool SEPARATE from ordinary colour materials: repainting a shared layer would tint those too. */
  readonly missingLayers: { array: number; color: [number, number, number, number]; layer: number }[] = [];

  /** Ledger: how many textures took each path + every name the chain could not supply (`txd/texture` →
   *  count + the MODELS that asked for it, so a broken mod is identifiable from the report alone). */
  readonly report = {
    colors: 0,
    /** Names the def's own chain missed but the GLOBAL index supplied, keyed `txd/texture`: which txd
     *  LACKED the name, which donor txd supplied it, and every MODEL that asked — the mod-triage view. */
    crossTxd: {} as Record<string, { donor: string; models: string[]; texture: string; txd: string }>,
    dedup: 0,
    missing: {} as Record<string, { count: number; models: string[] }>,
    opaquePass: 0,
    processed: 0,
  };

  private readonly buckets = new Map<string, Bucket>();
  private readonly byContent = new Map<number, ResolvedTexture>();
  /** Global fallback TXDs (074/06 row 10): overlay mods ship one shared TXD (e.g. `vegetation.txd`) that the
   *  installed game wires via txdp; offline we search it when the def's own chain misses. */
  private readonly fallbackTxds: readonly string[];
  /**
   * Emit RGBA8 for EVERYTHING, refusing the DXT passthrough (2026-08-04). BC is a desktop-only format, so a
   * pak that keeps SA's DXT blocks cannot be displayed on a mobile GPU at all — this is the one switch that
   * makes a build portable, and it costs 4-8x the texture memory, which is why it is per-build and off by
   * default. A district-sized `--rect` is what makes that cost affordable.
   */
  private readonly forceRgba8: boolean;

  private readonly fs: AssetFileSystem;
  /** name → the first `.txd` (sorted archive order — deterministic) carrying it. Built LAZILY on the first
   *  chain miss (085 row F): the LAST-RESORT lookup behind the scoped def→txdp→fallback chain. Two real
   *  classes need it: a mod TXD that DROPPED names its stock predecessor carried (mod 32's triadcasino.txd
   *  lost the roof's `greyground256128`), and stock models referencing a texture another TXD carries
   *  (lacnchasgn_lvs → `carparksignplate_64` — vanilla RW finds it through the loaded-txd pool). Scoped
   *  resolution stays first (the lod-common plan-004 lesson: the def TXD's pixels win over a same-named
   *  texture elsewhere); this index only decides between the real texels and a stand-in. Names only — the
   *  scan retains no pixel data (the lazy-TXD memory lesson), the winner re-parses through rawCache. */
  private globalIndex: Map<string, string> | null = null;

  /**
   * Largest texture edge the pak may carry, 0 = uncapped (2026-08-04). This is the lever that makes an
   * RGBA8 pak affordable: uncompressed textures cost 4-8x their BC originals, and halving each edge takes
   * a quarter of that back. A capped texture is also decoded rather than passed through, because there is
   * no way to resize a DXT block without decoding it.
   */
  private readonly maxTextureSize: number;

  private nextArrayRef = 0;
  private readonly rawCache = new Map<string, Map<string, RWTexture>>();

  /** Curated de-tiling texture names (074/12) — lowercased. */
  private readonly stochasticNames: ReadonlySet<string>;

  private readonly txdParents: Map<string, string>;

  constructor(
    fs: AssetFileSystem,
    txdParents: Map<string, string>,
    fallbackTxds: readonly string[] = [],
    stochasticNames: ReadonlySet<string> = new Set(),
    options: { forceRgba8?: boolean; maxTextureSize?: number } = {},
  ) {
    this.fs = fs;
    this.txdParents = txdParents;
    this.fallbackTxds = fallbackTxds;
    this.stochasticNames = stochasticNames;
    this.forceRgba8 = options.forceRgba8 ?? false;
    this.maxTextureSize = Math.max(0, options.maxTextureSize ?? 0);
  }

  /** Assemble every planned array into `.ostex` blobs (deterministic ref order). */
  build(): {
    bytes: Uint8Array;
    meta: { format: number; height: number; layers: number; width: number };
    ref: number;
  }[] {
    const out: {
      bytes: Uint8Array;
      meta: { format: number; height: number; layers: number; width: number };
      ref: number;
    }[] = [];
    for (const bucket of this.buckets.values()) {
      for (let chunk = 0; chunk < bucket.refs.length; chunk += 1) {
        const layers = bucket.layers.slice(chunk * MAX_LAYERS, (chunk + 1) * MAX_LAYERS);
        out.push({
          bytes: encodeArray(bucket, layers),
          meta: { format: bucket.format, height: bucket.height, layers: layers.length, width: bucket.width },
          ref: bucket.refs[chunk],
        });
      }
    }

    return out.sort((a, b) => a.ref - b.ref);
  }

  /** Everything added since `cursor`, and the cursor for the next call. */
  journalSince(cursor: PlannerCursor): { cursor: PlannerCursor; journal: PlannerJournal } {
    const buckets: PlannerJournal['buckets'][number][] = [];
    const layers: Record<string, number> = { ...cursor.layers };
    for (const [key, bucket] of this.buckets) {
      const from = cursor.layers[key] ?? 0;
      if (bucket.layers.length === from && from > 0) {
        continue;
      }
      buckets.push({
        format: bucket.format,
        height: bucket.height,
        key,
        layers: bucket.layers.slice(from),
        mipCount: bucket.mipCount,
        refs: [...bucket.refs],
        width: bucket.width,
      });
      layers[key] = bucket.layers.length;
    }

    return {
      cursor: { byContent: this.byContent.size, layers, missingLayers: this.missingLayers.length },
      journal: {
        buckets,
        byContent: [...this.byContent].slice(cursor.byContent),
        missingLayers: this.missingLayers.slice(cursor.missingLayers),
        nextArrayRef: this.nextArrayRef,
        report: structuredClone(this.report),
      },
    };
  }

  /** Resolve a material's texture (or its flat colour) to an array layer, planning it on first use. A
   *  soft-blend classification is upgraded to cutout when the texels themselves are an alpha MASK (plan 092)
   *  or when a VEGETATION caller asks for it — both because a blend-classed cutout writes no depth, which is
   *  how trees showed through trees and how the Watts Towers showed through themselves. */
  resolve(
    txdName: string,
    textureName: null | string,
    color: readonly number[],
    preferCutout = false,
    model?: string,
  ): ResolvedTexture {
    if (!textureName) {
      return this.resolveColor(color);
    }
    let rw = this.rawTexture(txdName.toLowerCase(), textureName.toLowerCase());
    for (const fallback of this.fallbackTxds) {
      if (rw) {
        break;
      }
      rw = this.rawTexture(fallback, textureName.toLowerCase());
    }
    if (!rw) {
      // Last resort (085 row F): the global by-name index — see its declaration for the two real classes.
      const global = this.globalTxd(textureName.toLowerCase());
      if (global !== undefined) {
        rw = this.rawTexture(global, textureName.toLowerCase());
        if (rw) {
          const key = `${txdName.toLowerCase()}/${textureName.toLowerCase()}`;
          const entry = (this.report.crossTxd[key] ??= {
            donor: global,
            models: [],
            texture: textureName.toLowerCase(),
            txd: txdName.toLowerCase(),
          });
          if (model !== undefined && !entry.models.includes(model)) {
            entry.models.push(model);
          }
        }
      }
    }
    if (!rw) {
      // Vanilla parity: SA draws a missing texture UNTEXTURED — material colour × prelit (map-object round,
      // visagesign04: a mod DFF naming `_257` textures no dictionary anywhere ships turned its arch magenta;
      // the game and prod both showed the quiet grey). The loudness lives elsewhere: every failed name is
      // in `report.missing` (the pack log summarizes it), and the stand-in layer is registered in the
      // manifest so the runtime's missing-texture highlight can repaint it magenta on demand.
      const key = `${txdName.toLowerCase()}/${textureName.toLowerCase()}`;
      const entry = (this.report.missing[key] ??= { count: 0, models: [] });
      entry.count += 1;
      if (model !== undefined && !entry.models.includes(model)) {
        entry.models.push(model);
      }

      return this.resolveColor(color, true);
    }
    const contentKey = plannedKey(rw, preferCutout);
    const existing = this.byContent.get(contentKey);
    if (existing) {
      this.report.dedup += 1;

      return existing;
    }
    const planned = {
      ...this.plan(rw, textureName.toLowerCase(), preferCutout),
      stochastic: this.stochasticNames.has(textureName.toLowerCase()),
    };
    this.byContent.set(contentKey, planned);

    return planned;
  }

  /** Replay a journal onto this planner — call in journal order on a FRESH planner over the same filesystem. */
  restore(journal: PlannerJournal): void {
    for (const entry of journal.buckets) {
      let bucket = this.buckets.get(entry.key);
      if (!bucket) {
        bucket = {
          format: entry.format,
          height: entry.height,
          layers: [],
          mipCount: entry.mipCount,
          refs: [],
          width: entry.width,
        };
        this.buckets.set(entry.key, bucket);
      }
      bucket.layers.push(...entry.layers);
      bucket.refs.splice(0, bucket.refs.length, ...entry.refs);
    }
    for (const [hash, resolved] of journal.byContent) {
      this.byContent.set(hash, resolved);
    }
    this.missingLayers.push(...journal.missingLayers);
    this.nextArrayRef = journal.nextArrayRef;
    Object.assign(this.report, structuredClone(journal.report));
  }

  private appendLayer(
    format: OstexFormatId,
    width: number,
    height: number,
    mipCount: number,
    layer: PlannedLayer,
  ): ResolvedTexture {
    const key = `${format}|${width}|${height}|${mipCount}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { format, height, layers: [], mipCount, refs: [], width };
      this.buckets.set(key, bucket);
    }
    const layerIndex = bucket.layers.length;
    bucket.layers.push(layer);
    const chunk = Math.floor(layerIndex / MAX_LAYERS);
    if (bucket.refs.length <= chunk) {
      bucket.refs.push(this.nextArrayRef);
      this.nextArrayRef += 1;
    }

    return {
      alphaClass: layer.alphaClass,
      arrayRef: bucket.refs[chunk],
      layer: layerIndex % MAX_LAYERS,
      stochastic: false,
    };
  }

  /** The global index's txd for a texture name (building the index on first use), or undefined. */
  private globalTxd(name: string): string | undefined {
    if (!this.globalIndex) {
      this.globalIndex = new Map();
      // `?? []`: hand-rolled test fixtures often omit `names` — no listing simply means no global index.
      const files = (this.fs.names ?? []).filter((file) => file.toLowerCase().endsWith('.txd')).sort();
      for (const file of files) {
        const bytes = this.fs.get(file);
        if (!bytes) {
          continue;
        }
        const txd = file.toLowerCase().replace(/\.txd$/, '');
        try {
          for (const texture of parseTxd(bytes).textures) {
            const key = texture.name.toLowerCase();
            if (!this.globalIndex.has(key)) {
              this.globalIndex.set(key, txd);
            }
          }
        } catch {
          // locked/unparseable dictionaries stay out of the index (parity with rawTexture)
        }
      }
    }

    return this.globalIndex.get(name);
  }

  private plan(rw: RWTexture, name: string, preferCutout = false): ResolvedTexture {
    const blockAligned = rw.width % 4 === 0 && rw.height % 4 === 0;
    const pow2 = Number.isInteger(Math.log2(rw.width)) && Number.isInteger(Math.log2(rw.height));
    const dxtFormat = DXT_TO_FORMAT[rw.format];
    const overCap = this.maxTextureSize > 0 && (rw.width > this.maxTextureSize || rw.height > this.maxTextureSize);
    // Opaque, well-formed DXT: pass through untouched (no recompress, no quality loss) — unless the build
    // asked for a portable pak (`forceRgba8`) or the texture is over the size cap, both of which need the
    // pixels back before anything can be done with them.
    if (
      !this.forceRgba8 &&
      !overCap &&
      dxtFormat !== undefined &&
      !rw.hasAlpha &&
      blockAligned &&
      pow2 &&
      rw.mipmaps.length > 0
    ) {
      this.report.opaquePass += 1;
      const mipCount = Math.min(rw.mipmaps.length, ostexMaxMips(dxtFormat, rw.width, rw.height));

      return this.appendLayer(dxtFormat, rw.width, rw.height, mipCount, {
        alphaClass: 'opaque',
        mips: rw.mipmaps.slice(0, mipCount).map((mip) => ({ data: mip.data, height: mip.height, width: mip.width })),
        name,
      });
    }
    // Everything else (alpha, odd sizes, rgba8888): decode → pow2 → classify → full alpha pipeline → RGBA8.
    this.report.processed += 1;
    const base = rw.mipmaps[0];
    const decoded =
      rw.format === 'rgba8888' ? new Uint8Array(base.data) : decodeDxt(rw.format, base.data, base.width, base.height);
    const sized = resampleToPow2(decoded, base.width, base.height, 'nearest', this.maxTextureSize);
    // Foliage scans carry a soft alpha skirt that mis-classes them softBlend; so does any masked texture
    // whose edge is wider than 2 % of the sheet (plan 092 — the Watts Towers' lattice).
    const classified = classifyAlpha(sized.rgba, rw.hasAlpha);
    const alphaClass = effectiveAlphaClass(classified, preferCutout, isAlphaMask(sized.rgba, CUTOUT_REF));
    // Only a CALLER-upgraded texture is sharpened: it can be broadly semi-transparent (hipoly mod canopies)
    // and A2C would render the whole crown as a screen-door stipple. A texture the mask rule upgraded already
    // has a thin edge — steepening it would throw away the antialiasing A2C is there to resolve.
    const sharpen = preferCutout && alphaClass !== classified;
    const mipCount = ostexMaxMips(OstexFormat.RGBA8, sized.width, sized.height);
    const mips = processAlphaTexture(sized.rgba, sized.width, sized.height, alphaClass, CUTOUT_REF, mipCount, sharpen);
    let width = sized.width;
    let height = sized.height;
    const levels = mips.map((data) => {
      const level = { data, height, width };
      width = Math.max(1, width >> 1);
      height = Math.max(1, height >> 1);

      return level;
    });

    return this.appendLayer(OstexFormat.RGBA8, sized.width, sized.height, mipCount, { alphaClass, mips: levels, name });
  }

  private rawTexture(txdName: string, textureName: string, seen = new Set<string>()): null | RWTexture {
    if (seen.has(txdName)) {
      return null; // cycle guard
    }
    seen.add(txdName);
    let dictionary = this.rawCache.get(txdName);
    if (!dictionary) {
      dictionary = new Map();
      const bytes = this.fs.get(`${txdName}.txd`);
      if (bytes) {
        try {
          for (const texture of parseTxd(bytes).textures) {
            dictionary.set(texture.name.toLowerCase(), texture);
          }
        } catch {
          // unparseable TXD → empty dictionary (parity with asset-cache's parseOrEmpty)
        }
      }
      this.rawCache.set(txdName, dictionary);
    }
    const own = dictionary.get(textureName);
    if (own) {
      return own;
    }
    const parent = this.txdParents.get(txdName);

    return parent && parent !== txdName ? this.rawTexture(parent, textureName, seen) : null;
  }

  /** `missing = true` mints the layer in the missing-texture pool: same texel, but never shared with an
   *  ordinary colour material (the runtime repaints these) and registered in {@link missingLayers}. */
  private resolveColor(color: readonly number[], missing = false): ResolvedTexture {
    this.report.colors += 1;
    const [r, g, b, a] = color;
    const tag = missing ? 'missing' : 'color';
    const key = fnv1a(`${tag}:${r},${g},${b},${a}`);
    const existing = this.byContent.get(key);
    if (existing) {
      return existing;
    }
    const alphaClass: AlphaClass = a < 250 ? 'softBlend' : 'opaque';
    const texel = (a < 250 ? [(r * a) / 255, (g * a) / 255, (b * a) / 255, a] : [r, g, b, 255]).map(Math.round) as [
      number,
      number,
      number,
      number,
    ];
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let index = 0; index < 16; index += 1) {
      rgba.set(texel, index * 4);
    }
    const planned = this.appendLayer(OstexFormat.RGBA8, 4, 4, 1, {
      alphaClass,
      mips: [{ data: rgba, height: 4, width: 4 }],
      name: `${tag}:${r},${g},${b},${a}`,
    });
    this.byContent.set(key, planned);
    if (missing) {
      this.missingLayers.push({ array: planned.arrayRef, color: texel, layer: planned.layer });
    }

    return planned;
  }
}

/** Repack tight mip rows into the 256-aligned `.ostex` payload and encode the array file. */
function encodeArray(bucket: Bucket, layers: PlannedLayer[]): Uint8Array {
  const { format, height, mipCount, width } = bucket;
  const payload = packOstexPayload(
    format,
    width,
    height,
    mipCount,
    layers.map((layer) => layer.mips),
  );
  const alphaToOstex: Record<AlphaClass, number> = {
    cutout: OstexAlphaClass.CUTOUT,
    opaque: OstexAlphaClass.OPAQUE,
    softBlend: OstexAlphaClass.SOFT_BLEND,
  };
  const tex: Ostex = {
    format,
    height,
    layers: layers.map((layer) => ({
      alphaClass: alphaToOstex[layer.alphaClass],
      cutoutRef: layer.alphaClass === 'cutout' ? CUTOUT_REF : 0,
      nameHash: fnv1a(layer.name),
      wrap: 0,
    })),
    mipCount,
    payload,
    premultiplied: true,
    width,
  };

  return encodeOstex(tex);
}

/** The planner's dedup key. The caller's cutout preference is PART of it, not just of the plan: 38 of the
 *  map's TXDs are referenced by both vegetation and non-vegetation defs, and a content-only key handed all
 *  of them whichever class the FIRST caller happened to ask for — a silent, build-order-dependent look.
 *  Sharing survives wherever the callers agree, which is every texture the mask rule already settles. */
function plannedKey(rw: RWTexture, preferCutout: boolean): number {
  return (
    fnv1a(rw.mipmaps[0]?.data ?? new Uint8Array()) ^ (rw.width << 8) ^ rw.height ^ (preferCutout ? 0x8000_0000 : 0)
  );
}
