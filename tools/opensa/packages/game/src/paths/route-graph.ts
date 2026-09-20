/**
 * The game's own road network as a traversable graph (096/01). Pure data in, pure data out: no renderware
 * import, no fs — the adapter (`adapters/path-graph.ts`) reads `NODES*.DAT` and hands the parsed nodes here,
 * so the graph ops are testable on a synthetic five-node street.
 *
 * Adjacency is used exactly AS THE DATA GIVES IT (directed, no reverse edges invented). SA encodes traffic
 * direction in the navi nodes we do not parse, so a link is followed in the direction it is written; the
 * offline validator reports how asymmetric the real table is.
 */
import type { Random } from './rng';

/** The shape the graph needs from a parsed path node — structurally `VehiclePathNode`. */
export interface PathNodeInput {
  area: number;
  boats: boolean;
  id: number;
  links: readonly { area: number; node: number }[];
  position: readonly [number, number, number];
}

export interface RouteGraph {
  /** Index of `(area, id)`, or undefined when that node is not loaded. */
  indexOf(area: number, id: number): number | undefined;
  /** Index of the closest node to a world (x, y) within `maxDistance` (default 200 m), or undefined. */
  nearest(x: number, y: number, maxDistance?: number): number | undefined;
  readonly nodes: readonly RouteNode[];
  /** Links whose reverse edge is missing — the data's one-way entries, counted at build time. */
  readonly oneWayLinks: number;
  /** Link targets dropped because their area file was not loaded. */
  readonly unresolvedLinks: number;
}

export interface RouteNode {
  readonly area: number;
  readonly boats: boolean;
  readonly id: number;
  /** Resolved neighbour INDICES (unloadable targets dropped). */
  readonly links: readonly number[];
  readonly position: readonly [number, number, number];
}

/** Grid cell for {@link RouteGraph.nearest} — road nodes sit ~10–40 m apart, so 100 m keeps cells small. */
const CELL = 100;

/** Build the graph: index nodes by `(area, id)`, resolve every link to an index, hash positions for lookup. */
export function buildRouteGraph(input: readonly PathNodeInput[]): RouteGraph {
  const indexByKey = new Map<number, number>();
  input.forEach((node, index) => indexByKey.set(nodeKey(node.area, node.id), index));
  let unresolvedLinks = 0;
  const nodes: RouteNode[] = input.map((node) => {
    const links: number[] = [];
    for (const link of node.links) {
      const target = indexByKey.get(nodeKey(link.area, link.node));
      if (target === undefined) {
        unresolvedLinks += 1;
      } else if (target !== links[links.length - 1]) {
        links.push(target);
      }
    }

    return { area: node.area, boats: node.boats, id: node.id, links, position: node.position };
  });
  let oneWayLinks = 0;
  nodes.forEach((node, index) => {
    for (const target of node.links) {
      if (!nodes[target].links.includes(index)) {
        oneWayLinks += 1;
      }
    }
  });
  const grid = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    const key = cellKey(node.position[0], node.position[1]);
    const cell = grid.get(key);
    if (cell) {
      cell.push(index);
    } else {
      grid.set(key, [index]);
    }
  });

  return {
    indexOf: (area, id) => indexByKey.get(nodeKey(area, id)),
    nearest: (x, y, maxDistance = 200) => nearestIn(nodes, grid, x, y, maxDistance),
    nodes,
    oneWayLinks,
    unresolvedLinks,
  };
}

/** A seeded random node passing `accept`, or undefined when none does. Scans in index order for determinism. */
export function randomNode(
  graph: RouteGraph,
  random: Random,
  accept: (node: RouteNode, index: number) => boolean,
): number | undefined {
  const candidates: number[] = [];
  graph.nodes.forEach((node, index) => {
    if (accept(node, index)) {
      candidates.push(index);
    }
  });
  if (candidates.length === 0) {
    return undefined;
  }

  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
}

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
}

/** Expanding-ring search over the position hash: rings out until a hit is found or `maxDistance` is covered. */
function nearestIn(
  nodes: readonly RouteNode[],
  grid: ReadonlyMap<string, number[]>,
  x: number,
  y: number,
  maxDistance: number,
): number | undefined {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  const maxRing = Math.ceil(maxDistance / CELL);
  let best: number | undefined;
  let bestDistance = maxDistance;
  for (let ring = 0; ring <= maxRing; ring += 1) {
    for (const key of ringKeys(cx, cy, ring)) {
      for (const index of grid.get(key) ?? []) {
        const node = nodes[index];
        const distance = Math.hypot(node.position[0] - x, node.position[1] - y);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      }
    }
    // A hit inside the ring's inscribed circle cannot be beaten by a farther ring.
    if (best !== undefined && bestDistance <= ring * CELL) {
      return best;
    }
  }

  return best;
}

function nodeKey(area: number, id: number): number {
  return area * 65536 + id;
}

/** The cell keys on the square ring `ring` cells out from (cx, cy) — the interior was covered by earlier rings. */
function ringKeys(cx: number, cy: number, ring: number): string[] {
  if (ring === 0) {
    return [`${cx},${cy}`];
  }
  const keys: string[] = [];
  for (let dx = -ring; dx <= ring; dx += 1) {
    const edge = Math.abs(dx) === ring;
    for (let dy = -ring; dy <= ring; dy += edge ? 1 : 2 * ring) {
      keys.push(`${cx + dx},${cy + dy}`);
    }
  }

  return keys;
}
