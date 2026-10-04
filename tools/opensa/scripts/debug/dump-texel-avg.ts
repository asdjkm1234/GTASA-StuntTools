import {
  decodeOsm,
  decodeOsmTextures,
  decodeOstex,
  osmSection,
  OsmSectionTag,
  OstexFormat,
} from '@opensa/engine-formats';
import { openArchive } from '@opensa/renderware/archive/img-archive';
/**
 * Average colour of every layer in a converted model's own TEXS arrays (BC1/BC3 endpoint average — enough
 * to tell a black bake from a real image). Run: `npx tsx scripts/debug/dump-texel-avg.ts <modelName>`.
 */
import { readFileSync } from 'node:fs';

function main(): void {
  const model = process.argv[2]?.toLowerCase();
  const pak = process.argv[3] ?? 'build/original/opensa';
  if (!model) {
    console.error('usage: npx tsx scripts/debug/dump-texel-avg.ts <modelName> [pakDir]');
    process.exit(1);
  }
  const archive = openArchive(new Uint8Array(readFileSync(`${pak}/models/gta3.img`)));
  const osm = archive.get(`${model}.osm`);
  if (!osm) {
    console.error(`${model}.osm not found`);
    process.exit(1);
  }
  const texs = osmSection(decodeOsm(new Uint8Array(osm)), OsmSectionTag.TEXS);
  if (!texs) {
    console.log('world-sourced, no own TEXS');

    return;
  }
  decodeOsmTextures(texs).arrays.forEach((bytes, arrayIndex) => {
    const tex = decodeOstex(bytes);
    const bc = tex.format === OstexFormat.BC1 ? 8 : 16;
    const colourAt = tex.format === OstexFormat.BC1 ? 0 : 8; // BC2/BC3/BC7: colour block after alpha
    if (tex.format === OstexFormat.RGBA8) {
      console.log(`array ${arrayIndex}: RGBA8 — skipping (endpoint scan is BC-only)`);

      return;
    }
    const blocksWide = Math.ceil(tex.width / 4);
    const rowBytes = Math.ceil((blocksWide * bc) / 256) * 256;
    const mip0Rows = Math.ceil(tex.height / 4);
    const layerBytes = tex.payload.byteLength / tex.layers.length;
    tex.layers.forEach((layer, layerIndex) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      let count = 0;
      const base = layerIndex * layerBytes;
      for (let row = 0; row < mip0Rows; row += 1) {
        for (let block = 0; block < blocksWide; block += 1) {
          const at = base + row * rowBytes + block * bc + colourAt;
          for (const offset of [0, 2]) {
            const c565 = tex.payload[at + offset] | (tex.payload[at + offset + 1] << 8);
            r += ((c565 >> 11) & 31) * 8.2;
            g += ((c565 >> 5) & 63) * 4.05;
            b += (c565 & 31) * 8.2;
            count += 1;
          }
          if (tex.format === OstexFormat.BC3) {
            alpha +=
              (tex.payload[base + row * rowBytes + block * bc] + tex.payload[base + row * rowBytes + block * bc + 1]) /
              2;
          }
        }
      }
      console.log(
        `array ${arrayIndex} layer ${layerIndex} (hash ${layer.nameHash}): avg rgb ` +
          `${(r / count).toFixed(0)}/${(g / count).toFixed(0)}/${(b / count).toFixed(0)}` +
          (tex.format === OstexFormat.BC3 ? ` alpha-endpoints ${(alpha / (count / 2)).toFixed(0)}` : ''),
      );
    });
  });
}

main();
