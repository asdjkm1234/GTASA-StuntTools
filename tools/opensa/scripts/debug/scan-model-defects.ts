import type { RWGeometry } from '@opensa/renderware/parsers/binary/types';

import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Placement as Placement2, Vec3 } from '../../tools/map-optimizer/src/adapters/gta-sa/boundary';

import {
  buildCoverQuery,
  type CoverQuery,
  type PlacedBox,
  toWorld,
} from '../../tools/map-optimizer/src/adapters/gta-sa/world-cover';
import { loadMapDefsAt, readBytes } from '../lib/game';
import { indexModAssets, resolveDff, resolveTxd } from '../lib/mod-assets';
import { decodeTxd, type Image, smearSpread } from '../lib/texture-probe';
import { loadWaterField, type WaterField } from '../lib/water';

/**
 * scan-model-defects — rank every PLACED world model by broken-authored-vertex-data criteria
 * (map-optimizer plan 024 phase 1). Scans the SOURCE assets the build consumes (last mod wins,
 * vanilla otherwise — the same resolution `model-repack.ts` uses), so a hit names the mod that
 * shipped the defect. Criteria (extension point — add rows as new defect families appear):
 *
 *   Family A — authored normals facing DARKER than their faces (`lae2_roads17`): faces referencing
 *     a vertex normal whose up-component sits `--dz` (default 0.5) below the face normal's. See
 *     `analyzeNormals` for why the test is asymmetric (up-rotated normals are a legal authoring
 *     trick; only ground-rotated ones read as dirt/wedges).
 *   Family B — authored day-prelit black holes (`sphinx01_lvs`): vertices with day luma < 10 and
 *     whole-black triangles on models whose day median is healthy (≥ 40 — by-design dark models and
 *     `tobj` timed models are excluded; dark-at-night is design, plan 019).
 *
 *   Family C — UV mappings stretched far off square (`road_lawn34`, `sbseabed3_las20`, plan 025): faces
 *     whose UV→world map draws a texel `--aniso` (default 8) times longer than wide, up to a collapsed
 *     axis where a single texel row is smeared across the face, AND whose crushed axis is `--discont`
 *     (default 4) times finer than the model's own healthy median. Ranked by the SHARE of the model's own
 *     surface the flagged faces cover, and printed with the map-wide POPULATION, because how many models
 *     carry it is what decides curated list vs general rule. Original-game data — the optimizer moves no
 *     UV (025 phase 0), so a hit here is R*'s, not ours.
 *     **THIS CRITERION IS NOT SETTLED — read plan 025 before trusting its ranking.** FOUR formulations
 *     have been measured and all four mis-rank: raw anisotropy puts cables first (a ribbon SHOULD map a
 *     texel off square); edge-neighbour disagreement under-detects a contiguous band (`sbseabed3_las20`
 *     scored 1 flagged face of 39 while the field calls a quarter of it wrong); and this one, the model
 *     baseline, catches the bands correctly but puts `wires_*` back on top, because a wire model also
 *     carries poles, so it HAS a healthy baseline its strands deviate from; and `--up`, which keeps only
 *     up-facing faces after the field labelled `road03sfn` CLEAN (its 40% was the invisible SKIRT under the
 *     road), yet still ranks that clean model 4x above the broken `road_lawn34`. Geometry alone has not
 *     told "stretched by design" from "stretched by mistake". Use it to SIZE the population, not to
 *     conclude a model is broken. The reason none of the five works is now measured and is about the METHOD:
 *     `road03sfn` carries 42 UP-FACING collapsed faces over 21 % of its visible area and the field calls it
 *     fine, because neighbouring buildings STAND on them. Visibility is a property of the assembled world,
 *     not of the model, so a model-local criterion cannot separate this class at all.
 *     WORLD-CONTEXT GATES (2026-08-11, branch `025-world-visibility`) — the answer to that, in two halves,
 *     both judged in WORLD space through the instance's own transform: a face whose every corner sits
 *     `--water-depth` under the sea is dropped, and so is one another model RESTS on (`--reach`, via
 *     `adapters/gta-sa/world-cover`). Together they take the population from 954 models at >=1% of surface
 *     to 163, and two of the three field-labelled CLEAN models (`backalleys1_sfe`, `garse_85_sfe`) leave the
 *     ranking outright. `road03sfn` does not — see plan 025 for what is still wrong.
 *
 * Run: npx tsx scripts/debug/scan-model-defects.ts [--game original] [--top 10] [--dz 0.5] [--aniso 8]
 *      [--discont 4] [--up 0.5] [--water-depth 0] [--reach 5] [--texvar 15] [--min-area 10] [--json <out.json>]
 * Output per hit: metrics, source mod, instance count + a position — paste into
 *   `npx tsx scripts/debug/teleport-spot.ts <model>` for a field spot.
 */

