/**
 * Vehicle texture array (074/08 B5): the model's TXD first, the shared `vehicle.txd` as fallback, decoded
 * into ONE RGBA8 array whose layers all share a size. Ported from the B2 probe's `TextureSet` — same lore,
 * now browser-callable (no node:fs, no tool-side resampler).
 */
import type { RWMaterial, RWTexture, RWTriangle } from '../parsers/binary/types';
import type { VehicleTextureArray } from './types';

import { parseTxd } from '../parsers/binary/txd';
import { decodeDxt } from '../textures/dxt';

/**
 * One source texture, decoded ON DEMAND.
 *
 * A dictionary can be enormous and mostly unread: the shared world `lods.txd` carries 17 901 textures while
 * the model that names it references a handful, and the map-object path throws the packed RGBA away
 * entirely. Decoding in the constructor cost ~1 s per model on those dictionaries and made the pack's map
 * stage degrade as it walked into the LOD-built models. Size is known without decoding, which is all
 * `pack()` needs to choose the array size — only the texels are deferred.
 */
interface SourceTexture {
  /** True when the decoded texels actually carry transparency (not merely an alpha-capable format). */
  alpha: () => boolean;
  readonly height: number;
  rgba: () => Uint8Array;
  readonly width: number;
}

/** Below this a texel counts as see-through — the same 250 cut the material-alpha check uses. */
const ALPHA_CUT = 250;

/**
 * Parsed TXD headers by buffer identity. `getTxdChain` hands the same buffer to every model that names a
 * dictionary, so the header walk over a shared 80 MB TXD happens once instead of per model. Weak, and it
 * holds only the entry table — the texels stay lazy.
 */
const parsedTxds = new WeakMap<ArrayBuffer, ReturnType<typeof parseTxd>>();

export class VehicleTextures {
  /**
   * True when NOT ONE source dictionary carried a texture — stock SA ships 11 empty TXDs, and the game
   * renders their materials with the material colour over a white stand-in. Callers that plan their own
   * dictionary need to know, or they would mark every one of those materials as a MISSING texture.
   */
  get empty(): boolean {
    return this.sources.size === 0;
  }
  private readonly layers: string[] = [];
  private readonly picked = new Map<string, SourceTexture>();

  private readonly sources = new Map<string, SourceTexture>();

  /** `txds` are raw TXD bytes, highest priority first (model TXD, then the generic `vehicle.txd`). */
  constructor(txds: readonly ArrayBuffer[]) {
    for (const bytes of txds) {
      for (const texture of parseTxdOnce(bytes).textures) {
        const key = texture.name.toLowerCase();
        if (this.sources.has(key)) {
          continue; // first TXD wins — the model's own overrides the generic set
        }
        this.sources.set(key, lazyTexture(texture));
      }
    }
  }

  /**
   * Whether a material's TEXTURE carries real transparency. SA vehicles put decals on the body — scratch and
   * crack overlays, badges — whose alpha is in the texels, not in the material colour. Miss this and the
   * decal renders opaque: its transparent (black) texels paint a black panel over the door.
   */
  hasAlpha(material: RWMaterial): boolean {
    const name = material.texture?.name.toLowerCase() ?? '';

    return this.sources.get(name)?.alpha() ?? false;
  }

  /**
   * Whether a material's texture is see-through WITHIN the region these triangles actually sample.
   *
   * `hasAlpha` answers for the whole texture, and mod interiors share ATLASES: the comet maps its parcel
   * shelf, gauge housings and lamp bodies onto `911_lights`, whose only transparent texels are the lamp
   * glass — the whole-texture answer sent every one of those opaque parts into the no-depth blend phase
   * (a shelf the world showed through, gauges with holes behind the side glass). SA never asks the
   * question: it draws one pass with z-write on and an alpha ref, so an opaque texel occludes no matter
   * whose texture it is on. Sampling the submesh's own UV region is our equivalent of that per-texel truth.
   */
  hasAlphaIn(material: RWMaterial, uvs: Float32Array | undefined, triangles: readonly RWTriangle[]): boolean {
    const name = material.texture?.name.toLowerCase() ?? '';
    const source = this.sources.get(name);
    if (!source) {
      return false;
    }
    if (!uvs || !source.alpha()) {
      // No UV set to narrow by, or nothing transparent anywhere — the whole-texture answer is exact.
      return source.alpha();
    }

    return regionHasTransparency(source.rgba(), source.width, source.height, uvs, triangles, ALPHA_CUT);
  }

