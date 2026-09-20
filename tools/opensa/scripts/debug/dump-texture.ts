import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { gameArg, openGameArchive, positionalArgs } from '../lib/game';
import { decodeToRgba, encodePng } from '../lib/texture';

/**
 * Dump one texture from a TXD to a PNG (no deps — zlib IDAT). Used to inspect glyph atlases
 * like `roadsignfont` (plan 042 item 5b). The TXD is an archive entry (e.g. `particle.txd`) or a
 * filesystem path. Run:
 * `npx tsx scripts/debug/dump-texture.ts particle.txd roadsignfont out.png [alpha] [--game original]`
 */
const [txdTarget, textureName, outPath, mode] = positionalArgs();
if (!txdTarget || !textureName) {
  console.error('usage: npx tsx scripts/debug/dump-texture.ts <txd> <textureName> [out.png] [alpha] [--game original]');
  process.exit(1);
}

const fromArchive = openGameArchive(gameArg()).get(txdTarget);
if (!fromArchive && !existsSync(txdTarget)) {
  console.error(`not found in archive or filesystem: ${txdTarget}`);
  process.exit(1);
}
let bytes = fromArchive;
if (!bytes) {
  const file = readFileSync(txdTarget);
  bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}
const txd = parseTxd(bytes);
const texture = txd.textures.find((t) => t.name.toLowerCase() === textureName.toLowerCase());
if (!texture) {
  console.error(`texture "${textureName}" not found; available: ${txd.textures.map((t) => t.name).join(', ')}`);
  process.exit(1);
}

let rgba = decodeToRgba(texture);
let outWidth = texture.width;
let outHeight = texture.height;
if (mode === 'alpha') {
  // Visualise the alpha channel as opaque grayscale (glyph atlases are white-on-transparent).
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = rgba[i + 3];
    rgba[i + 1] = rgba[i + 3];
    rgba[i + 2] = rgba[i + 3];
    rgba[i + 3] = 255;
  }
  // Tall glyph strips are unreadable as-is: cut into 4 vertical strips laid side by side, ×8 zoom.
  if (outHeight >= outWidth * 4) {
    const strips = 4;
    const stripHeight = outHeight / strips;
    const reflowed = new Uint8Array(outWidth * strips * stripHeight * 4);
    for (let strip = 0; strip < strips; strip += 1) {
      for (let y = 0; y < stripHeight; y += 1) {
        const src = (strip * stripHeight + y) * outWidth * 4;
        const dst = (y * outWidth * strips + strip * outWidth) * 4;
        reflowed.set(rgba.subarray(src, src + outWidth * 4), dst);
      }
    }
    rgba = reflowed;
    outWidth *= strips;
    outHeight = stripHeight;
  }
  const zoom = 8;
  const zoomed = new Uint8Array(outWidth * zoom * outHeight * zoom * 4);
  for (let y = 0; y < outHeight * zoom; y += 1) {
    for (let x = 0; x < outWidth * zoom; x += 1) {
      const src = (Math.floor(y / zoom) * outWidth + Math.floor(x / zoom)) * 4;
      zoomed.set(rgba.subarray(src, src + 4), (y * outWidth * zoom + x) * 4);
    }
  }
  rgba = zoomed;
  outWidth *= zoom;
  outHeight *= zoom;
}
console.log(`${texture.name}: ${texture.width}x${texture.height} ${texture.format} alpha=${texture.hasAlpha}`);
writeFileSync(outPath ?? `${textureName}.png`, encodePng(outWidth, outHeight, rgba));
console.log(`written ${outPath ?? `${textureName}.png`} (${outWidth}x${outHeight})`);