/** A face the geometric criteria flagged, carried out so the LAZY texture gate can judge it. */
interface FlaggedFace {
  area: number;
  triangle: Triangleish;
  uvs: Float32Array;
}

interface ModelRow {
  // Family B
  allBlackTris: number;
  /** Summed area of flagged faces — the visibility weight (686 tiny grass cards != 22 road slabs). */
  badNormalArea: number;
  // Family A
  badNormalFaces: number;
  blackVerts: number;
  /** Faces whose UV triangle is degenerate outright (one axis maps to nothing). */
  collapsedUvFaces: number;
  /** Faces dropped because another model rests on them — the geometry half of visibility. */
  coveredFaces: number;
  dayP50: number;
  faces: number;
  /** Faces dropped because the texture line they smear is FLAT — nothing to see at any anisotropy. */
  flatFaces: number;
  from: string;
  hasAuthoredNormals: boolean;
  instances: number;
  model: string;
  nightP50: number;
  position: [number, number, number];
  // Family C
  /** Summed world area of the over-stretched faces — the visibility weight, as Family A learned to use. */
  stretchArea: number;
  /** Faces stretched past `--aniso` REGARDLESS of their neighbours — the count the raw metric produced. */
  stretchedFaces: number;
  stretchFaces: number;
  /** Faces dropped because every corner sits under the sea — the water half of visibility. */
  submergedFaces: number;
  timed: boolean;
  /** Total drawable world area, so the flagged area can be read as a SHARE of the model. */
  totalArea: number;
  txd: string;
  verts: number;
  worstAniso: number;
  worstDz: number;
}

interface Placement {
  /** Is this world point covered from above by ANOTHER model resting on it? */
  cover: CoverQuery;
  /** How far under the surface a face must sit before it counts as hidden (world units). */
  depth: number;
  modelName: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  water: WaterField;
}

interface Triangleish {
  a: number;
  b: number;
  c: number;
  materialIndex: number;
}

/** One model's metrics over all its geometries (counts summed, medians over concatenated verts). */
function analyzeModel(
  bytes: Uint8Array,
  dz: number,
  aniso: number,
  discont: number,
  up: number,
  place: null | Placement,
  texVar: number,
  loadTextures: () => Map<string, Image> | null,
): Omit<ModelRow, 'from' | 'instances' | 'model' | 'position' | 'timed' | 'txd'> {
  const clump = parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  let badNormalFaces = 0;
  let badNormalArea = 0;
  let faces = 0;
  let hasAuthoredNormals = false;
  let worstDz = 0;
  let allBlackTris = 0;
  let blackVerts = 0;
  let verts = 0;
  const flagged: (FlaggedFace & { materials: RWGeometry['materials'] })[] = [];
  let stretchedFaces = 0;
  let submergedFaces = 0;
  let coveredFaces = 0;
  let collapsedUvFaces = 0;
  let totalArea = 0;
  let worstAniso = 0;
  const dayLumas: number[] = [];
  const nightLumas: number[] = [];
  for (const geo of clump.geometries) {
    const vertexCount = geo.positions.length / 3;
    verts += vertexCount;
    faces += geo.triangles.length;
    if (geo.uvLayers[0]) {
      const stretch = analyzeUvStretch(geo.positions, geo.uvLayers[0], geo.triangles, aniso, discont, up, place);
      flagged.push(...stretch.flagged.map((f) => ({ ...f, materials: geo.materials })));
      stretchedFaces += stretch.stretched;
      submergedFaces += stretch.submergedFaces;
      coveredFaces += stretch.coveredFaces;
      collapsedUvFaces += stretch.collapsed;
      totalArea += stretch.totalArea;
      worstAniso = Math.max(worstAniso, stretch.worst);
    }
    if (geo.prelitColors) {
      const prelit = analyzePrelit(geo.prelitColors, vertexCount, geo.triangles);
      dayLumas.push(...prelit.lumas);
      blackVerts += prelit.blackVerts;
      allBlackTris += prelit.allBlackTris;
    }
    if (geo.nightColors) {
      for (let i = 0; i < vertexCount; i += 1) nightLumas.push(luma(geo.nightColors, i));
    }
    if (!geo.normals) continue;
    hasAuthoredNormals = true;
    const normals = analyzeNormals(geo.positions, geo.normals, geo.triangles, dz);
    badNormalFaces += normals.badFaces;
    badNormalArea += normals.badArea;
    worstDz = Math.max(worstDz, normals.worstDz);
  }

  // THE TEXTURE GATE, and it is LAZY on purpose: a TXD is decoded only for a model that already has a
  // flagged face — a few hundred models out of 7 148 rather than all of them. A stretched UV drags ONE LINE
  // of texture across the face; if that line is flat there is nothing to see at any anisotropy, which is what
  // the wires and the roofs turned out to be (plan 025: broken roads 23-26, every clean model 0-10).
  let kept = flagged;
  let flatFaces = 0;
  if (flagged.length > 0 && texVar > 0) {
    const images = loadTextures();
    if (images) {
      kept = flagged.filter((f) => {
        const name = f.materials[f.triangle.materialIndex]?.texture?.name?.toLowerCase() ?? '';
        // An UNTEXTURED material (no texture reference at all) cannot smear a texture — that is decidable,
        // so drop it. `nwwarhus` survived every gate on four such faces, 117 u² each, and the field could
        // only say "maybe there is a skew somewhere". Distinct from the case below.
        if (name === '') {
          return false;
        }
        const image = images.get(name);
        if (!image) {
          return true; // NAMED but unresolvable — we cannot judge, so keep rather than invent a verdict
        }
        const { a, b, c } = f.triangle;

        return (
          smearSpread(image, [
            [f.uvs[a * 2], f.uvs[a * 2 + 1]],
            [f.uvs[b * 2], f.uvs[b * 2 + 1]],
            [f.uvs[c * 2], f.uvs[c * 2 + 1]],
          ]) >= texVar
        );
      });
      flatFaces = flagged.length - kept.length;
    }
  }

  return {
    allBlackTris,
    badNormalArea,
    badNormalFaces,
    blackVerts,
    collapsedUvFaces,
    coveredFaces,
    dayP50: p50(dayLumas),
    faces,
    flatFaces,
    hasAuthoredNormals,
    nightP50: p50(nightLumas),
    stretchArea: kept.reduce((sum, f) => sum + f.area, 0),
    stretchedFaces,
    stretchFaces: kept.length,
    submergedFaces,
    totalArea,
    verts,
    worstAniso,
    worstDz,
  };
}

