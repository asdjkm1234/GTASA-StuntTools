/**
 * SA path-network nodes (`data/Paths/NODES0..63.DAT`) — the game's own road graph. Parsed for VEHICLE
 * nodes only (the bench-cars road placement, 074 bench realism; the city-life chain will grow this into
 * the full graph). Each area file: header `[nodes, vehNodes, pedNodes, naviNodes, links]`, then 28-byte
 * nodes (vehicle nodes first, ped nodes after), 14-byte navi nodes (skipped), then the link table
 * (`[area u16, node u16]` pairs) the nodes index via `baseLink`. Trailing tables (link lengths, path
 * intersections) are ignored.
 */

/** A link target: the node `id` inside area file `area` (links cross area files). */
export interface VehiclePathLink {
  area: number;
  node: number;
}

/** One VEHICLE path node, world-resolved: position, road width, and the heading toward its first link. */
export interface VehiclePathNode {
  area: number;
  /** Water node (ferry/boat routes) — bit 7 of the flags; road cars must skip these. */
  boats: boolean;
  /** Radians about GTA +Z toward the first linked node (0 = facing +Y); 0 when the node has no links. */
  heading: number;
  id: number;
  linkCount: number;
  /** This node's `linkCount` entries of the area's link table — the graph's adjacency. Targets in an area
   *  file that was not supplied are KEPT verbatim (they are real links, just unloadable here); a graph
   *  builder drops what it cannot resolve. Shorter than `linkCount` only on a truncated table. */
  links: readonly VehiclePathLink[];
  /** Native GTA coordinates (Z-up), already divided by the format's ×8 fixed point. */
  position: [number, number, number];
}

interface AreaFile {
  links: { area: number; node: number }[];
  nodes: RawNode[];
}

interface RawNode {
  area: number;
  baseLink: number;
  boats: boolean;
  id: number;
  linkCount: number;
  position: [number, number, number];
}

const HEADER_BYTES = 20;
const NODE_BYTES = 28;
const NAVI_BYTES = 14;

/**
 * Parse every provided area file and resolve each vehicle node's heading through the link table (links may
 * cross area files — headings resolve after all areas are read). Missing areas are fine: nodes whose first
 * link points into an absent area keep heading 0.
 */
export function vehiclePathNodes(areas: ReadonlyMap<number, ArrayBuffer>): VehiclePathNode[] {
  const files = new Map<number, AreaFile>();
  for (const [area, buffer] of areas) {
    files.set(area, parseArea(buffer));
  }
  const nodeAt = (area: number, id: number): RawNode | undefined => files.get(area)?.nodes[id];
  const resolved: VehiclePathNode[] = [];
  for (const file of files.values()) {
    for (const node of file.nodes) {
      const links = file.links.slice(node.baseLink, node.baseLink + node.linkCount).filter(Boolean);
      let heading = 0;
      if (links.length > 0) {
        const target = nodeAt(links[0].area, links[0].node);
        if (target) {
          // GTA heading: 0 = facing +Y, counter-clockwise about +Z (the car-generator convention).
          heading = Math.atan2(-(target.position[0] - node.position[0]), target.position[1] - node.position[1]);
        }
      }
      resolved.push({
        area: node.area,
        boats: node.boats,
        heading,
        id: node.id,
        linkCount: node.linkCount,
        links,
        position: node.position,
      });
    }
  }

  return resolved;
}

/** One area file → its VEHICLE nodes (ped nodes skipped) + the raw link table. */
function parseArea(buffer: ArrayBuffer): AreaFile {
  const view = new DataView(buffer);
  const totalNodes = view.getUint32(0, true);
  const vehicleNodes = view.getUint32(4, true);
  const naviNodes = view.getUint32(12, true);
  const linkCount = view.getUint32(16, true);
  const nodes: RawNode[] = [];
  for (let index = 0; index < vehicleNodes; index += 1) {
    const at = HEADER_BYTES + index * NODE_BYTES;
    const flags = view.getUint32(at + 24, true);
    nodes.push({
      area: view.getUint16(at + 18, true),
      baseLink: view.getUint16(at + 16, true),
      boats: (flags & 0x80) !== 0,
      id: view.getUint16(at + 20, true),
      linkCount: flags & 0xf,
      position: [view.getInt16(at + 8, true) / 8, view.getInt16(at + 10, true) / 8, view.getInt16(at + 12, true) / 8],
    });
  }
  const linksAt = HEADER_BYTES + totalNodes * NODE_BYTES + naviNodes * NAVI_BYTES;
  const links: AreaFile['links'] = [];
  for (let index = 0; index < linkCount; index += 1) {
    const at = linksAt + index * 4;
    links.push({ area: view.getUint16(at, true), node: view.getUint16(at + 2, true) });
  }

  return { links, nodes };
}
