import type { RegionColliders } from '@opensa/renderware/collision/build-colliders';
import type { ProcObjPlacement } from '@opensa/renderware/map/procobj-scatter';
import type { ColFace } from '@opensa/renderware/parsers/binary/col-types';
import type { ProcObjRule } from '@opensa/renderware/parsers/text/procobj.parser';
import type { MapDefinitions } from '@opensa/renderware/parsers/text/types';

import { buildColliders } from '@opensa/renderware/collision/build-colliders';
import { buildCollisionIndex } from '@opensa/renderware/collision/collision-index';
import { groupRulesBySurface, PROC_OBJ_MAX_DENSITY, scatterProcObjects } from '@opensa/renderware/map/procobj-scatter';
import { parseProcObj } from '@opensa/renderware/parsers/text/procobj.parser';
import { parseSurfaceNames } from '@opensa/renderware/parsers/text/surfinfo.parser';
import { readFileSync, writeFileSync } from 'node:fs';

import { gameArg, gameDir, loadMapDefs, openGameArchive } from '../lib/game';

/**
 * **What do SPACING and MINDIST actually mean, and does our clutter carry the misreading?** (plan 07/02
 * decision 5 — the two cheap checks that come before the reverse, kept as the regression check after it.)
 *
 * The reversed game (`ProcSurfaceInfo_c`, gta-reversed `source/game_sa/Plant/`) says:
 * - `m_fSquaredSpacingRadius = 1/(spacing*spacing)` and `density = triangleArea * that` — SPACING is a
 *   LENGTH in metres, so vanilla places **area / spacing²** objects per triangle, not `area / spacing`.
 * - `m_fSquaredMinDistance = max(minDist, 80)²`, tested against **the camera** in `AddObjects`
 *   (`DistanceBetweenPointsSquared(triangleCentre, TheCamera) < m_fSquaredMinDistance → create nothing`).
 *   MINDIST is an anti-pop-in radius around the player, never a distance between two objects.
 *
 * So this script reports both readings side by side and then measures what our own scatter does. **Both
 * columns were fixed 2026-08-09** (`area / spacing²`, the MINDIST cull deleted), so the stages below now
 * measure the corrected pipeline and the nearest-neighbour block is the REGRESSION check: same-species pairs
 * must be free to stand metres apart again (the old cull left `min 50.0 m` and 0 pairs below their MINDIST).
 *
 * Run: `npx tsx scripts/debug/procobj-spacing-census.ts [--game original] [--density 1] [--nn 0]
 *       [--models build/original/opensa/data/maps/lod_procobj.models] [--json <path>]`
 * (one full collision build, ~minutes). `--nn 0` skips the nearest-neighbour pass; `--models` restricts the
 * rules to the species the built layer actually converts, which is the only set comparable to its object
 * count; `--json` dumps the per-rule table so a later question needs no second collision build.
 */
const game = gameArg();
const argValue = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);

  return at < 0 ? undefined : process.argv[at + 1];
};
const density = Number(argValue('--density') ?? 1);
const withNearest = (argValue('--nn') ?? '1') !== '0';
const modelsPath = argValue('--models');
const jsonPath = argValue('--json');
/** `--sampler corner` runs the ORIGINAL's recovered in-triangle routine instead of our area-uniform one —
 *  the A/B plan 010 task 12 asks for. It changes WHERE placements land, never how many. */
const sampler = argValue('--sampler') === 'corner' ? 'corner' : 'area';

const archive = openGameArchive(game);
const { catalog, instances } = loadMapDefs(game, archive);
const defs: MapDefinitions = { catalog, imgDirs: [], instances, timedCatalog: new Map() };
const allRules = parseProcObj(readFileSync(gameDir(game, 'data', 'procobj.dat'), 'utf8'));
const converted = modelsPath
  ? new Set(
      readFileSync(modelsPath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean),
    )
  : undefined;
