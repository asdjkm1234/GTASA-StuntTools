/**
 * The `.osm` `TEXS` section (plan opensa-pack/003 phase 5): a model's dictionary as one or more `.ostex`
 * arrays.
 *
 * A `texture2d_array` holds ONE size and ONE format, so a model whose textures disagree cannot fit in a
 * single array. The first shape of this section assumed it could, which held for vehicles (the builder
 * buckets them into one array) and for clutter — but peds break it: **23 of 265 stock peds mix texture
 * sizes**, and map objects will break it harder.
 *
 * The alternative was resampling every layer onto a common size. That is rejected by decision (user,
 * 2026-07-19): resampling regenerates the mip chain map-optimizer authored, and the chain is the thing we
 * are protecting. So the ONE-ARRAY-PER-MODEL contract gives way instead — a consumer addresses a texture as
 * (array, layer), and a single-array model is simply the `arrays.length === 1` case.
 */
import { ByteReader, ByteWriter } from './binary';
import { type OstexFormatId, readOstexFormat } from './ostex';

export interface OsmTextures {
  /** Each entry is a complete `.ostex` payload; index 0 is what a single-array model uses. */
  arrays: Uint8Array[];
}

export function decodeOsmTextures(bytes: Uint8Array): OsmTextures {
  const r = new ByteReader(bytes);
  const count = r.u32();
  const lengths: number[] = [];
  for (let index = 0; index < count; index += 1) {
    lengths.push(r.u32());
  }

  return { arrays: lengths.map((length) => r.raw(length).slice()) };
}

export function encodeOsmTextures(textures: OsmTextures): Uint8Array {
  const total = textures.arrays.reduce((sum, array) => sum + array.byteLength, 0);
  const w = new ByteWriter(8 + textures.arrays.length * 4 + total);
  w.u32(textures.arrays.length);
  for (const array of textures.arrays) {
    w.u32(array.byteLength);
  }
  for (const array of textures.arrays) {
    w.raw(array);
  }

  return w.bytes();
}

/**
 * The format of every array in a `TEXS` section, read from the headers alone.
 *
 * A model's dictionary decides which GPUs can spawn that model, exactly as the pak's arrays decide which can
 * display the world — and a car is NOT in the pak, so a build-time platform check has to come here for the
 * other half of the answer. Payloads are never copied: over a whole game this runs across every vehicle, ped
 * and map object.
 */
export function osmTextureFormats(bytes: Uint8Array): OstexFormatId[] {
  const r = new ByteReader(bytes);
  const count = r.u32();
  const lengths: number[] = [];
  for (let index = 0; index < count; index += 1) {
    lengths.push(r.u32());
  }
  const formats: OstexFormatId[] = [];
  let offset = r.position;
  for (const length of lengths) {
    // A shared-dictionary model writes a zero-length placeholder — it binds the world's arrays instead.
    if (length > 0) {
      formats.push(readOstexFormat(bytes, offset));
    }
    offset += length;
  }

  return formats;
}
