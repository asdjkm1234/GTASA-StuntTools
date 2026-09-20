import { extractPlateSources } from '@opensa/game/adapters/plate-sources';
import {
  composePlateText,
  DEFAULT_PLATE_MASK,
  generatePlateText,
  PLATE_TEXT_HEIGHT,
  PLATE_TEXT_WIDTH,
} from '@opensa/game/vehicle/plate-raster';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readFileSync, writeFileSync } from 'node:fs';

import { encodePng } from '../lib/texture';

/**
 * Render composed license plates from a real `generic/vehicle.txd` to a zoomed PNG, and time the
 * compose (plan 082/01). The one-command answer to "does the charset grid still line up with the
 * atlas this pak actually ships?" — point it at a BUILT pak and a mod's replacement charset is
 * proven readable, or visibly is not.
 *
 * Prints the derived cell grid and background sizes, then writes a sheet of eight sample plates
 * (three seeded from the default mask, five sweeping the whole alphabet).
 *
 * Run: `npx tsx scripts/debug/plate-render.ts build/original/opensa/models/generic/vehicle.txd out.png`.
 */
const [txdPath, outPath] = process.argv.slice(2);
if (!txdPath) {
  console.error('usage: npx tsx scripts/debug/plate-render.ts <vehicle.txd> [out.png]');
  process.exit(1);
}

const file = readFileSync(txdPath);
const txd = parseTxd(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const sources = extractPlateSources(txd);
if (!sources) {
  console.error(`no plate sources in ${txdPath} — charset or a plateback is missing`);
  process.exit(1);
}

const { charset } = sources;
console.log(`charset ${charset.width}x${charset.height}, cell ${charset.cellWidth}x${charset.cellHeight}`);
console.log(`backgrounds: ${sources.backgrounds.map((b) => `${b.width}x${b.height}`).join(', ')}`);

const texts = [
  generatePlateText(DEFAULT_PLATE_MASK, 1),
  generatePlateText(DEFAULT_PLATE_MASK, 2),
  generatePlateText(DEFAULT_PLATE_MASK, 3),
  'ABCDEFGH',
  'IJKLMNOP',
  'QRSTUVWX',
  'YZ012345',
  '6789 #AZ',
];
console.log(`plates: ${texts.map((text) => JSON.stringify(text)).join(' ')}`);

const ZOOM = 6;
const sheetWidth = PLATE_TEXT_WIDTH * ZOOM;
const rowHeight = PLATE_TEXT_HEIGHT * ZOOM;
const sheet = new Uint8Array(sheetWidth * rowHeight * texts.length * 4);
for (const [row, text] of texts.entries()) {
  const rgba = composePlateText(text, charset);
  for (let y = 0; y < rowHeight; y += 1) {
    for (let x = 0; x < sheetWidth; x += 1) {
      const src = (Math.floor(y / ZOOM) * PLATE_TEXT_WIDTH + Math.floor(x / ZOOM)) * 4;
      const dst = ((row * rowHeight + y) * sheetWidth + x) * 4;
      sheet.set(rgba.subarray(src, src + 4), dst);
    }
  }
}
const out = outPath ?? 'plates.png';
writeFileSync(out, encodePng(sheetWidth, rowHeight * texts.length, sheet));
console.log(`written ${out} (${sheetWidth}x${rowHeight * texts.length})`);

const RUNS = 10000;
const start = performance.now();
for (let run = 0; run < RUNS; run += 1) {
  composePlateText(texts[run % texts.length], charset);
}
const per = (performance.now() - start) / RUNS;
console.log(
  `compose: ${per.toFixed(4)} ms per plate over ${RUNS} runs, ${PLATE_TEXT_WIDTH * PLATE_TEXT_HEIGHT * 4} B per slot`,
);