const rules = converted ? allRules.filter((rule) => converted.has(rule.model)) : allRules;
if (converted) {
  console.log(`--models ${modelsPath}: ${converted.size} species → ${rules.length} of ${allRules.length} rules`);
}
const surfaceNames = parseSurfaceNames(readFileSync(gameDir(game, 'data', 'surfinfo.dat'), 'utf8'));
console.log(`corpus ${gameDir(game)} — ${rules.length} rules, ${instances.length} instances`);

/** Nearest-neighbour hash cell (m). Small, because the pre-cull sets sit metres apart; the ring expands. */
const NEAREST_CELL = 10;
/** Ring cap — 240 m, three times the largest MINDIST. Past it a placement contributes no distance at all. */
const NEAREST_MAX_RINGS = 24;
const gridKey = (gx: number, gy: number): number => (gx + 4096) * 16384 + (gy + 4096);
const cellKey = (placement: ProcObjPlacement): number =>
  gridKey(Math.floor(placement.position[0] / NEAREST_CELL), Math.floor(placement.position[1] / NEAREST_CELL));

const colliders = buildColliders(buildCollisionIndex(archive), defs, { center: [0, 0, 0], radius: Infinity });
console.log(`colliders: ${colliders.length} groups`);

const areaBySurface = surfaceAreas(colliders, surfaceNames);
reportReadings(areaBySurface);
reportGrouping();
reportStages(areaBySurface);

/** One row of the grouping report: expected objects, and how many of them land on a crowded face. */
interface GroupingRow {
  faces: number;
  groupedMixed: number;
  groupedSame: number;
  objects: number;
}

/** One face's contribution to the grouping split: its own species' counts, and the surface's total. */
function accumulateFace(
  rows: Map<string, GroupingRow>,
  species: Map<string, GroupingRow>,
  surface: string,
  surfaceRules: readonly ProcObjRule[],
  area: number,
  copies: number,
): void {
  const onFace = surfaceRules.reduce((sum, rule) => sum + area / (rule.spacing * rule.spacing), 0);
  const row = rowFor(rows, surface);
  row.faces += copies;
  row.objects += onFace * copies;
  row.groupedMixed += onFace >= 2 ? onFace * copies : 0;
  for (const rule of surfaceRules) {
    const each = area / (rule.spacing * rule.spacing);
    const perRule = rowFor(species, `${surface} ${rule.model}`);
    perRule.objects += each * copies;
    perRule.groupedMixed += onFace >= 2 ? each * copies : 0;
    perRule.groupedSame += each >= 2 ? each * copies : 0;
    row.groupedSame += each >= 2 ? each * copies : 0;
  }
}