  pack(): VehicleTextureArray {
    let width = 4;
    let height = 4;
    for (const name of this.layers) {
      const source = this.picked.get(name);
      if (source) {
        width = Math.max(width, source.width);
        height = Math.max(height, source.height);
      }
    }
    if (this.layers.length === 0) {
      this.layers.push('white');
      this.picked.set('white', WHITE);
    }
    const rgba = new Uint8Array(this.layers.length * width * height * 4);
    this.layers.forEach((name, layer) => {
      const source = this.picked.get(name);
      const scaled = source ? resample(source, width, height) : whiteTexel(width, height);
      rgba.set(scaled, layer * width * height * 4);
    });

    return { height, layers: this.layers.length, names: [...this.layers], rgba, width };
  }

  /**
   * The same layers as {@link pack}, grouped by NATIVE size — one array per size, no layer resampled.
   *
   * `pack()` upscales every layer onto the largest source, which a 2048² body texture turns into a
   * dictionary-wide tax: a 32-layer mod dictionary came out at 32 × 2048² RGBA = 128 MB where the sources
   * sum to ~10 MB. The offline bake uses this instead and lets each submesh name its array; the runtime
   * DFF path keeps `pack()` — one upload, no per-submesh bind.
   *
   * `slots[i]` is where builder layer `i` landed, so the result doubles as the `meta.x` remap table —
   * the same contract as `planModelTextures`. Bucket order is first-appearance, which keeps builder
   * layer 0 (the first body material) at array 0, layer 0.
   */
  packBuckets(): { arrays: VehicleTextureArray[]; slots: { array: number; layer: number }[] } {
    if (this.layers.length === 0) {
      this.layers.push('white');
      this.picked.set('white', WHITE);
    }
    const buckets = new Map<string, number[]>();
    this.layers.forEach((name, layer) => {
      const source = this.picked.get(name) ?? WHITE;
      const key = `${source.width}x${source.height}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(layer);
      } else {
        buckets.set(key, [layer]);
      }
    });

    const arrays: VehicleTextureArray[] = [];
    const slots: { array: number; layer: number }[] = new Array<{ array: number; layer: number }>(this.layers.length);
    for (const members of buckets.values()) {
      const first = this.picked.get(this.layers[members[0]]) ?? WHITE;
      const { height, width } = first;
      const rgba = new Uint8Array(members.length * width * height * 4);
      const names: string[] = [];
      members.forEach((builderLayer, layer) => {
        const name = this.layers[builderLayer];
        const source = this.picked.get(name);
        rgba.set(source ? source.rgba() : whiteTexel(width, height), layer * width * height * 4);
        names.push(name);
        slots[builderLayer] = { array: arrays.length, layer };
      });
      arrays.push({ height, layers: members.length, names, rgba, width });
    }

    return { arrays, slots };
  }

  /** Layer index for a material (layer for 'white' when untextured — the paint carries the colour). */
  resolve(material: RWMaterial): number {
    return this.ensureLayer(material.texture?.name.toLowerCase() ?? 'white');
  }

  /**
   * Lamp textures have a lamps-on TWIN (`vehiclelights128` → `vehiclelightson128` — SA swaps the texture at
   * night). Returns its layer, or 0 for "none": layer 0 is always claimed by the first body material, so it
   * can never itself BE a twin, which makes 0 a safe sentinel.
   */
  resolveNightTwin(material: RWMaterial): number {
    const name = material.texture?.name.toLowerCase() ?? '';
    if (!name.includes('lights') || name.includes('lightson')) {
      return 0;
    }
    const twin = name.replace('lights', 'lightson');

    return this.sources.has(twin) ? this.ensureLayer(twin) : 0;
  }

  private ensureLayer(name: string): number {
    const existing = this.layers.indexOf(name);
    if (existing >= 0) {
      return existing;
    }
    const source = name === 'white' ? null : (this.sources.get(name) ?? null);
    this.picked.set(name, source ?? WHITE);
    this.layers.push(name);

    return this.layers.length - 1;
  }
}

function parseTxdOnce(bytes: ArrayBuffer): ReturnType<typeof parseTxd> {
  const hit = parsedTxds.get(bytes);
  if (hit) {
    return hit;
  }
  const parsed = parseTxd(bytes);
  parsedTxds.set(bytes, parsed);

  return parsed;
}

/** The stand-in for an untextured material and for a name no dictionary carried. */
const WHITE: SourceTexture = {
  alpha: () => false,
  height: 4,
  rgba: () => whiteTexel(4, 4),
  width: 4,
};

/**
 * Whether any texel with alpha below `cut` lies inside these UV triangles (texture-space rasterisation,
 * REPEAT wrap — SA vehicle UVs run outside [0, 1]). A triangle whose UV span covers a full period on both
 * axes samples the entire texture, so it takes the whole-texture answer instead of rasterising the tiling.
 */
export function regionHasTransparency(
  rgba: Uint8Array,
  width: number,
  height: number,
  uvs: Float32Array,
  triangles: readonly RWTriangle[],
  cut: number,
): boolean {
  for (const triangle of triangles) {
    const x = [uvs[triangle.a * 2] * width, uvs[triangle.b * 2] * width, uvs[triangle.c * 2] * width];
    const y = [uvs[triangle.a * 2 + 1] * height, uvs[triangle.b * 2 + 1] * height, uvs[triangle.c * 2 + 1] * height];
    if (Math.max(...x) - Math.min(...x) >= width && Math.max(...y) - Math.min(...y) >= height) {
      // Tiles the whole texture — every texel is sampled, including the transparent ones we know exist.
      return true;
    }
    if (triangleHasTransparency(rgba, width, height, x, y, cut)) {
      return true;
    }
  }

  return false;
}

/** Scan the decoded texels: an alpha-CAPABLE format (DXT3/5, RGBA) is common on fully opaque textures too. */
function hasTransparency(rgba: Uint8Array): boolean {
  for (let at = 3; at < rgba.length; at += 4) {
    if (rgba[at] < ALPHA_CUT) {
      return true;
    }
  }

  return false;
}

/** Wrap a parsed TXD entry so its texels are decoded at most once, and only if something asks for them. */
function lazyTexture(texture: RWTexture): SourceTexture {
  const base = texture.mipmaps[0];
  let rgba: null | Uint8Array = null;
  let alpha: boolean | null = null;
  const decode = (): Uint8Array => {
    rgba ??=
      texture.format === 'rgba8888'
        ? new Uint8Array(base.data)
        : decodeDxt(texture.format, base.data, base.width, base.height);

    return rgba;
  };

  return {
    alpha: (): boolean => {
      alpha ??= hasTransparency(decode());

      return alpha;
    },
    height: base.height,
    rgba: decode,
    width: base.width,
  };
}

/** Nearest-sample resize onto the array's common size (vehicle textures are small and already pow2). */
function resample(source: SourceTexture, width: number, height: number): Uint8Array {
  const rgba = source.rgba();
  if (source.width === width && source.height === height) {
    return rgba;
  }
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor((y / height) * source.height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor((x / width) * source.width));
      for (let channel = 0; channel < 4; channel += 1) {
        out[(y * width + x) * 4 + channel] = rgba[(sy * source.width + sx) * 4 + channel];
      }
    }
  }

  return out;
}

/** Half-space rasterisation of one texel-space triangle over its bbox; sample coordinates wrap (REPEAT). */
function triangleHasTransparency(
  rgba: Uint8Array,
  width: number,
  height: number,
  x: readonly number[],
  y: readonly number[],
  cut: number,
): boolean {
  const wrap = (value: number, size: number): number => ((value % size) + size) % size;
  const area = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0]);
  if (area === 0) {
    return false;
  }
  for (let py = Math.floor(Math.min(...y)); py < Math.ceil(Math.max(...y)); py += 1) {
    for (let px = Math.floor(Math.min(...x)); px < Math.ceil(Math.max(...x)); px += 1) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      const w0 = (x[1] - x[0]) * (cy - y[0]) - (y[1] - y[0]) * (cx - x[0]);
      const w1 = (x[2] - x[1]) * (cy - y[1]) - (y[2] - y[1]) * (cx - x[1]);
      const w2 = (x[0] - x[2]) * (cy - y[2]) - (y[0] - y[2]) * (cx - x[2]);
      const inside = area > 0 ? w0 >= 0 && w1 >= 0 && w2 >= 0 : w0 <= 0 && w1 <= 0 && w2 <= 0;
      if (inside && rgba[(wrap(py, height) * width + wrap(px, width)) * 4 + 3] < cut) {
        return true;
      }
    }
  }

  return false;
}

function whiteTexel(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4).fill(255);
}
