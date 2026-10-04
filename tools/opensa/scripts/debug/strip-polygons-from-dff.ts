import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';

import { encodeDff } from '../../tools/map-optimizer/src/adapters/gta-sa/codec/dff';
import { clumpToIr } from '../../tools/map-optimizer/src/adapters/gta-sa/read';

/**
 * Strip every submesh that references a given texture (a material's triangles) from DFF models, in place,
 * inside a game IMG — for cards that render as flat missing-texture quads because their texture is absent
 * from the mod (e.g. gostown's `LODEnsemble*` `Gp_feuillu1` cards: `lodveg.txd` ships 6 of the 7 LOD-veg
 * textures). The triangles go; the vertices and the material list are left untouched (the material simply
 * goes unused — no re-indexing), so the other species' cards on the same model stay intact.
 *
 * Report by default; `--write` repacks the IMG (a one-time `.bak` of the original is written first). Each
 * edited DFF is re-parsed and verified (no surviving target triangles, expected triangle total) before write.
 *
 * Run:
 *   npx tsx scripts/debug/strip-polygons-from-dff.ts --img <path> --tex <name[,name…]> [--models a,b,…] [--write]
 * Example (the gostown feuillu fix):
 *   npx tsx scripts/debug/strip-polygons-from-dff.ts \
 *     --img game-src/gostown/models/gostown6.img --tex Gp_feuillu1 \
 *     --models lodensemble1,lodensemble2,lodensemble3,lodensemble4,lodensemble5 --write
 */
const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);

  return i >= 0 ? process.argv[i + 1] : undefined;
};

const imgPath = arg('--img');
const texArg = arg('--tex');
const write = process.argv.includes('--write');
if (!imgPath || !texArg) {
  console.error('usage: --img <path> --tex <name[,name…]> [--models a,b,…] [--write]');
  process.exit(1);
}

const targets = new Set(
  texArg
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const only = arg('--models')
  ? new Set(
      arg('--models')!
        .split(',')
        .map((s) =>
          s
            .trim()
            .toLowerCase()
            .replace(/\.dff$/, ''),
        )
        .filter(Boolean),
    )
  : null;

const read = (p: string): Uint8Array => {
  const b = readFileSync(p);

  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
};
const toAb = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const img = openImg(read(imgPath));
const models = img
  .names()
  .filter((n) => n.toLowerCase().endsWith('.dff'))
  .filter((n) => (only ? only.has(n.toLowerCase().replace(/\.dff$/, '')) : true));

let touched = 0;
let totalTris = 0;

for (const name of models) {
  const bytes = img.get(name);
  if (!bytes) {
    continue;
  }
  let clump: ReturnType<typeof parseDff>;
  try {
    clump = parseDff(toAb(bytes));
  } catch (error) {
    if (only) {
      console.log(`${name}: parse failed (${(error as Error).message}) — skipped`);
    }
    continue;
  }
  const ir = clumpToIr(clump);

  let droppedTris = 0;
  let droppedMats = 0;
  let emptied = false;
  ir.meshes.forEach((mesh, gi) => {
    const strip = new Set<number>();
    clump.geometries[gi].materials.forEach((mat, mi) => {
      if (mat.texture?.name && targets.has(mat.texture.name.toLowerCase())) {
        strip.add(mi);
      }
    });
    if (strip.size === 0) {
      return;
    }
    const before = mesh.triangles.length;
    mesh.triangles = mesh.triangles.filter((t) => !strip.has(t.material));
    droppedTris += before - mesh.triangles.length;
    droppedMats += strip.size;
    if (mesh.triangles.length === 0) {
      emptied = true;
    }
  });

  if (droppedTris === 0) {
    continue;
  }

  const out = encodeDff(bytes, ir);

  // Verify the re-encoded DFF parses cleanly, has NO surviving target triangles, and kept the expected total.
  const re = parseDff(toAb(out));
  let survived = 0;
  let trisLeft = 0;
  re.geometries.forEach((g) => {
    trisLeft += g.triangles.length;
    g.materials.forEach((mat, mi) => {
      if (mat.texture?.name && targets.has(mat.texture.name.toLowerCase())) {
        survived += g.triangles.filter((t) => t.materialIndex === mi).length;
      }
    });
  });
  const expected = ir.meshes.reduce((s, m) => s + m.triangles.length, 0);
  if (survived !== 0 || trisLeft !== expected) {
    throw new Error(`${name}: verification failed (survived=${survived}, tris=${trisLeft}/${expected})`);
  }

  console.log(
    `${name}: dropped ${droppedTris} tris across ${droppedMats} material(s); ` +
      `${bytes.byteLength} -> ${out.byteLength} bytes${emptied ? '  ⚠ a geometry is now empty' : ''}`,
  );
  if (write) {
    img.set(name, out);
  }
  touched += 1;
  totalTris += droppedTris;
}

console.log(`\n${touched} model(s), ${totalTris} triangle(s) ${write ? 'repacked' : 'would be stripped (dry run)'}`);
if (write && touched > 0) {
  const bak = `${imgPath}.bak`;
  if (!existsSync(bak)) {
    copyFileSync(imgPath, bak);
    console.log(`backup: ${bak}`);
  }
  writeImgFile(img, imgPath);
  console.log(`wrote: ${imgPath}`);
} else if (!write && touched > 0) {
  console.log('re-run with --write to repack the IMG.');
}
