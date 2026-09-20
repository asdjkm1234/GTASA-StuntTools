import type { RWTextureDictionary } from '@opensa/renderware/parsers/binary/types';

import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';

/**
 * "Is there anything to smear?" — the texture side of the texel-smear question (plan 025).
 *
 * A collapsed or extremely stretched UV drags ONE LINE of the texture across a face. Whether that reads as a
 * defect depends on what the line HOLDS: a road's asphalt varies along it and smears visibly, a wire's or a
 * roof panel's is a flat colour and smears into itself. Measured against eight field labels the separation is
 * clean — broken roads 23–26, every clean model 0–10 — which is what five purely geometric criteria failed
 * to achieve.
 */
export interface Image {
  height: number;
  rgba: Uint8Array;
  width: number;
}

/** Decode a TXD's base levels to RGBA, keyed by lowercased texture name. */
export function decodeTxd(bytes: Uint8Array): Map<string, Image> {
  const out = new Map<string, Image>();
  const dict: RWTextureDictionary = parseTxd(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  for (const texture of dict.textures) {
    const base = texture.mipmaps[0];
    if (!base) {
      continue;
    }
    const rgba =
      texture.format === 'rgba8888' ? base.data : decodeDxt(texture.format, base.data, base.width, base.height);
    out.set(texture.name.toLowerCase(), { height: base.height, rgba, width: base.width });
  }

  return out;
}

/** Samples taken along the smeared line. 64 is well past the point where the spread stops moving. */
const SAMPLES = 64;

/**
 * Luma standard deviation along the line a face's UVs span — the amount of texture detail its stretched
 * mapping actually drags across it. UVs wrap (`repeat`), which is how every tiling world texture is sampled.
 */
export function smearSpread(image: Image, uv: readonly (readonly number[])[]): number {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [u, v] of uv) {
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < SAMPLES; i += 1) {
    const t = i / (SAMPLES - 1);
    const luma = lumaAt(image, minU + (maxU - minU) * t, minV + (maxV - minV) * t);
    sum += luma;
    sumSq += luma * luma;
  }
  const mean = sum / SAMPLES;

  return Math.sqrt(Math.max(0, sumSq / SAMPLES - mean * mean));
}

/** Luma of the texel a wrapped UV lands on. */
function lumaAt(image: Image, u: number, v: number): number {
  const x = ((Math.floor(u * image.width) % image.width) + image.width) % image.width;
  const y = ((Math.floor(v * image.height) % image.height) + image.height) % image.height;
  const o = (y * image.width + x) * 4;

  return 0.299 * image.rgba[o] + 0.587 * image.rgba[o + 1] + 0.114 * image.rgba[o + 2];
}
