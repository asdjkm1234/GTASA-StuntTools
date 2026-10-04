import { decodeOsm, decodeOsmTextures, decodeOstex, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { openArchive } from '@opensa/renderware/archive/img-archive';
/**
 * 085 row G: what layer do a converted model's vertices sample, and what is actually in its TEXS array?
 * Prints per-submesh meta slot histograms plus each TEXS layer's format/name-hash — the mismatch finder.
 * Run: `npx tsx scripts/debug/dump-osm-meta.ts <modelName> [--pak build/original/opensa]`.
 */
import { readFileSync } from 'node:fs';

interface Fixture {
  layout: Record<string, number>;
  parts: { name: string }[];
  submeshes: { array?: number; indexCount: number; indexOffset: number; part: number; translucent?: boolean }[];
  vertexCount: number;
}

function main(): void {
  const args = process.argv.slice(2);
  const pakFlag = args.indexOf('--pak');
  const pak = pakFlag === -1 ? 'build/original/opensa' : args[pakFlag + 1];
  const model = args
    .find((arg, index) => !arg.startsWith('--') && (pakFlag === -1 || index !== pakFlag + 1))
    ?.toLowerCase();
  if (!model) {
    console.error('usage: npx tsx scripts/debug/dump-osm-meta.ts <modelName> [--pak <dir>]');
    process.exit(1);
  }

  const archive = openArchive(new Uint8Array(readFileSync(`${pak}/models/gta3.img`)));
  const osm = archive.get(`${model}.osm`);
  if (!osm) {
    console.error(`${model}.osm is not in the pak archive`);
    process.exit(1);
  }
  const sections = decodeOsm(new Uint8Array(osm));
  const fixture = JSON.parse(new TextDecoder().decode(osmSection(sections, OsmSectionTag.DESC)!)) as Fixture;
  const geom = osmSection(sections, OsmSectionTag.GEOM)!;
  const meta = geom.subarray(fixture.layout.meta, fixture.layout.meta + fixture.vertexCount * 4);
  const colors = geom.subarray(fixture.layout.colors, fixture.layout.colors + fixture.vertexCount * 4);
  // Index width follows the model, exactly as `buildVehicleModel` wrote it: uint16 while it fits, uint32
  // past 65 536 vertices. Reading a wide model as uint16 does not throw — it silently pairs up halves of
  // real indices and reports submeshes straddling several texture layers, which is a lie a one-material
  // submesh cannot tell. Mod cars cross the ceiling routinely (the built admiral carries 91 746 verts).
  const totalIndices = fixture.submeshes.reduce((total, submesh) => total + submesh.indexCount, 0);
  const indexBase = geom.byteOffset + fixture.layout.indices;
  const indices =
    fixture.vertexCount > 65536
      ? new Uint32Array(geom.buffer, indexBase, totalIndices)
      : new Uint16Array(geom.buffer, indexBase, totalIndices);

  for (const submesh of fixture.submeshes) {
    const layers = new Map<number, number>();
    let colorSum = 0;
    let alphaSum = 0;
    let count = 0;
    for (let at = submesh.indexOffset; at < submesh.indexOffset + submesh.indexCount; at += 1) {
      const vertex = indices[at];
      const layer = meta[vertex * 4];
      layers.set(layer, (layers.get(layer) ?? 0) + 1);
      colorSum += (colors[vertex * 4] + colors[vertex * 4 + 1] + colors[vertex * 4 + 2]) / 3;
      alphaSum += colors[vertex * 4 + 3];
      count += 1;
    }
    const histogram = [...layers.entries()].map(([layer, hits]) => `${layer}×${hits}`).join(' ');
    console.log(
      `submesh part=${fixture.parts[submesh.part]?.name} array=${submesh.array ?? 0} ` +
        `translucent=${submesh.translucent ?? false} meta-layers: ${histogram} ` +
        `avg colour ${(colorSum / count).toFixed(0)} alpha ${(alphaSum / count).toFixed(0)}`,
    );
  }

  const texs = osmSection(sections, OsmSectionTag.TEXS);
  if (!texs) {
    console.log('no own TEXS (world-sourced)');

    return;
  }
  decodeOsmTextures(texs).arrays.forEach((bytes, index) => {
    const tex = decodeOstex(bytes);
    console.log(
      `TEXS array ${index}: ${tex.width}×${tex.height} format ${tex.format} mips ${tex.mipCount} ` +
        `layers ${tex.layers.length}`,
    );
    tex.layers.forEach((layer, at) => {
      console.log(`  layer ${at}: alphaClass ${layer.alphaClass} wrap ${layer.wrap} nameHash ${layer.nameHash}`);
    });
  });
}

main();