/**
 * Family A per geometry: faces referencing a vertex normal that faces the GROUND markedly more than
 * the face itself does (`nzVertex < nzFace − dz`, components normalized, GTA z = up).
 *
 * Asymmetric on purpose — field round 1 (2026-07-29) falsified the symmetric angle test:
 * `standard01_lawn` tops that ranking (1215 faces >60° off) yet renders FINE, because its grass/bush
 * cards carry deliberate straight-UP normals on vertical faces — a stock vegetation trick (light the
 * card like the lawn under it). A normal rotated toward the sky only ever BRIGHTENS; the defect class
 * that reads as dirt/wedges (`lae2_roads17`) is a normal facing darker than its face. The asymmetry
 * also makes mirror-side copies of two-sided sheets legal without special-casing.
 */
function analyzeNormals(
  p: Float32Array,
  n: Float32Array,
  triangles: readonly Triangleish[],
  dz: number,
): { badArea: number; badFaces: number; worstDz: number } {
  let badFaces = 0;
  let badArea = 0;
  let worstDz = 0;
  for (const t of triangles) {
    const ux = p[t.b * 3] - p[t.a * 3];
    const uy = p[t.b * 3 + 1] - p[t.a * 3 + 1];
    const uz = p[t.b * 3 + 2] - p[t.a * 3 + 2];
    const vx = p[t.c * 3] - p[t.a * 3];
    const vy = p[t.c * 3 + 1] - p[t.a * 3 + 1];
    const vz = p[t.c * 3 + 2] - p[t.a * 3 + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const flen = Math.hypot(fx, fy, fz);
    if (flen < 1e-9) continue;
    const nzFace = fz / flen;
    let faceWorst = 0;
    for (const v of [t.a, t.b, t.c]) {
      const nlen = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]);
      if (nlen < 0.5) continue; // zero/garbage length is family C, not a direction
      faceWorst = Math.max(faceWorst, nzFace - n[v * 3 + 2] / nlen);
    }
    if (faceWorst > dz) {
      badFaces += 1;
      badArea += flen / 2;
    }
    worstDz = Math.max(worstDz, faceWorst);
  }

  return { badArea, badFaces, worstDz };
}

