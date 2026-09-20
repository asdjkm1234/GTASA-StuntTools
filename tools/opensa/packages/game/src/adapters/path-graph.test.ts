import type { AssetFileSystem } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import { loadRouteGraph, pathAreaFiles } from './path-graph';

function fsOf(files: Record<string, ArrayBuffer>): AssetFileSystem {
  return {
    get: (name): ArrayBuffer | null => files[name] ?? null,
    getText: (): null | string => null,
    has: (name) => name in files,
    names: [],
  };
}

/** One area file: header + 28-byte vehicle nodes + the link table each node indexes via `baseLink`. */
function nodesFile(nodes: readonly { linkTo?: number; x: number; y: number }[], area = 0): ArrayBuffer {
  const links = nodes.filter((node) => node.linkTo !== undefined);
  const buffer = new ArrayBuffer(20 + nodes.length * 28 + links.length * 4);
  const view = new DataView(buffer);
  view.setUint32(0, nodes.length, true);
  view.setUint32(4, nodes.length, true);
  view.setUint32(16, links.length, true);
  let linkAt = 0;
  nodes.forEach((node, index) => {
    const at = 20 + index * 28;
    view.setInt16(at + 8, node.x * 8, true);
    view.setInt16(at + 10, node.y * 8, true);
    view.setUint16(at + 16, linkAt, true);
    view.setUint16(at + 18, area, true);
    view.setUint16(at + 20, index, true);
    view.setUint32(at + 24, node.linkTo === undefined ? 0 : 1, true);
    if (node.linkTo !== undefined) {
      view.setUint16(20 + nodes.length * 28 + linkAt * 4, area, true);
      view.setUint16(20 + nodes.length * 28 + linkAt * 4 + 2, node.linkTo, true);
      linkAt += 1;
    }
  });

  return buffer;
}

describe('loadRouteGraph', () => {
  describe('negative cases', () => {
    it('returns null when the game ships no path graph at all', () => {
      // The reachable path for a total conversion — anderius, gostown and carcer have no `data/Paths`
      // (docs/restrictions/assets-and-data.md). A caller that never checks reads it as "no roads here".
      expect(loadRouteGraph(fsOf({}))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('reads the lowercase build spelling and the stock uppercase one alike', () => {
      const built = pathAreaFiles(fsOf({ 'data/paths/nodes0.dat': nodesFile([{ x: 1, y: 2 }]) }));
      const stock = pathAreaFiles(fsOf({ 'data/Paths/NODES0.DAT': nodesFile([{ x: 1, y: 2 }]) }));

      expect(built.size).toBe(1);
      expect(stock.size).toBe(1);
    });

    it('builds one graph across every present area file, links resolved', () => {
      const graph = loadRouteGraph(
        fsOf({
          'data/paths/nodes0.dat': nodesFile(
            [
              { linkTo: 1, x: 0, y: 0 },
              { x: 0, y: 20 },
            ],
            0,
          ),
          'data/paths/nodes3.dat': nodesFile([{ x: 100, y: 100 }], 3),
        }),
      )!;

      expect(graph.nodes.length).toBe(3);
      expect(graph.nodes[0].links).toEqual([1]);
      expect(graph.indexOf(3, 0)).toBe(2);
      expect(graph.nearest(0, 19)).toBe(1);
    });
  });
});
