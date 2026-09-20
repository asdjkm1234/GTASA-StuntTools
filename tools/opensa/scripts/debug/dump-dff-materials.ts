import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { gameArg, openGameArchive, positionalArgs } from '../lib/game';

/**
 * Per-material breakdown of a DFF: texture name, material colour, tri/vert counts, DAY vs NIGHT prelit
 * RGBA averages (with min alpha) and the material's model-space bbox. The one-command answer to "which
 * submesh is this, what does the artist light it like at night, and does it carry alpha?" — it closed
 * 085 rows G (radar texture) and H (Fremont facade: roof10L256 is AUTHORED dark at night).
 * Run: `npx tsx scripts/debug/dump-dff-materials.ts <model> [...more] [--game original]`.
 */
const archive = openGameArchive(gameArg());

for (const model of positionalArgs()) {
  const name = model.toLowerCase();
  console.log(`\n=== ${name}`);
  const dff = archive.get(`${name}.dff`);
  if (!dff) {
    console.log('  NO DFF');
    continue;
  }
  const clump = parseDff(dff);
  for (const [gi, geometry] of clump.geometries.entries()) {
    console.log(`  geometry ${gi}: verts=${(geometry.positions.length / 3) | 0} tris=${geometry.triangles.length}`);
    const day = geometry.prelitColors;
    const night = geometry.nightColors;
    const vertsByMat = new Map<number, Set<number>>();
    for (const tri of geometry.triangles) {
      let set = vertsByMat.get(tri.materialIndex);
      if (!set) {
        set = new Set();
        vertsByMat.set(tri.materialIndex, set);
      }
      set.add(tri.a);
      set.add(tri.b);
      set.add(tri.c);
    }
    for (const [mi, material] of geometry.materials.entries()) {
      const verts = vertsByMat.get(mi) ?? new Set<number>();
      const avg = (colors: null | Uint8Array | undefined): string => {
        if (!colors) return 'none';
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let aMin = 255;
        for (const v of verts) {
          r += colors[v * 4];
          g += colors[v * 4 + 1];
          b += colors[v * 4 + 2];
          a += colors[v * 4 + 3];
          aMin = Math.min(aMin, colors[v * 4 + 3]);
        }
        const n = Math.max(1, verts.size);

        return `${(r / n) | 0}/${(g / n) | 0}/${(b / n) | 0} a=${(a / n) | 0} aMin=${aMin}`;
      };
      console.log(
        `    mat ${mi} tex='${material.texture?.name ?? '(none)'}' color=${material.color?.join(',')} tris=${geometry.triangles.filter((t) => t.materialIndex === mi).length} verts=${verts.size}`,
      );
      console.log(`      day  : ${avg(day)}`);
      console.log(`      night: ${avg(night)}`);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const v of verts) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = geometry.positions[v * 3 + axis];
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
      console.log(
        `      bbox : min(${min.map((v) => v.toFixed(1)).join(', ')}) max(${max.map((v) => v.toFixed(1)).join(', ')})`,
      );
    }
  }
}
