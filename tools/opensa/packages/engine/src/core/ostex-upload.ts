/**
 * `.ostex` bytes → a GPU `texture_2d_array`, uploaded VERBATIM (opensa-pack 003 phase 3).
 *
 * The format IS the GPU layout (074/02): BC1/BC3 payloads are written compressed and STAY compressed in
 * video memory — nothing decodes them, on the CPU or otherwise. That is the whole point of the per-model
 * `.ostex`, so this path must never grow an "expand to RGBA8" branch.
 *
 * Extracted from the world's `TextureArrays.load` when per-MODEL dictionaries (vehicles, then peds and map
 * objects) started arriving as `.ostex` too — world arrays and model arrays differ only in the bind group
 * built on top, which is why that stays with each caller.
 */
import {
  decodeOstex,
  OSTEX_FORMAT_FEATURE,
  OstexFormat,
  type OstexFormatId,
  ostexMipLayout,
} from '@opensa/engine-formats';

import type { Resources } from './resources';

const GPU_FORMAT: Record<OstexFormatId, GPUTextureFormat> = {
  // ASTC 4x4 uploads verbatim like the BC formats — same 4x4 block, same 16 bytes, so nothing in the layout
  // or the drain changes. The device must carry `texture-compression-astc`, which the manifest states and
  // `requireWorldSupport` checks before a cell streams.
  [OstexFormat.ASTC4x4]: 'astc-4x4-unorm-srgb',
  [OstexFormat.BC1]: 'bc1-rgba-unorm-srgb',
  [OstexFormat.BC2]: 'bc2-rgba-unorm-srgb',
  [OstexFormat.BC3]: 'bc3-rgba-unorm-srgb',
  [OstexFormat.BC7]: 'bc7-rgba-unorm-srgb',
  [OstexFormat.RGBA8]: 'rgba8unorm-srgb',
};

export interface OstexUpload {
  /** Payload size — what the texture costs, tracked by the resource budget. */
  byteEstimate: number;
  layers: number;
  texture: GPUTexture;
}

/**
 * A resumable upload: the texture exists from `beginOstexUpload`, the (layer, mip) writes land one
 * `step()` at a time. A single array measured 15–85 ms when written in one go (the between-frames hitch,
 * 2026-07-27) — splitting the WRITES, not the arrays, is the only cut that helps, because the worst case
 * was one array.
 */
export interface OstexUploadTask extends OstexUpload {
  /** Perform the next `writeTexture`; returns true once the last (layer, mip) write has landed. */
  step(): boolean;
}

/** Decode `bytes` and create the texture NOW (cheap); the caller drains `step()` until it returns true.
 *  The payload stays referenced until the last write — the CPU copy's lifetime is the drain. */
export function beginOstexUpload(
  device: GPUDevice,
  resources: Resources,
  bytes: Uint8Array,
  label: string,
): OstexUploadTask {
  const tex = decodeOstex(bytes);
  requireFormatSupport(device, tex.format, label);
  const byteEstimate = tex.payload.byteLength;
  const texture = resources.createTexture(
    'texture',
    {
      dimension: '2d',
      format: GPU_FORMAT[tex.format],
      label,
      mipLevelCount: tex.mipCount,
      size: { depthOrArrayLayers: tex.layers.length, height: tex.height, width: tex.width },
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    },
    byteEstimate,
  );

  let layer = 0;
  let level = 0;
  let offset = 0;

  return {
    byteEstimate,
    layers: tex.layers.length,
    step(): boolean {
      if (layer >= tex.layers.length) {
        return true;
      }
      const layout = ostexMipLayout(tex.format, tex.width, tex.height, level);
      device.queue.writeTexture(
        { mipLevel: level, origin: { x: 0, y: 0, z: layer }, texture },
        tex.payload.subarray(offset, offset + layout.totalBytes),
        { bytesPerRow: layout.bytesPerRow, rowsPerImage: layout.rows },
        { depthOrArrayLayers: 1, height: layout.mipHeight, width: layout.mipWidth },
      );
      offset += layout.totalBytes;
      level += 1;
      if (level >= tex.mipCount) {
        level = 0;
        layer += 1;
      }

      return layer >= tex.layers.length;
    },
    texture,
  };
}

/** Decode `bytes` and upload every (layer, mip) as-is. The caller owns the bind group. */
export function uploadOstexTexture(
  device: GPUDevice,
  resources: Resources,
  bytes: Uint8Array,
  label: string,
): OstexUpload {
  const task = beginOstexUpload(device, resources, bytes, label);
  while (!task.step()) {
    // drain in place — per-model dictionaries and the eager boot path pay up-front by design
  }

  return { byteEstimate: task.byteEstimate, layers: task.layers, texture: task.texture };
}

/**
 * The format demand, moved off the device and onto the CONTENT (see `device.ts`). A payload throws on the
 * first array its GPU cannot read — early, and naming the texture, which is the difference between "this
 * world needs another GPU" and a driver-level validation error thousands of lines away.
 *
 * **The demand is read from {@link OSTEX_FORMAT_FEATURE}, never re-derived here.** This function used to
 * compute it as `format !== RGBA8 ⇒ BC`, which was true while BC was the only compressed format we wrote and
 * became a lie the day `--textures astc` shipped: an ASTC pak passed `requireWorldSupport` at manifest time
 * (that gate already read the map) and was then refused HERE, per array, on a GPU that carries ASTC — the
 * message even told the operator to rebuild the pak in a format the device could read, which it already was.
 * Measured 2026-08-12 on a Mali-G51: 20 of 20 world arrays refused, `cellsTotal` 0, and a capture that VOIDed
 * itself. A second copy of a rule is the bug; the map is the rule.
 */
function requireFormatSupport(device: GPUDevice, format: OstexFormatId, label: string): void {
  const feature = OSTEX_FORMAT_FEATURE[format];
  if (feature !== undefined && !device.features.has(feature)) {
    throw new Error(
      `${label}: this texture is ${GPU_FORMAT[format]} and the GPU has no ${feature}. ` +
        `The world's pak must be built with textures this device can read.`,
    );
  }
}