/** Area of one collision face in its group's local space (rigid transforms leave it invariant). */
function faceArea(vertices: Float32Array, face: ColFace): number {
  const ax = vertices[face.a * 3];
  const ay = vertices[face.a * 3 + 1];
  const az = vertices[face.a * 3 + 2];
  const ux = vertices[face.b * 3] - ax;
  const uy = vertices[face.b * 3 + 1] - ay;
  const uz = vertices[face.b * 3 + 2] - az;
  const vx = vertices[face.c * 3] - ax;
  const vy = vertices[face.c * 3 + 1] - ay;
  const vz = vertices[face.c * 3 + 2] - az;

  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

/** Walk every rule-carrying collision face once, accumulating the grouping split per surface and per rule. */
function groupingRows(): { rows: Map<string, GroupingRow>; species: Map<string, GroupingRow> } {
  const bySurface = groupRulesBySurface(rules);
  const rows = new Map<string, GroupingRow>();
  const species = new Map<string, GroupingRow>();
  for (const group of colliders) {
    const { faces, vertices } = group.col;
    for (const face of faces) {
      const surface = surfaceNames[face.material];
      const surfaceRules = surface === undefined ? undefined : bySurface.get(surface);
      if (surfaceRules) {
        accumulateFace(rows, species, surface, surfaceRules, faceArea(vertices, face), group.transforms.length);
      }
    }
  }

  return { rows, species };
}

/**
 * Nearest same-set neighbour per placement (XY), spatial-hashed with an EXPANDING ring: the answer is only
 * exact once the best hit is inside the radius the scanned square guarantees, so a sparse set reports its
 * real distance instead of the cell size — which is the number under test.
 */
function nearestDistances(placements: readonly ProcObjPlacement[]): number[] {
  const grid = new Map<number, ProcObjPlacement[]>();
  for (const placement of placements) {
    const at = cellKey(placement);
    (grid.get(at) ?? grid.set(at, []).get(at)!).push(placement);
  }
  const out: number[] = [];
  for (const placement of placements) {
    const best = nearestFrom(grid, placement);
    // Infinity = nothing of this set inside the ring cap; a capped value would read as a distance, so drop it.
    if (Number.isFinite(best)) {
      out.push(Math.sqrt(best));
    }
  }

  return out;
}

/** Squared distance to the nearest other member, growing the scanned square until the answer is exact. */
function nearestFrom(grid: ReadonlyMap<number, ProcObjPlacement[]>, placement: ProcObjPlacement): number {
  const gx = Math.floor(placement.position[0] / NEAREST_CELL);
  const gy = Math.floor(placement.position[1] / NEAREST_CELL);
  let best = Infinity;
  for (let rings = 1; rings <= NEAREST_MAX_RINGS; rings += 1) {
    best = Math.min(best, scanShell(grid, gx, gy, rings, placement));
    const guaranteed = (rings - 1) * NEAREST_CELL;
    if (best <= guaranteed * guaranteed) {
      break;
    }
  }

  return best;
}

/** Append into a model→placements map without `concat` (the pre-cull sets run to millions of entries). */
function push(into: Map<string, ProcObjPlacement[]>, model: string, values: readonly ProcObjPlacement[]): void {
  const list = into.get(model) ?? into.set(model, []).get(model)!;
  for (const value of values) {
    list.push(value);
  }
}

function quantiles(values: number[]): string {
  if (values.length === 0) {
    return 'n/a';
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): string => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1);

  return `min ${sorted[0].toFixed(1)} p05 ${at(0.05)} med ${at(0.5)}`;
}

/**
 * **Group or single?** Under the game's reading the collision TRIANGLE is the unit of scatter, so whether a
 * species reads as a clump or as scattered singles is decided by `faceArea / spacing²` per face — nothing
 * else in the system spaces anything. Per surface this reports how the species' expected objects split
 * between faces that expect several of them (a group) and faces that only ever fire the fractional lottery
 * (a single), plus the same figure counting ALL of the surface's rules together, which is the mixed clump
 * (`ProcessTriangleAdded` rolls every rule of the surface against the same triangle).
 *
 * It is a statement about the DATA, not about our output: the counts are expectations of the original's
 * formula over the stock collision mesh.
 */
function reportGrouping(): void {
  const { rows, species } = groupingRows();
  const line = (label: string, row: GroupingRow, faces: boolean): void => {
    const share = (value: number): string => `${((100 * value) / Math.max(1e-9, row.objects)).toFixed(0)} %`;
    console.log(
      `  ${label.padEnd(40)} ${faces ? Math.round(row.faces).toString().padStart(7) : '       '} ` +
        `${Math.round(row.objects).toString().padStart(8)}   ${share(row.groupedSame).padStart(5)} / ${share(row.groupedMixed).padStart(5)}`,
    );
  };
  console.log('\ngroup or single (objects expected under area/spacing², and whether they land on a face');
  console.log('expecting ≥2 of the SAME species / of ANY species — the second is the mixed clump):');
  console.log(`  ${'surface'.padEnd(40)}   faces   objects    same /   any`);
  for (const [surface, row] of [...rows].sort((a, b) => b[1].objects - a[1].objects)) {
    line(surface, row, true);
  }
  console.log(`\n  ${'per rule (surface + model)'.padEnd(40)}           objects    same /   any`);
  for (const [label, row] of [...species].sort((a, b) => b[1].objects - a[1].objects)) {
    line(label, row, false);
  }
}

