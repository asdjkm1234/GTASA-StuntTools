import { readRw, RW_BIN_MESH_PLG, RW_EXTENSION, RW_STRUCT } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { decodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';
import { readFileSync } from 'node:fs';

/**
 * Print a DFF's `BinMeshPLG` per geometry: strip/list flag, split count, total indices, and every split in
 * FILE ORDER — its material, index count and vertex range. The split order is the draw order inside the atomic
 * (RenderWare puts blended materials last), and this dump is what found the map-optimizer rebuild sorting
 * `cehollyhil06`'s vertex-alpha detail split (material 8 of 15, authored last) into the middle
 * (`docs/open-issues/fixed/sa-lod-visibility-budget.md`, round 14). Also lists the geometry extension's chunk types.
 *
 * Run: npx tsx scripts/debug/dump-binmesh.ts <file.dff…>   (extract from an IMG with `img-patch.ts get`)
 */
for (const path of process.argv.slice(2)) {
  const file = readRw(new Uint8Array(readFileSync(path)));
  collectGeometries(file.chunks).forEach((geometry, g) => {
    const extension = geometry.children?.find((child) => child.type === RW_EXTENSION);
    const bin = extension?.children?.find((child) => child.type === RW_BIN_MESH_PLG)?.data;
    const struct = geometry.children?.find((child) => child.type === RW_STRUCT)?.data;
    const types = (extension?.children ?? []).map((child) => `${child.type.toString(16)}:${child.data?.length ?? '-'}`);
    console.log(`${path} geometry ${g} — extension chunks: ${types.join(' ')}`);
    if (!bin || !struct) {
      console.log('  (no BinMesh or Struct)');

      return;
    }
    const decoded = decodeGeometryStruct(struct);
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const flags = view.getUint32(0, true);
    const numMeshes = view.getUint32(4, true);
    console.log(
      `  ${flags & 1 ? 'TRISTRIP' : 'TRILIST'} splits ${numMeshes} totalIndices ${view.getUint32(8, true)} — Struct tris ${decoded.numTriangles} verts ${decoded.numVertices} flags 0x${decoded.flags.toString(16)}`,
    );
    let offset = 12;
    for (let m = 0; m < numMeshes; m += 1) {
      const numIndices = view.getUint32(offset, true);
      const material = view.getUint32(offset + 4, true);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < numIndices; i += 1) {
        const index = view.getUint32(offset + 8 + i * 4, true);
        min = Math.min(min, index);
        max = Math.max(max, index);
      }
      console.log(`  split ${m}: material ${material} indices ${numIndices} vertices ${min}..${max}`);
      offset += 8 + numIndices * 4;
    }
  });
}