/** Family B per geometry: day-luma list, black vertices, whole-black triangles. */
function analyzePrelit(
  prelit: Uint8Array,
  vertexCount: number,
  triangles: readonly Triangleish[],
): { allBlackTris: number; blackVerts: number; lumas: number[] } {
  const lumas: number[] = [];
  let blackVerts = 0;
  let allBlackTris = 0;
  for (let i = 0; i < vertexCount; i += 1) {
    const l = luma(prelit, i);
    lumas.push(l);
    if (l < 10) blackVerts += 1;
  }
  for (const t of triangles) {
    if ([t.a, t.b, t.c].every((v) => luma(prelit, v) < 10)) allBlackTris += 1;
  }

  return { allBlackTris, blackVerts, lumas };
}

/**
 * Family C per geometry: a face whose UV→world map DISAGREES with the faces it shares an edge with.
 *
 * Per face, solve the linear `M` with `M·(t1−t0) = p1−p0` and `M·(t2−t0) = p2−p0`; its singular values are
 * world units per UV unit along the map's principal axes. `σmax/σmin` is how many times longer than wide a
 * texel is drawn there — the smear the field sees.
 *
 * **But magnitude alone does not separate a defect from a look, and the first map-wide run proved it** (plan
 * 025 phase 1): ranking by raw anisotropy put `cables` and `wires_01..18_sfs` at the top with 100 % of their
 * surface flagged, because that IS how you texture a wire. A long thin ribbon should map a texel far off
 * square. Same failure 024 round 1 recorded when `standard01_lawn` topped a naive angle metric with a legal
 * vegetation trick.
 *
 * What separates `road_lawn34` from a cable is that the cable is stretched UNIFORMLY end to end, while the
 * road is a slab whose faces mostly agree and a band of which does not. So a face is flagged only when it is
 * BOTH stretched past `limit` AND its crushed axis is `discont`× finer than the median of its edge-neighbours'
 * — a discontinuity in the mapping, which is what reads as damage against its own surface. A face with no
 * neighbour is never flagged: with nothing to disagree with, there is no evidence either way.
 *
 * Area-weighted, for the reason Family A had to be: a count ranks slivers above the road slabs anyone looks at.
 */
function analyzeUvStretch(
  positions: Float32Array,
  uvs: Float32Array,
  triangles: readonly Triangleish[],
  limit: number,
  discont: number,
  up: number,
  place: null | Placement,
): {
  collapsed: number;
  coveredFaces: number;
  /** The flagged faces themselves — the texture gate needs their UVs and their material. */
  flagged: FlaggedFace[];
  stretched: number;
  submergedFaces: number;
  totalArea: number;
  worst: number;
} {
  const area: number[] = [];
  const aniso: number[] = [];
  const sigmaMin: number[] = [];
  let collapsed = 0;
  let totalArea = 0;
  let worst = 0;
  let stretched = 0;
  let submergedFaces = 0;
  let coveredFaces = 0;

  for (const { a, b, c } of triangles) {
    const e1p = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k]);
    const e2p = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k]);
    const cross = [
      e1p[1] * e2p[2] - e1p[2] * e2p[1],
      e1p[2] * e2p[0] - e1p[0] * e2p[2],
      e1p[0] * e2p[1] - e1p[1] * e2p[0],
    ];
    const crossLength = Math.hypot(cross[0], cross[1], cross[2]);
    const faceArea = 0.5 * crossLength;
    // UP-FACING ONLY (field label 2026-08-11, `road03sfn`). Its 40 % flagged share is the SKIRT hanging
    // under the road — a vertical apron authored to mask the gap below, textured by dragging the road's UV
    // downward, so the vertical axis maps to no UV movement at all. Nobody ever sees it, and the user
    // confirmed the model has no visible anomaly. The same shape is what puts cables, neon strips and mesh
    // fences at the top: all of them vertical. The reported class is the opposite — a surface you look
    // DOWN at. `|nz|` rather than `nz` because a two-sided sheet ships its mirror copy wound the other way.
    if (faceArea < 1e-6) {
      area.push(0); // a degenerate POSITION face draws nothing — kept in place so face indices line up
      aniso.push(0);
      sigmaMin.push(Number.NaN);
      continue;
    }
    // The denominator is the WHOLE model, always: filtering it too was a self-inflicted bug — a vertical
    // fence kept a 0 u² denominator and any single flagged face read as 99.9 %.
    totalArea += faceArea;
    if (Math.abs(cross[2]) / crossLength < up) {
      area.push(0); // not a surface this defect class lives on — excluded from the numerator only
      aniso.push(0);
      sigmaMin.push(Number.NaN);
      continue;
    }
    const hiddenBy = place === null ? null : hidden(place, positions, [a, b, c]);
    if (hiddenBy !== null) {
      if (hiddenBy === 'water') submergedFaces += 1;
      else coveredFaces += 1;
      area.push(0); // there, but nobody looks at it
      aniso.push(0);
      sigmaMin.push(Number.NaN);
      continue;
    }
    area.push(faceArea);
    const { ratio, small } = uvMetric(uvs, e1p, e2p, a, b, c);
    if (!Number.isFinite(ratio)) collapsed += 1;
    if (ratio > limit) stretched += 1;
    if (ratio > worst) worst = ratio;
    aniso.push(ratio);
    sigmaMin.push(small);
  }

  // The model's OWN baseline: the median fine-axis texel size over its healthy faces. Comparing against
  // immediate edge-neighbours was tried first and UNDER-DETECTS a contiguous band — a face in the middle of
  // a broken strip has broken neighbours, so nothing disagrees, and `sbseabed3_las20` scored 1 flagged face
  // of 39 while the field calls a quarter of it wrong. The model baseline catches the whole band.
  const healthy = aniso.map((r, f) => (area[f] > 0 && r <= limit ? sigmaMin[f] : Number.NaN)).filter(Number.isFinite);
  const drawn = area.filter((a) => a > 0).length;
  // Too few healthy faces = no baseline to judge against, so REFUSE rather than guess. This is what keeps
  // wires and cables out by construction: a ribbon is stretched end to end, so its healthy set is empty and
  // its extreme mapping IS its design. Never a verdict without evidence.
  if (healthy.length < 3 || healthy.length < drawn * 0.2) {
    return { collapsed, coveredFaces, flagged: [], stretched, submergedFaces, totalArea, worst };
  }
  healthy.sort((x, y) => x - y);
  const baseline = healthy[healthy.length >> 1];

  const flagged: FlaggedFace[] = [];
  aniso.forEach((ratio, f) => {
    if (area[f] === 0 || ratio <= limit) return;
    // Flagged when the face crushes its fine axis far below the scale the rest of this model works at.
    if (baseline > 1e-9 && (sigmaMin[f] <= 1e-9 || baseline / sigmaMin[f] > discont)) {
      flagged.push({ area: area[f], triangle: triangles[f], uvs });
    }
  });

  return { collapsed, coveredFaces, flagged, stretched, submergedFaces, totalArea, worst };
}