/**
 * The two readings of SPACING as map-wide expectations. Both are exact expectations of the same per-triangle
 * rounding (floor + fractional lottery), so they are comparable without running a scatter — and the SA
 * column is what the scatter's candidate count divided by PROC_OBJ_MAX_DENSITY must reproduce, which is the
 * identity `reportStages` asserts. The `old` column is the misreading this pipeline shipped until
 * 2026-08-09; it is kept so the cost of the defect stays measurable on any corpus, not just the stock map.
 */
function reportReadings(areaBySurface: ReadonlyMap<string, number>): void {
  let ours = 0;
  let sa = 0;
  const perSpecies: { model: string; ours: number; sa: number; spacing: number }[] = [];
  for (const rule of rules) {
    const area = areaBySurface.get(rule.surface) ?? 0;
    const oursCount = area / rule.spacing;
    const saCount = area / (rule.spacing * rule.spacing);
    ours += oursCount;
    sa += saCount;
    perSpecies.push({ model: rule.model, ours: oursCount, sa: saCount, spacing: rule.spacing });
  }
  // Self-check (lesson: a zero is only evidence if the counted thing could happen): a rule whose surface has
  // no collision area map-wide contributes 0 to BOTH columns, so it silently drops out of every total here.
  // Name them — either the stock map really never uses that surface, or the surfinfo index → COL material
  // lookup is wrong and the census is under-counting.
  const dead = [...new Set(rules.filter((rule) => !areaBySurface.get(rule.surface)).map((rule) => rule.surface))];
  console.log(
    `\nrule surfaces with ZERO collision area: ${dead.length} of ${new Set(rules.map((r) => r.surface)).size}` +
      (dead.length > 0 ? ` — ${dead.join(', ')} (their rules can never fire)` : ''),
  );

  console.log('\nSPACING, the two readings (map-wide expectation at vanilla density):');
  console.log(`  old   area / spacing   ${Math.round(ours).toLocaleString('en-US')} objects   (the misreading)`);
  console.log(
    `  SA    area / spacing²  ${Math.round(sa).toLocaleString('en-US')} objects   (× ${(sa / ours).toFixed(3)})` +
      '   ← what we scatter now',
  );
  console.log('\n  widest gaps (species · spacing · old → SA):');
  for (const row of perSpecies.sort((a, b) => b.ours - b.sa - (a.ours - a.sa)).slice(0, 10)) {
    console.log(
      `    ${row.model.padEnd(22)} spacing ${String(row.spacing).padStart(6)}   ` +
        `${Math.round(row.ours).toString().padStart(7)} → ${Math.round(row.sa).toString().padStart(6)}`,
    );
  }
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ areas: [...areaBySurface], perSpecies }, null, 2));
    console.log(`\n  per-rule table → ${jsonPath}`);
  }
}

