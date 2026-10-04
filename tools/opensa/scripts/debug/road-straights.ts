import { vehiclePathNodes } from '@opensa/renderware/parsers/binary/paths';
/**
 * Throwaway (081/01): find real, straight, flat road runs for the scripted physics scenes.
 *
 * Walks the game's OWN vehicle path graph and reports chains of nodes whose heading and height barely
 * change — a brake strip needs a long level straight, and guessing coordinates from memory is exactly the
 * kind of unverified number this chain forbids.
 *
 * Run: `npx tsx scripts/debug/.tmp-phys-spots.ts [minLength=200] [--game original]`
 */
import { readFileSync } from 'node:fs';

import { gameArg, gameDir, positionalArgs } from '../lib/game';

const game = gameArg();
const [lengthArg] = positionalArgs();
const minLength = Number(lengthArg ?? 200);

const areas = new Map<number, ArrayBuffer>();
for (let area = 0; area < 64; area += 1) {
  try {
    const bytes = readFileSync(gameDir(game, 'data', 'Paths', `NODES${area}.DAT`));

    areas.set(area, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch {
    // missing area file — fine
  }
}

const nodes = vehiclePathNodes(areas).filter((node) => !node.boats && node.linkCount > 0 && node.position[2] < 500);
console.log(`vehicle nodes: ${nodes.length} from ${areas.size} area files`);

/** Bucket nodes into a coarse grid so a neighbour search does not go quadratic over 60k nodes. */
const CELL = 40;
const grid = new Map<string, typeof nodes>();
const key = (x: number, y: number): string => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
for (const node of nodes) {
  const cellKey = key(node.position[0], node.position[1]);
  const cell = grid.get(cellKey) ?? [];
  cell.push(node);
  grid.set(cellKey, cell);
}
const near = (x: number, y: number): typeof nodes => {
  const found: typeof nodes = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      found.push(...(grid.get(key(x + dx * CELL, y + dy * CELL)) ?? []));
    }
  }

  return found;
};

const angleDelta = (a: number, b: number): number => {
  const delta = ((a - b + Math.PI) % (2 * Math.PI)) - Math.PI;

  return Math.abs(delta < -Math.PI ? delta + 2 * Math.PI : delta);
};

/** Walk forward along the heading, hopping to the nearest node ahead that keeps the same bearing. */
const HEADING_TOLERANCE = 0.09; // ~5°
const MAX_HOP = 45;
const runs: {
  end: [number, number, number];
  heading: number;
  length: number;
  slope: number;
  start: (typeof nodes)[number];
}[] = [];
const crests: { drop: number; heading: number; rise: number; run: number; start: [number, number, number] }[] = [];
for (const start of nodes) {
  let current = start;
  let travelled = 0;
  let minZ = start.position[2];
  let maxZ = start.position[2];
  /** The z profile along this straight run — a crest is a rise then a fall inside it. */
  const profile: { at: number; z: number }[] = [{ at: 0, z: start.position[2] }];
  const visited = new Set<string>([`${current.area}:${current.id}`]);
  for (;;) {
    const forward: [number, number] = [-Math.sin(start.heading), Math.cos(start.heading)];
    let best: (typeof nodes)[number] | null = null;
    let bestDistance = Infinity;
    for (const candidate of near(current.position[0], current.position[1])) {
      const id = `${candidate.area}:${candidate.id}`;
      if (visited.has(id)) {
        continue;
      }
      const dx = candidate.position[0] - current.position[0];
      const dy = candidate.position[1] - current.position[1];
      const along = dx * forward[0] + dy * forward[1];
      const across = Math.abs(dx * forward[1] - dy * forward[0]);
      const distance = Math.hypot(dx, dy);
      if (along <= 1 || across > 3 || distance > MAX_HOP) {
        continue;
      }
      if (angleDelta(candidate.heading, start.heading) > HEADING_TOLERANCE) {
        continue;
      }
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (!best) {
      break;
    }
    visited.add(`${best.area}:${best.id}`);
    travelled += bestDistance;
    minZ = Math.min(minZ, best.position[2]);
    maxZ = Math.max(maxZ, best.position[2]);
    profile.push({ at: travelled, z: best.position[2] });
    current = best;
  }
  // A crest: the highest point of this run has a real climb before it and a real drop after, both inside a
  // launch-length window. That is a jump a car can be driven over at speed, not a hillside.
  if (profile.length >= 4 && travelled >= 80) {
    let peak = 0;
    for (let i = 1; i < profile.length; i += 1) {
      if (profile[i].z > profile[peak].z) {
        peak = i;
      }
    }
    const before = profile.filter((point) => profile[peak].at - point.at > 0 && profile[peak].at - point.at < 50);
    const after = profile.filter((point) => point.at - profile[peak].at > 0 && point.at - profile[peak].at < 50);
    const rise = before.length > 0 ? profile[peak].z - Math.min(...before.map((point) => point.z)) : 0;
    const drop = after.length > 0 ? profile[peak].z - Math.min(...after.map((point) => point.z)) : 0;
    if (rise >= 3 && rise <= 12 && drop >= 3 && drop <= 12 && travelled <= 220) {
      crests.push({ drop, heading: start.heading, rise, run: travelled, start: start.position });
    }
  }
  if (travelled >= minLength) {
    runs.push({
      end: current.position,
      heading: start.heading,
      length: travelled,
      slope: maxZ - minZ,
      start,
    });
  }
}

runs.sort((a, b) => a.slope - b.slope || b.length - a.length);
console.log(`\nstraight runs ≥ ${minLength} m, flattest first (top 25):`);
for (const run of runs.slice(0, 25)) {
  const [x, y, z] = run.start.position;
  console.log(
    `  ${run.length.toFixed(0)} m  Δz ${run.slope.toFixed(2)} m  from (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) ` +
      `heading ${run.heading.toFixed(3)} rad  → (${run.end[0].toFixed(1)}, ${run.end[1].toFixed(1)})`,
  );
}

crests.sort((a, b) => b.rise + b.drop - (a.rise + a.drop));
console.log(`\ncrests on a straight approach (rise ≥ 3 m then drop ≥ 3 m within 90 m), steepest first (top 15):`);
for (const crest of crests.slice(0, 15)) {
  const [x, y, z] = crest.start;
  console.log(
    `  rise ${crest.rise.toFixed(1)} m / drop ${crest.drop.toFixed(1)} m over a ${crest.run.toFixed(0)} m run  ` +
      `start (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) heading ${crest.heading.toFixed(3)} rad`,
  );
}