/** Is this face's centroid covered from above by another model resting on it? */
function coveredFace(place: Placement, positions: Float32Array, corners: readonly number[]): boolean {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const v of corners) {
    cx += positions[v * 3] / 3;
    cy += positions[v * 3 + 1] / 3;
    cz += positions[v * 3 + 2] / 3;
  }

  return place.cover.covered(toWorld(place, cx, cy, cz), place.modelName);
}

function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * The two ways a face is drawn and still never seen, or `null` when it is out in the open.
 *
 * `'water'` — every corner sits `depth` under the sea (user, 2026-08-11: "water occlusion, as already
 * happened with `sbseabed3_las20`"). ALL corners, because a face breaking the surface is still looked at.
 *
 * `'cover'` — another model rests on it, which is what the three field labels turned out to be: skirts with
 * the neighbouring buildings standing on them. Tested at the centroid; the occluder is already an outer box,
 * so asking more precisely would be false precision.
 */
function hidden(place: Placement, positions: Float32Array, corners: readonly number[]): 'cover' | 'water' | null {
  if (submerged(place, positions, corners)) {
    return 'water';
  }

  return coveredFace(place, positions, corners) ? 'cover' : null;
}

function luma(rgba: Uint8Array, i: number): number {
  return 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
}

function main(): void {
  const args = parseArgs();
  const builtDir = join('build', args.game, 'opensa');

  console.log(`· reading built tree ${builtDir} …`);
  const builtArchive = openArchive(readBytes(join(builtDir, 'models', 'gta3.img')));
  const defs = loadMapDefsAt(builtDir, builtArchive);
  const vanilla = openArchive(readBytes(join('game-src', args.game, 'models', 'gta3.img')));
  const mods = indexModAssets(join('mods-src', args.game, 'mods'));
  // The BUILT tree's water, because that is the sea the shipped map has (mods may edit `water.dat`).
  const water = loadWaterField(builtDir);
  console.log(`· water: ${water.quadCount} polygons`);

  // Placed models only, HD level (a LOD-only model never fills the screen); timed flagged for B.
  const placed = new Map<
    string,
    {
      instances: number;
      position: [number, number, number];
      rotation: [number, number, number, number];
      timed: boolean;
      txd: string;
    }
  >();
  for (const instance of defs.instances) {
    if (instance.isLod) continue;
    const def = defs.catalog.get(instance.id);
    if (!def) continue;
    const key = def.modelName.toLowerCase();
    const entry = placed.get(key);
    if (entry) entry.instances += 1;
    else {
      placed.set(key, {
        instances: 1,
        position: instance.position,
        rotation: instance.rotation,
        timed: def.time !== undefined,
        txd: def.txdName.toLowerCase(),
      });
    }
  }
  console.log(`· ${placed.size} placed models — scanning sources …`);

  const cover = buildCoverQuery(worldBoxes(defs, mods, vanilla), args.reach);
  console.log(`· world cover: ${cover.boxCount} placement boxes (reach ${args.reach} u)`);

  const rows: ModelRow[] = [];
  let scanned = 0;
  let sourceless = 0;
  for (const [model, info] of placed) {
    const source = resolveDff(model, mods, vanilla);
    if (!source) {
      sourceless += 1;
      continue;
    }
    try {
      // One representative instance. A model placed many times can be submerged at one and dry at another
      // (`rdwarhus` is placed 13×) — the per-instance question belongs to the world pass this is scouting.
      const place: Placement = {
        cover,
        depth: args.waterDepth,
        modelName: model,
        position: info.position,
        rotation: info.rotation,
        water,
      };
      rows.push({
        from: source.from,
        model,
        ...info,
        ...analyzeModel(source.bytes, args.dz, args.aniso, args.discont, args.up, place, args.texVar, () => {
          const bytes = resolveTxd(info.txd, mods, vanilla);

          return bytes ? decodeTxd(bytes) : null;
        }),
      });
      scanned += 1;
    } catch {
      // unparseable (locked/exotic) — the converter has its own lane for those
    }
  }
  console.log(`· scanned ${scanned} (${sourceless} without a DFF source — generated LODs etc.)\n`);

  const familyA = rows
    .filter((r) => r.hasAuthoredNormals && r.badNormalFaces > 0)
    .sort((a, b) => b.badNormalArea - a.badNormalArea)
    .slice(0, args.top);
  const familyB = rows
    .filter((r) => !r.timed && r.dayP50 >= 40 && r.allBlackTris > 0)
    .sort((a, b) => b.allBlackTris - a.allBlackTris)
    .slice(0, args.top);

  console.log(`═══ Family A — authored normals facing ${args.dz}+ darker than their faces (top ${args.top}) ═══`);
  for (const r of familyA) {
    console.log(
      `  ${r.model.padEnd(22)} badArea ${r.badNormalArea.toFixed(0).padStart(6)}u² ` +
        `badFaces ${String(r.badNormalFaces).padStart(5)}/${String(r.faces).padEnd(6)} ` +
        `worstDz ${r.worstDz.toFixed(2)}  ×${String(r.instances).padEnd(4)} ` +
        `@ ${r.position
          .map((v) => v.toFixed(1))
          .join(', ')
          .padEnd(26)} [${r.from}]`,
    );
  }
  console.log(`\n═══ Family B — day-prelit black holes on healthy models (top ${args.top}) ═══`);
  for (const r of familyB) {
    console.log(
      `  ${r.model.padEnd(22)} blackTris ${String(r.allBlackTris).padStart(5)}/${String(r.faces).padEnd(6)} ` +
        `blackVerts ${String(r.blackVerts).padStart(5)}/${String(r.verts).padEnd(6)} dayP50 ${String(Math.round(r.dayP50)).padStart(3)} ` +
        `nightP50 ${String(Math.round(r.nightP50)).padStart(3)}  ×${String(r.instances).padEnd(4)} ` +
        `@ ${r.position
          .map((v) => v.toFixed(1))
          .join(', ')
          .padEnd(26)} [${r.from}]`,
    );
  }
  // A MINIMUM FLAGGED AREA, and it is derived rather than picked: the three field-confirmed broken models
  // carry 28 u² (`road_lawn32`), 53 u² (`road_lawn17`) and 72 u² (`road_lawn34`) of flagged surface, while
  // `traincross1` reached 10.2 % on a model whose ENTIRE area is 8 u² — 0.8 u² flagged, three orders of
  // magnitude below the smallest real defect. Share alone is meaningless at that size. Per INSTANCE, never
  // multiplied by the placement count: 41 copies of a 0.8 u² patch is still 41 invisible patches.
  const withUv = rows.filter((r) => r.totalArea > 0 && r.stretchArea >= args.minArea);
  const familyC = withUv
    .filter((r) => r.stretchFaces > 0)
    .sort((a, b) => b.stretchArea / b.totalArea - a.stretchArea / a.totalArea)
    .slice(0, args.top);

  console.log(
    `\n═══ Family C — UV stretched over ${args.aniso}× AND ${args.discont}× off its neighbours ` +
      `(top ${args.top} by AREA SHARE) ═══`,
  );
  for (const r of familyC) {
    const share = ((r.stretchArea / r.totalArea) * 100).toFixed(1);
    console.log(
      `  ${r.model.padEnd(22)} ${share.padStart(5)}% of ${r.totalArea.toFixed(0).padStart(6)}u² ` +
        `discont ${String(r.stretchFaces).padStart(5)}/${String(r.faces).padEnd(6)} ` +
        `(stretched ${String(r.stretchedFaces).padStart(5)}) collapsed ${String(r.collapsedUvFaces).padStart(5)}  ×${String(r.instances).padEnd(4)} ` +
        `@ ${r.position
          .map((v) => v.toFixed(1))
          .join(', ')
          .padEnd(26)} [${r.from}]`,
    );
  }
  // The POPULATION is what decides curate-vs-general-rule, so print it next to the ranking (plan 025).
  const tier = (min: number): string => {
    const set = withUv.filter((r) => r.stretchArea / r.totalArea >= min);
    const instances = set.reduce((s, r) => s + r.instances, 0);

    return `${String(set.length).padStart(5)} models / ${String(instances).padStart(6)} placements`;
  };
  console.log(`\n  population (discontinuous faces ≥ ${args.minArea} u²), by the share of the model's own surface:`);
  for (const min of [0.01, 0.02, 0.05, 0.1, 0.2, 0.5]) {
    console.log(`    ≥ ${String(Math.round(min * 100)).padStart(3)}% of surface: ${tier(min)}`);
  }
  console.log(
    `    any at all      : ${tier(Number.EPSILON)}  ·  with a COLLAPSED face: ` +
      `${withUv.filter((r) => r.collapsedUvFaces > 0).length} models`,
  );

  console.log('\nField spot for any row: npx tsx scripts/debug/teleport-spot.ts <model> --game ' + args.game);

  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ familyA, familyB, familyC, scanned }, null, 2));
    console.log(`json → ${args.json}`);
  }
}

