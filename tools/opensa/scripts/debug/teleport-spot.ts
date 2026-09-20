import type { ColModel } from '@opensa/renderware/parsers/binary/col-types';

import { openArchive } from '@opensa/renderware/archive/img-archive';
import { buildCollisionIndex } from '@opensa/renderware/collision/collision-index';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { gameArg, loadMapDefsAt, type PlacedInstance, positionalArgs, readBytes } from '../lib/game';

/**
 * Where to STAND to look at a map object — a teleport target that is outside everything, on real ground,
 * with the object in view. Picking one by hand from a model's bbox lands you inside a wall or under the
 * terrain often enough to be worth a script (plan 092's field controls were picked this way).
 *
 * Reads the BUILT tree (`build/<game>/opensa`) — the merged map with mods installed, which is what a field
 * run loads and can differ from `game-src/` completely.
 *
 * Method: take the target's placement, ring candidate spots around it, and for each one
 *   1. cast a ray DOWN onto the collision of every instance nearby → the z you would actually stand on;
 *   2. reject it if a player-sized box at that z is inside any collision (the whole point of the tool);
 *   3. note whether the line from eye height to the target's centre is blocked, and by what — a fence in
 *      the way is a judgement call, so those spots are listed after the clear ones rather than dropped.
 * Instance rotation is honoured: rays and boxes are taken into each model's own space, so a rotated
 * building is not tested against a phantom axis-aligned twin.
 *
 * Run: `npx tsx scripts/debug/teleport-spot.ts <model> [--game original] [--src <dir>] [--near x,y]
 *       [--distance 30] [--eye 1.6] [--top 3]`
 */
const PLAYER_HALF_WIDTH = 0.5;
const PLAYER_HEIGHT = 2;
const RING_DIRECTIONS = 24;
const NEARBY_RADIUS = 120;
/** Standing ON a surface must not read as standing IN it. */
const SURFACE_EPSILON = 0.2;

interface Candidate {
  blockedBy: null | string;
  ground: null | number;
  inside: null | string;
  x: number;
  y: number;
}

interface Entry {
  col: ColModel;
  instance: PlacedInstance;
  max: Vec3;
  min: Vec3;
  name: string;
}

type Vec3 = [number, number, number];

/** The inverse of a placement's rotation. */
function conjugate(q: readonly number[]): readonly number[] {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Highest collision surface under (x, y): a downward ray against every nearby model's own geometry. */
function groundAt(x: number, y: number, top: number, nearby: readonly Entry[]): null | number {
  let best: null | number = null;
  for (const entry of nearby) {
    if (x < entry.min[0] || x > entry.max[0] || y < entry.min[1] || y > entry.max[1]) {
      continue;
    }
    const hit = groundFromEntry(x, y, top, entry);
    if (hit !== null && (best === null || hit > best)) {
      best = hit;
    }
  }

  return best;
}

/** The highest surface ONE instance offers under (x, y) — its mesh, then its boxes. */
function groundFromEntry(x: number, y: number, top: number, entry: Entry): null | number {
  const origin = toModel(entry.instance, [x, y, top]);
  const direction = rotate(conjugate(entry.instance.rotation), [0, 0, -1]);
  const { boxes, faces, vertices } = entry.col;
  const vertex = (index: number): Vec3 => [vertices[index * 3], vertices[index * 3 + 1], vertices[index * 3 + 2]];
  let best: null | number = null;
  for (const face of faces) {
    const hit = rayTriangle(origin, direction, vertex(face.a), vertex(face.b), vertex(face.c));
    // The direction is unit length, so the ray parameter is a WORLD-space drop from `top`.
    if (hit !== null && hit >= 0 && (best === null || top - hit > best)) {
      best = top - hit;
    }
  }
  for (const box of boxes) {
    const over =
      origin[0] >= box.min[0] && origin[0] <= box.max[0] && origin[1] >= box.min[1] && origin[1] <= box.max[1];
    if (over && (best === null || entry.instance.position[2] + box.max[2] > best)) {
      best = entry.instance.position[2] + box.max[2];
    }
  }

  return best;
}

/** Would a player standing at (x, y, base) be INSIDE this instance's collision? */
function insideCollision(x: number, y: number, base: number, entry: Entry): boolean {
  if (
    x + PLAYER_HALF_WIDTH <= entry.min[0] ||
    x - PLAYER_HALF_WIDTH >= entry.max[0] ||
    y + PLAYER_HALF_WIDTH <= entry.min[1] ||
    y - PLAYER_HALF_WIDTH >= entry.max[1] ||
    base + PLAYER_HEIGHT <= entry.min[2] + SURFACE_EPSILON ||
    base >= entry.max[2] - SURFACE_EPSILON
  ) {
    return false;
  }
  // Inside the world AABB — now ask the model itself, so a rotated or hollow shell does not veto its own yard.
  const local = toModel(entry.instance, [x, y, base + PLAYER_HEIGHT / 2]);
  for (const box of entry.col.boxes) {
    if (
      local[0] > box.min[0] - PLAYER_HALF_WIDTH &&
      local[0] < box.max[0] + PLAYER_HALF_WIDTH &&
      local[1] > box.min[1] - PLAYER_HALF_WIDTH &&
      local[1] < box.max[1] + PLAYER_HALF_WIDTH &&
      local[2] > box.min[2] + SURFACE_EPSILON &&
      local[2] < box.max[2] - SURFACE_EPSILON
    ) {
      return true;
    }
  }
  // Mesh collision: a vertical stab through the player's own column — an odd crossing count means enclosed.
  const origin = toModel(entry.instance, [x, y, base + PLAYER_HEIGHT / 2]);
  const up = rotate(conjugate(entry.instance.rotation), [0, 0, 1]);
  let crossings = 0;
  const vertex = (index: number): Vec3 => [
    entry.col.vertices[index * 3],
    entry.col.vertices[index * 3 + 1],
    entry.col.vertices[index * 3 + 2],
  ];
  for (const face of entry.col.faces) {
    const hit = rayTriangle(origin, up, vertex(face.a), vertex(face.b), vertex(face.c));
    if (hit !== null && hit > 0) {
      crossings += 1;
    }
  }

  return crossings % 2 === 1;
}

function numberFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? Number(process.argv[index + 1]) : Number.NaN;

  return Number.isFinite(value) ? value : fallback;
}

