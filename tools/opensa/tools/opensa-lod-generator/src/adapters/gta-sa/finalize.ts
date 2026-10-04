import type { Vec3 } from '@opensa/lod-common/mesh';
import type { TextureSource } from '@opensa/lod-common/texture-source';

import { encodeColLibrary } from '@opensa/lod-common/encode-col';
import { encodeLodDff } from '@opensa/lod-common/encode-dff';
import { encodeLodTxd } from '@opensa/lod-common/encode-txd';
import { type ScopedRegistry, scopedSource } from '@opensa/lod-common/scoped-texture';
import { createImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { copyGameDir, guardOut } from '@opensa/tool-kit/game-dir';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BakedCell } from '../../core/types';

export interface BuildOptions {
  baked: readonly BakedCell[];
  cellSize: number;
  drawDistance: number;
  firstId: number;
  gameDir: string;
  lodTextureSize: number;
  outDir: string;
  textureSource: TextureSource;
}

/** Cell centre in world space (Z 0 — the cell mesh keeps world Z, offset only in X/Y; see merge). */
export function cellCentre(cell: { cx: number; cy: number }, cellSize: number): [number, number, number] {
  return [(cell.cx + 0.5) * cellSize, (cell.cy + 0.5) * cellSize, 0];
}

/** The cell-LOD model/txd name (`lod`-prefixed → OpenSA buckets it; `-` for negative cell coords). */
export function cellModelName(cx: number, cy: number): string {
  return `lod_${cx}_${cy}`;
}

/** All cell defs share ONE texture dictionary (plan 004) — per-cell TXDs duplicated every texture ~5.5×. */
export const SHARED_TXD = 'lods';

/** An IDE `objs` line: `id, model, txd, drawDistance, flags` — every cell points at the shared TXD. */
export function ideObjsLine(id: number, name: string, drawDistance: number): string {
  return `${id}, ${name}, ${SHARED_TXD}, ${drawDistance}, 0`;
}

/** An IPL `inst` line: `id, model, interior, x, y, z, rx, ry, rz, rw, lod` (identity rotation, no LOD link). */
export function iplInstLine(id: number, name: string, [x, y, z]: readonly [number, number, number]): string {
  return `${id}, ${name}, 0, ${x}, ${y}, ${z}, 0, 0, 0, 1, -1`;
}

/** Local AABB of a cell mesh's vertices — the bounds for its (faces-less) COL3 model. */
export function meshBounds(mesh: { positions: Float32Array }): { max: Vec3; min: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a], p[i + a]);
      max[a] = Math.max(max[a], p[i + a]);
    }
  }

  return p.length === 0 ? { max: [0, 0, 0], min: [0, 0, 0] } : { max, min };
}

/**
 * Emit the drop-in cell-LOD build (plan 002, 1d-ii). Mirror `gameDir` → `outDir`, then add a single
 * `models/lods.img` (one DFF per baked cell + ONE shared `lods.txd` for all of them — plan 004 — plus one
 * shared `lods.col` of bounds-only COL3 models so
 * SA has collision to stream them), `data/maps/lods.ide` (cell-LOD object defs) + `data/maps/lods.ipl`
 * (placements at each cell centre), and register all three in `data/gta.dat` — so both OpenSA (lod-prefix bucket) and the original
 * game (independent high-draw-distance objects) load them. **Additive**: old `lod*` models/refs are not yet
 * stripped (follow-up), so they coexist with the new cell-LODs.
 */
export function writeBuild(options: BuildOptions): void {
  // WIPE, then mirror (the chain's `copyGameDir` convention): this `--out` can be a persistent build dir, and
  // a file an earlier run wrote and this one does not would otherwise survive into it — see the same fix in
  // `sa-lod-generator`'s finalize.
  guardOut(options.outDir, options.gameDir);
  copyGameDir(options.gameDir, options.outDir);

  const img = createImg();
  const objs: string[] = [];
  const insts: string[] = [];
  const colNames: string[] = [];
  const colBounds: { max: Vec3; min: Vec3 }[] = [];
  const sharedTextures = new Set<string>();
  // Built before the cells are encoded as well as before the shared TXD: the encoder resolves each group's
  // SCOPED name through this same view to tell a blended material from an opaque one (its split order).
  const registry: ScopedRegistry = new Map();
  for (const cell of options.baked) {
    for (const [scoped, entry] of cell.textureMap ?? []) {
      registry.set(scoped, entry);
    }
  }
  const textures = scopedSource(options.textureSource, registry);
  options.baked.forEach((cell, i) => {
    const id = options.firstId + i;
    const name = cellModelName(cell.cx, cell.cy);
    // Two-sided: this build targets OpenSA, which back-face-culls opaque world materials; a merged cell's
    // inconsistent winding would hole the ground otherwise (the real game renders single-sided fine).
    img.set(
      `${name}.dff`,
      encodeLodDff(cell.mesh, name, {
        doubleSided: true,
        textures,
        ...(cell.effects ? { effects: cell.effects } : {}),
      }),
    );
    for (const texture of cellTextures(cell)) {
      sharedTextures.add(texture);
    }
    objs.push(ideObjsLine(id, name, options.drawDistance));
    insts.push(iplInstLine(id, name, cellCentre(cell, options.cellSize)));
    colNames.push(name);
    colBounds.push(meshBounds(cell.mesh));
  });
  // ONE shared TXD for every cell (plan 004): per-cell TXDs held ~5.5× duplicate copies (31,981 entries vs
  // 5,805 unique on the stock map) — on disk AND as decoded/GPU textures at LOD range. Names are SCOPED per
  // source TXD (lod-common plan 004): the merged per-cell registries resolve each scoped name inside its own
  // dictionary, so same-named different-pixel variants coexist instead of collapsing to a random winner.
  img.set(`${SHARED_TXD}.txd`, encodeLodTxd([...sharedTextures].sort(), textures, options.lodTextureSize, 'linear'));
  // SA faults on any streamed model with no collision (fastman92: MODEL_DOES_NOT_HAVE_COLLISION_LOADED). The LODs
  // need no real collision, so pack one bounds-only COL3 per cell (named to its model); SA auto-discovers .col in
  // the IMG. Same approach as sa-procobj-placement / lod-trees-generator.
  img.set('lods.col', encodeColLibrary(colBounds, colNames));

  writeImgFile(img, join(options.outDir, 'models', 'lods.img'));
  const mapsDir = join(options.outDir, 'data', 'maps');
  mkdirSync(mapsDir, { recursive: true });
  writeFileSync(join(mapsDir, 'lods.ide'), section('objs', objs));
  writeFileSync(join(mapsDir, 'lods.ipl'), section('inst', insts));
  registerInGtaDat(join(options.outDir, 'data', 'gta.dat'));
}

/** Unique non-empty texture names a cell references. */
function cellTextures(cell: BakedCell): string[] {
  return [...new Set(cell.mesh.groups.map((group) => group.texture).filter((texture) => texture.length > 0))];
}

function registerInGtaDat(datPath: string): void {
  const lines = ['IMG MODELS\\lods.img', 'IDE DATA\\MAPS\\lods.ide', 'IPL DATA\\MAPS\\lods.ipl'];
  writeFileSync(datPath, `${readFileSync(datPath, 'utf8').trimEnd()}\n${lines.join('\n')}\n`);
}

function section(name: string, rows: readonly string[]): string {
  return `${name}\n${rows.join('\n')}\nend\n`;
}