/** A model's LOCAL bounding box from its source DFF, or null when it has no source / does not parse. */
function modelBounds(
  model: string,
  mods: ReturnType<typeof indexModAssets>,
  vanilla: Parameters<typeof resolveDff>[2],
): null | { max: Vec3; min: Vec3 } {
  const source = resolveDff(model, mods, vanilla);
  if (!source) return null;
  try {
    const bytes = source.bytes;
    const clump = parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const geo of clump.geometries) {
      for (let v = 0; v < geo.positions.length; v += 3) {
        for (let k = 0; k < 3; k += 1) {
          min[k] = Math.min(min[k], geo.positions[v + k]);
          max[k] = Math.max(max[k], geo.positions[v + k]);
        }
      }
    }

    return min[0] > max[0] ? null : { max, min };
  } catch {
    return null;
  }
}

function p50(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted.length === 0 ? -1 : sorted[Math.floor(sorted.length / 2)];
}

function parseArgs(): {
  aniso: number;
  discont: number;
  dz: number;
  game: string;
  json: string | undefined;
  minArea: number;
  reach: number;
  texVar: number;
  top: number;
  up: number;
  waterDepth: number;
} {
  const argv = process.argv.slice(2);
  let game = 'original';
  let top = 10;
  let dz = 0.5;
  let aniso = 8;
  let discont = 4;
  let up = 0.5;
  let waterDepth = 0;
  let reach = 5;
  let texVar = 15;
  let minArea = 10;
  let json: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--game') game = argv[++i];
    else if (argv[i] === '--top') top = Number(argv[++i]);
    else if (argv[i] === '--dz') dz = Number(argv[++i]);
    else if (argv[i] === '--aniso') aniso = Number(argv[++i]);
    else if (argv[i] === '--discont') discont = Number(argv[++i]);
    else if (argv[i] === '--up') up = Number(argv[++i]);
    else if (argv[i] === '--water-depth') waterDepth = Number(argv[++i]);
    else if (argv[i] === '--reach') reach = Number(argv[++i]);
    else if (argv[i] === '--texvar') texVar = Number(argv[++i]);
    else if (argv[i] === '--min-area') minArea = Number(argv[++i]);
    else if (argv[i] === '--json') json = argv[++i];
    else throw new Error(`unknown arg ${argv[i]}`);
  }

  return { aniso, discont, dz, game, json, minArea, reach, texVar, top, up, waterDepth };
}