/** Möller–Trumbore, in model space. Returns the ray parameter or null. */
function rayTriangle(origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3): null | number {
  const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p: Vec3 = [
    direction[1] * e2[2] - direction[2] * e2[1],
    direction[2] * e2[0] - direction[0] * e2[2],
    direction[0] * e2[1] - direction[1] * e2[0],
  ];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-9) {
    return null;
  }
  const inv = 1 / det;
  const t: Vec3 = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inv;
  if (u < 0 || u > 1) {
    return null;
  }
  const q: Vec3 = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
  const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * inv;
  if (v < 0 || u + v > 1) {
    return null;
  }

  return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
}

/** Rotate v by quaternion q (x, y, z, w). */
function rotate(q: readonly number[], v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const ix = qw * v[0] + qy * v[2] - qz * v[1];
  const iy = qw * v[1] + qz * v[0] - qx * v[2];
  const iz = qw * v[2] + qx * v[1] - qy * v[0];
  const iw = -qx * v[0] - qy * v[1] - qz * v[2];

  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

/** Sampled segment test against a world AABB — enough to name a wall between the spot and the target. */
function segmentBlocked(from: Vec3, to: Vec3, entry: Entry): boolean {
  for (let step = 1; step < 24; step += 1) {
    const t = step / 24;
    const p: Vec3 = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
    if (
      p[0] > entry.min[0] &&
      p[0] < entry.max[0] &&
      p[1] > entry.min[1] &&
      p[1] < entry.max[1] &&
      p[2] > entry.min[2] &&
      p[2] < entry.max[2]
    ) {
      return true;
    }
  }

  return false;
}

function stringFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** World → model space for this instance. */
function toModel(instance: PlacedInstance, world: Vec3): Vec3 {
  const local: Vec3 = [
    world[0] - instance.position[0],
    world[1] - instance.position[1],
    world[2] - instance.position[2],
  ];

  return rotate(conjugate(instance.rotation), local);
}

/** World AABB of the instance's collision — the eight ROTATED corners, not a bounding-radius swell (a long
 *  fence swelled to its radius blocks every direction and the tool answers "nowhere"). */
function worldBounds(instance: PlacedInstance, col: ColModel): { max: Vec3; min: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner += 1) {
    const local: Vec3 = [
      corner & 1 ? col.bounds.max[0] : col.bounds.min[0],
      corner & 2 ? col.bounds.max[1] : col.bounds.min[1],
      corner & 4 ? col.bounds.max[2] : col.bounds.min[2],
    ];
    const world = rotate(instance.rotation, local);
    for (let axis = 0; axis < 3; axis += 1) {
      const value = world[axis] + instance.position[axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }

  return { max, min };
}

const game = gameArg();
const src = stringFlag('src') ?? join('build', game, 'opensa');
const [target] = positionalArgs().filter((arg) => !arg.startsWith('--'));
if (!target || !existsSync(src)) {
  console.error('usage: npx tsx scripts/debug/teleport-spot.ts <model> [--game original] [--src <builtDir>]');
  console.error(`       (no built tree at ${src} — build it, or pass --src)`);
  process.exit(1);
}

const archive = openArchive(readBytes(join(src, 'models', 'gta3.img')));
const { catalog, instances } = loadMapDefsAt(src, archive);
const collision = buildCollisionIndex(archive);
const wanted = target.toLowerCase();
const placements = instances.filter((instance) => catalog.get(instance.id)?.modelName.toLowerCase() === wanted);
if (placements.length === 0) {
  console.error(`no placement of "${target}" in ${src}`);
  process.exit(1);
}
const near = stringFlag('near')?.split(',').map(Number);
const chosen =
  near && near.length >= 2
    ? [...placements].sort(
        (a, b) =>
          Math.hypot(a.position[0] - near[0], a.position[1] - near[1]) -
          Math.hypot(b.position[0] - near[0], b.position[1] - near[1]),
      )[0]
    : placements[0];

const nearby: Entry[] = [];
for (const instance of instances) {
  if (
    Math.hypot(instance.position[0] - chosen.position[0], instance.position[1] - chosen.position[1]) > NEARBY_RADIUS
  ) {
    continue;
  }
  const def = catalog.get(instance.id);
  const col = def ? collision.get(def.modelName.toLowerCase()) : undefined;
  if (def && col) {
    nearby.push({ col, instance, name: def.modelName, ...worldBounds(instance, col) });
  }
}

const targetCol = collision.get(wanted);
const targetRadius = targetCol ? Math.max(targetCol.bounds.radius, 6) : 10;
const targetCentre: Vec3 = [
  chosen.position[0],
  chosen.position[1],
  chosen.position[2] + (targetCol ? (targetCol.bounds.min[2] + targetCol.bounds.max[2]) / 2 : 2),
];
const distance = numberFlag('distance', Math.max(20, Math.round(targetRadius + 12)));
const eye = numberFlag('eye', 1.6);
const rayTop = chosen.position[2] + (targetCol?.bounds.max[2] ?? 20) + 60;

const candidates: Candidate[] = [];
for (let step = 0; step < RING_DIRECTIONS; step += 1) {
  const angle = (step / RING_DIRECTIONS) * Math.PI * 2;
  const x = chosen.position[0] + Math.cos(angle) * distance;
  const y = chosen.position[1] + Math.sin(angle) * distance;
  const ground = groundAt(x, y, rayTop, nearby);
  const candidate: Candidate = { blockedBy: null, ground, inside: null, x, y };
  if (ground !== null) {
    for (const entry of nearby) {
      if (candidate.inside === null && insideCollision(x, y, ground, entry)) {
        candidate.inside = entry.name;
      }
      if (
        candidate.blockedBy === null &&
        entry.instance !== chosen &&
        segmentBlocked([x, y, ground + eye], targetCentre, entry)
      ) {
        candidate.blockedBy = entry.name;
      }
    }
  }
  candidates.push(candidate);
}

const standable = candidates.filter((candidate) => candidate.ground !== null && candidate.inside === null);
const clear = standable.filter((candidate) => candidate.blockedBy === null);
const top = Math.round(numberFlag('top', 3));
console.log(
  `${target}: ${placements.length} placement(s) — using (${chosen.position.map((value) => value.toFixed(1)).join(', ')}), ` +
    `collision radius ${targetRadius.toFixed(1)}, ring ${distance} u, ${nearby.length} instances with collision within ${NEARBY_RADIUS} u`,
);
console.log(
  `${standable.length}/${RING_DIRECTIONS} ring spots stand on ground outside everything; ${clear.length} also see the target\n`,
);
for (const candidate of (clear.length > 0 ? clear : standable).slice(0, top)) {
  const z = (candidate.ground ?? 0) + 0.5;
  const note = candidate.blockedBy ? `  // view crosses ${candidate.blockedBy}` : '';
  console.log(
    `  { coords: [${candidate.x.toFixed(1)}, ${candidate.y.toFixed(1)}, ${z.toFixed(1)}], label: '…' },${note}`,
  );
}
if (standable.length === 0) {
  console.log('  nowhere on this ring — try another --distance. What the ring found:');
  for (const candidate of candidates.slice(0, 8)) {
    console.log(
      `    (${candidate.x.toFixed(1)}, ${candidate.y.toFixed(1)}) ground ${candidate.ground?.toFixed(1) ?? 'none'}` +
        `${candidate.inside ? ` · inside ${candidate.inside}` : ''}`,
    );
  }
}
