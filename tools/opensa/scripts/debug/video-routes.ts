/**
 * 096/01 — validate the video mode's route builder OFFLINE, before a single in-game frame.
 *
 * Walks the game's own vehicle path graph (`NODES*.DAT`) exactly as the sequencer will, per region and per
 * seed, and prints what came back: how many routes reached the target length, why the rest stopped, and the
 * numbers a shot is framed against (length, sharpest junction turn, tightest smoothed corner, straightness).
 * This is also how a HARD route is picked deliberately for the phase-02 field rounds — `--worst` lists the
 * tightest corners the builder is willing to hand a car.
 *
 * Run: `npx tsx scripts/debug/video-routes.ts [<game-dir>] [--seeds 5] [--tries 40] [--to 25] [--worst 5]`
 * The dir defaults to `build/original/opensa` — a field run reads the BUILT tree, so the routes are
 * validated against the same `data/` the game will drive.
 */
import type { City, CityBox } from '@opensa/game/zones/city';

import { loadRouteGraph } from '@opensa/game/adapters/path-graph';
import { mulberry32 } from '@opensa/game/paths/rng';
import { type Route, walkRoute } from '@opensa/game/paths/route-builder';
import { randomNode } from '@opensa/game/paths/route-graph';
import { cityAt, cityFromLevel, isDesertZone } from '@opensa/game/zones/city';
import { openGameDir } from '@opensa/opensa-pack/game-fs';
import { parseZones } from '@opensa/renderware';
import { existsSync } from 'node:fs';

/** D2's cycle order — Los Santos first, desert last. */
const REGIONS: City[] = ['LA', 'VEGAS', 'SF', 'COUNTRYSIDE', 'DESERT'];
/** Turn buckets for the straightness histogram (degrees, upper bound exclusive). */
const BUCKETS = [5, 15, 25, 35];

const flag = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(`--${name}`);

  return at >= 0 && process.argv[at + 1] ? Number(process.argv[at + 1]) : fallback;
};

const dir = process.argv[2]?.startsWith('--') ? 'build/original/opensa' : (process.argv[2] ?? 'build/original/opensa');
const seeds = flag('seeds', 5);
const tries = flag('tries', 40);
const toSeconds = flag('to', 25);
const cruise = flag('cruise', 12);
const worstCount = flag('worst', 5);
const targetLength = toSeconds * cruise * 1.3;

if (!existsSync(dir)) {
  console.error(`no such game dir: ${dir}`);
  process.exit(1);
}
const fs = openGameDir(dir);
const graph = loadRouteGraph(fs);
if (!graph) {
  // Only the `original` variant ships one — the total conversions (anderius, gostown, carcer) have no
  // `data/Paths` at all, so video mode's drive scenes cannot exist there.
  console.error(`no path graph under ${dir} (data/paths/nodes*.dat)`);
  process.exit(1);
}
console.log(
  `${dir}: ${graph.nodes.length} vehicle nodes · ${graph.unresolvedLinks} unresolved links · ` +
    `${graph.oneWayLinks} links without a reverse edge`,
);
console.log(
  `target ${targetLength.toFixed(0)} m (${toSeconds} s × ${cruise} m/s × 1.3), ${seeds} seeds × ${tries} tries\n`,
);

// The region predicate phase 05 will supply from the host's own boxes; assembled here the same way the host
// does it (`engine-canvas-host.tsx`): desert counties FIRST, so they win over the coarse Las Venturas box.
const infoZones = parseZones(fs.getText('data/info.zon') ?? '');
const boxes: CityBox[] = [
  ...infoZones.flatMap((zone) =>
    isDesertZone(zone.label) ? [{ city: 'DESERT' as const, max: zone.max, min: zone.min }] : [],
  ),
  ...parseZones(fs.getText('data/map.zon') ?? '').flatMap((zone) => {
    const city = cityFromLevel(zone.level);

    return city ? [{ city, max: zone.max, min: zone.min }] : [];
  }),
];

const worst: { radius: number; region: City; route: Route; seed: number }[] = [];
for (const region of REGIONS) {
  const inRegion = (x: number, y: number): boolean => cityAt(x, y, boxes) === region;
  const accepted: Route[] = [];
  const rejects = { 'dead-end': 0, 'no-start': 0, region: 0, 'too-tight': 0 };
  let outside = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const random = mulberry32(seed * 7919);
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const start = randomNode(
        graph,
        random,
        (node) => !node.boats && node.links.length > 0 && inRegion(node.position[0], node.position[1]),
      );
      const route =
        start === undefined ? null : walkRoute(graph, start, random, { cruiseSpeed: cruise, inRegion, targetLength });
      if (!route) {
        rejects['no-start'] += 1;
        continue;
      }
      if (route.stop !== 'target') {
        rejects[route.stop] += 1;
        continue;
      }
      accepted.push(route);
      outside += route.points.filter((point) => !inRegion(point.position[0], point.position[1])).length;
      worst.push({ radius: route.minCurveRadius, region, route, seed });
    }
  }
  const histogram = BUCKETS.map((bound, index) => {
    const lower = index === 0 ? 0 : BUCKETS[index - 1];
    const turns = accepted.flatMap((route) => route.turnsDeg);
    const share =
      turns.length === 0 ? 0 : (turns.filter((turn) => turn >= lower && turn < bound).length / turns.length) * 100;

    return `<${bound}° ${share.toFixed(0)}%`;
  });
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  console.log(
    `${region.padEnd(12)} accepted ${String(accepted.length).padStart(3)}/${seeds * tries}` +
      `  rejected too-tight ${rejects['too-tight']}, dead-end ${rejects['dead-end']}, ` +
      `region ${rejects.region}, no-start ${rejects['no-start']}`,
  );
  if (accepted.length > 0) {
    console.log(
      `             mean length ${mean(accepted.map((route) => route.length)).toFixed(0)} m · ` +
        `mean nodes ${mean(accepted.map((route) => route.nodes.length)).toFixed(1)} · ` +
        `max turn ${Math.max(...accepted.map((route) => route.maxTurnDeg)).toFixed(1)}° · ` +
        `tightest corner ${Math.min(...accepted.map((route) => route.minCurveRadius)).toFixed(1)} m · ` +
        `points outside the region ${outside}`,
    );
    console.log(`             straightness: ${histogram.join(' · ')}\n`);
  } else {
    console.log('             (no route reached the target length)\n');
  }
}

worst.sort((a, b) => a.radius - b.radius);
console.log(`the ${worstCount} hardest accepted routes (tightest corner first) — phase 02 field candidates:`);
for (const entry of worst.slice(0, worstCount)) {
  const [x, y, z] = entry.route.points[0].position;
  console.log(
    `  ${entry.region.padEnd(12)} seed ${entry.seed}  corner ${entry.radius.toFixed(1)} m  ` +
      `max turn ${entry.route.maxTurnDeg.toFixed(1)}°  ${entry.route.length.toFixed(0)} m  ` +
      `slowest ${Math.min(...entry.route.points.map((point) => point.speed)).toFixed(1)} m/s  ` +
      `from (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`,
  );
}