/** A local AABB through a placement's transform: all 8 corners, re-bounded (a turned box is not its own). */
function rotatedBox(local: { max: Vec3; min: Vec3 }, place: Placement2, model: string): PlacedBox {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [local.min[0], local.max[0]]) {
    for (const y of [local.min[1], local.max[1]]) {
      for (const z of [local.min[2], local.max[2]]) {
        const corner = toWorld(place, x, y, z);
        for (let k = 0; k < 3; k += 1) {
          min[k] = Math.min(min[k], corner[k]);
          max[k] = Math.max(max[k], corner[k]);
        }
      }
    }
  }

  return { max, min, modelName: model };
}

/**
 * Is every corner of this face at least `depth` under the sea, in WORLD space?
 *
 * Model-local vertices go through the instance's own position + rotation quaternion rather than a
 * translate-only shortcut — a map piece may be placed turned, and a wrong world XY asks the water field
 * about the wrong place. ALL corners, not the centroid: a face breaking the surface is still looked at, and
 * over-hiding is the expensive mistake.
 */
function submerged(place: Placement, positions: Float32Array, corners: readonly number[]): boolean {
  for (const v of corners) {
    const [wx, wy, wz] = toWorld(place, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    const sea = place.water.heightAt(wx, wy);
    if (sea === null || wz > sea - place.depth) {
      return false;
    }
  }

  return true;
}

/**
 * One face's UV→world map: `ratio` is σmax/σmin (how many times longer than wide a texel is drawn there,
 * `Infinity` for a degenerate UV triangle) and `small` is σmin itself, the crushed axis the model baseline
 * is compared against.
 */
function uvMetric(
  uvs: Float32Array,
  e1p: readonly number[],
  e2p: readonly number[],
  a: number,
  b: number,
  c: number,
): { ratio: number; small: number } {
  const e1t = [uvs[b * 2] - uvs[a * 2], uvs[b * 2 + 1] - uvs[a * 2 + 1]];
  const e2t = [uvs[c * 2] - uvs[a * 2], uvs[c * 2 + 1] - uvs[a * 2 + 1]];
  const det = e1t[0] * e2t[1] - e1t[1] * e2t[0];
  if (Math.abs(det) < 1e-14) {
    return { ratio: Number.POSITIVE_INFINITY, small: 0 };
  }
  const dPdu = [0, 1, 2].map((k) => (e1p[k] * e2t[1] - e2p[k] * e1t[1]) / det);
  const dPdv = [0, 1, 2].map((k) => (e2p[k] * e1t[0] - e1p[k] * e2t[0]) / det);
  const guu = dot3(dPdu, dPdu);
  const gvv = dot3(dPdv, dPdv);
  const guv = dot3(dPdu, dPdv);
  const mean = (guu + gvv) / 2;
  const spread = Math.sqrt(Math.max(0, ((guu - gvv) / 2) ** 2 + guv * guv));
  const big = Math.sqrt(Math.max(0, mean + spread));
  const small = Math.sqrt(Math.max(0, mean - spread));

  return { ratio: small > 1e-9 ? big / small : Number.POSITIVE_INFINITY, small };
}

/**
 * Every placement reduced to its world AABB — the input the cover query indexes. Each model's LOCAL bounds
 * are parsed once and cached; the box is then expanded per instance through that instance's own transform,
 * so a model placed 13× contributes 13 different boxes.
 */
function worldBoxes(
  defs: ReturnType<typeof loadMapDefsAt>,
  mods: ReturnType<typeof indexModAssets>,
  vanilla: Parameters<typeof resolveDff>[2],
): PlacedBox[] {
  /** `null` caches "this model has no usable source", so a miss is parsed once and never retried. */
  const localBounds = new Map<string, null | { max: Vec3; min: Vec3 }>();
  const boxes: PlacedBox[] = [];
  for (const instance of defs.instances) {
    if (instance.isLod) continue;
    const def = defs.catalog.get(instance.id);
    if (!def) continue;
    const model = def.modelName.toLowerCase();
    if (!localBounds.has(model)) {
      localBounds.set(model, modelBounds(model, mods, vanilla));
    }
    const local = localBounds.get(model);
    if (!local) continue;
    const box = rotatedBox(local, { position: instance.position, rotation: instance.rotation }, model);
    boxes.push(box);
  }

  return boxes;
}

main();