/** The build's own pass, stage by stage, plus the nearest-neighbour signature the scatter leaves. */
function reportStages(areaBySurface: ReadonlyMap<string, number>): void {
  const minDistByModel = new Map<string, number>();
  for (const rule of rules) {
    minDistByModel.set(rule.model, Math.max(minDistByModel.get(rule.model) ?? 0, rule.minDistance));
  }
  const batches = scatterProcObjects(colliders, groupRulesBySurface(rules), surfaceNames, 0, 0, undefined, {
    sampler,
  });
  let candidates = 0;
  let atDensity = 0;
  const placedByModel = new Map<string, ProcObjPlacement[]>();
  for (const batch of batches) {
    const vanilla = batch.placements.filter((placement) => placement.lottery < density);
    candidates += batch.placements.length;
    atDensity += vanilla.length;
    push(placedByModel, batch.model, vanilla);
  }

  // Self-check: candidates are `area / spacing² × PROC_OBJ_MAX_DENSITY` by construction, so the scatter must
  // reproduce the SA column above. A mismatch means this census models a pipeline that is not the one
  // running, and every number below measures the model instead.
  let expected = 0;
  for (const rule of rules) {
    expected += ((areaBySurface.get(rule.surface) ?? 0) / (rule.spacing * rule.spacing)) * PROC_OBJ_MAX_DENSITY;
  }
  const drift = (100 * Math.abs(candidates - expected)) / Math.max(1, expected);
  console.log(`\nstages (density ${density}):`);
  console.log(`  candidates      ${candidates.toLocaleString('en-US')}`);
  console.log(
    `  lottery < ${density}     ${atDensity.toLocaleString('en-US')}   ← the placement count the build emits`,
  );
  console.log(`  self-check: candidates vs area/spacing²×3 — drift ${drift.toFixed(2)} % (must be under ~2 %)`);

  if (!withNearest) {
    return;
  }
  // Regression check: the MINDIST cull is gone, so same-species pairs must now be free to stand close. A
  // `min` back at 50–80 m with 0 pairs below their MINDIST is the inverted look returning.
  console.log('\nnearest-neighbour signature (XY, metres) — same species vs any species:');
  for (const [label, byModel] of [['placed', placedByModel]] as const) {
    const anyNear = nearestDistances([...byModel.values()].flat());
    const sameNear: number[] = [];
    let below = 0;
    for (const [model, placements] of byModel) {
      const minDist = minDistByModel.get(model) ?? 0;
      for (const distance of nearestDistances(placements)) {
        sameNear.push(distance);
        if (distance < minDist) {
          below += 1;
        }
      }
    }
    console.log(
      `  ${label}  same-species ${quantiles(sameNear)}  ·  any-species ${quantiles(anyNear)}  ·  ` +
        `${below} of ${sameNear.length} same-species pairs closer than their MINDIST`,
    );
  }
}

/** Get-or-create, so an accumulator never has to branch on "first time seeing this key". */
function rowFor(map: Map<string, GroupingRow>, key: string): GroupingRow {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const fresh = { faces: 0, groupedMixed: 0, groupedSame: 0, objects: 0 };
  map.set(key, fresh);

  return fresh;
}

/** Best squared distance in the shell of cells at Chebyshev ring `rings` (the inner square is already done). */
function scanShell(
  grid: ReadonlyMap<number, ProcObjPlacement[]>,
  gx: number,
  gy: number,
  rings: number,
  placement: ProcObjPlacement,
): number {
  let best = Infinity;
  for (let dx = -rings; dx <= rings; dx += 1) {
    for (let dy = -rings; dy <= rings; dy += 1) {
      if (Math.abs(dx) !== rings && Math.abs(dy) !== rings) {
        continue;
      }
      for (const other of grid.get(gridKey(gx + dx, gy + dy)) ?? []) {
        if (other === placement) {
          continue;
        }
        const ddx = placement.position[0] - other.position[0];
        const ddy = placement.position[1] - other.position[1];
        best = Math.min(best, ddx * ddx + ddy * ddy);
      }
    }
  }

  return best;
}

/** Area-weighted surface histogram over the whole map (face area × its group's rigid transforms). */
function surfaceAreas(groups: readonly RegionColliders[], names: readonly string[]): Map<string, number> {
  const bySurface = new Map<string, number>();
  for (const group of groups) {
    const { faces, vertices } = group.col;
    const copies = group.transforms.length; // rigid transforms — face area is invariant
    for (const face of faces) {
      const name = names[face.material];
      if (name === undefined) {
        continue;
      }
      bySurface.set(name, (bySurface.get(name) ?? 0) + faceArea(vertices, face) * copies);
    }
  }

  return bySurface;
}
