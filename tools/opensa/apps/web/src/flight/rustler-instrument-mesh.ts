/** Five measured stock Rustler dial faces; a separate replay model leaves authored assets intact. */
import type { VehicleModelInit } from '@opensa/engine';
import type { VehicleModelData } from '@opensa/renderware';

import { ATLAS_SIZE, INSTRUMENT_ATLAS } from './cockpit-instrument-mesh';

type Point = readonly [number, number, number];
export const RUSTLER_INSTRUMENT_ATLAS = {
  altitude: INSTRUMENT_ATLAS.altitude,
  attitude: INSTRUMENT_ATLAS.attitude,
  compass: [0, 360, 300, 300],
  speed: INSTRUMENT_ATLAS.speed,
  status: [340, 360, 300, 300],
} as const;
export const RUSTLER_DIAL_NORMAL: Point = [0, -Math.cos((29 * Math.PI) / 180), Math.sin((29 * Math.PI) / 180)];
const UP: Point = [0, RUSTLER_DIAL_NORMAL[2], -RUSTLER_DIAL_NORMAL[1]];
const STOCK_RADIUS = 0.08195275;
export const RUSTLER_DIALS = [
  { center: [-0.087519258, 0.541139364, 0.244127482], name: 'speed' },
  { center: [0.087519258, 0.541139364, 0.244127482], name: 'altitude' },
  { center: [-0.190639466, 0.44518733, 0.083278142], name: 'compass' },
  { center: [0, 0.44518733, 0.083278142], name: 'attitude' },
  { center: [0.190639466, 0.44518733, 0.083278142], name: 'status' },
] as const;

export function buildRustlerInstrumentMesh(rgba: Uint8Array): VehicleModelInit {
  const colors: number[] = [],
    indices: number[] = [],
    meta: number[] = [],
    normals: number[] = [],
    positions: number[] = [],
    uvs: number[] = [];
  const white = 1023.5 / ATLAS_SIZE;
  const vertex = (p: Point, uv: readonly [number, number], color = 255, illuminated = true): number => {
    const index = positions.length / 3;
    positions.push(...p);
    normals.push(...RUSTLER_DIAL_NORMAL);
    colors.push(color, color, color, 255);
    meta.push(0, 0, 0, illuminated ? 7 << 4 : 0);
    uvs.push(...uv);

    return index;
  };
  for (const { center, name } of RUSTLER_DIALS) {
    const rect = RUSTLER_INSTRUMENT_ATLAS[name];
    const uv = (x: number, y: number): [number, number] => [
      (rect[0] + 0.5 + x * (rect[2] - 1)) / ATLAS_SIZE,
      (rect[1] + 0.5 + y * (rect[3] - 1)) / ATLAS_SIZE,
    ];
    const hub = vertex(dialPoint(center, 0, 0, 0.002), uv(0.5, 0.5));
    const rim = positions.length / 3;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      vertex(dialPoint(center, 0.079, a, 0.002), uv(0.5 + 0.5 * Math.cos(a), 0.5 - 0.5 * Math.sin(a)));
    }
    for (let i = 0; i < 8; i++) {
      indices.push(hub, rim + i, rim + ((i + 1) % 8));
      const a = (i * Math.PI) / 4,
        b = ((i + 1) * Math.PI) / 4;
      const start = positions.length / 3;
      for (const [angle, radius, depth, color] of [
        [a, 0.079, 0.002, 35],
        [a, STOCK_RADIUS, 0.001, 83],
        [b, STOCK_RADIUS, 0.001, 83],
        [b, 0.079, 0.002, 35],
      ] as const)
        vertex(dialPoint(center, radius, angle, depth), [white, white], color, false);
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const bytes = (values: number[]): Uint8Array => new Uint8Array(new Float32Array(values).buffer);
  const vertexCount = positions.length / 3;

  return {
    colors: new Uint8Array(colors),
    indexCount: indices.length,
    indices: new Uint8Array(new Uint16Array(indices).buffer),
    meta: new Uint8Array(meta),
    night: new Uint8Array(colors),
    normals: bytes(normals),
    parts: [{ localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'rustler_instruments' }],
    positions: bytes(positions),
    reflect: new Uint8Array(vertexCount * 4),
    submeshes: [
      {
        array: 0,
        center: [0, 0.48, 0.18],
        indexCount: indices.length,
        indexOffset: 0,
        part: 0,
        radius: 0.33,
        translucent: false,
      },
    ],
    textures: [{ height: ATLAS_SIZE, kind: 'rgba', layers: 1, rgba, width: ATLAS_SIZE }],
    uvs: bytes(uvs),
    vertexCount,
  };
}

/** Require all five complete octagonal fans, their normals/material and the untransformed stock seat. */
export function fitsRustlerDashboard(data: VehicleModelData, model: number): boolean {
  const chassis = data.parts[0];
  const seat = data.dummies.find((d) => d.name === 'ped_frontseat');
  if (
    model !== 476 ||
    !chassis ||
    chassis.name !== 'chassis' ||
    chassis.offset ||
    Math.hypot(...chassis.localTranslation) > 0.001 ||
    Math.hypot(...chassis.localRotation.slice(0, 3)) > 0.001 ||
    Math.abs(chassis.localRotation[3] - 1) > 0.001 ||
    Math.abs((chassis.scale ?? 1) - 1) > 0.001 ||
    !seat ||
    Math.hypot(seat.position[0], seat.position[1] + 0.45018509, seat.position[2] + 0.316607118) > 0.002
  )
    return false;

  return RUSTLER_DIALS.every(({ center }) => {
    const edges = new Set<string>();
    let count = 0;
    for (const mesh of data.submeshes) {
      if (mesh.kind !== 'body' || mesh.part !== 0 || mesh.translucent) continue;
      for (let at = mesh.indexOffset; at < mesh.indexOffset + mesh.indexCount; at += 3) {
        const corners = Array.from(data.indices.subarray(at, at + 3)).map((vertex) => {
          const p = data.positions.subarray(vertex * 3, vertex * 3 + 3);
          const delta = Array.from(p, (v, i) => v - center[i]);
          const distance = Math.hypot(...delta);
          const normal = data.normals.subarray(vertex * 3, vertex * 3 + 3);
          const alignment = normal.reduce((sum, v, i) => sum + v * RUSTLER_DIAL_NORMAL[i], 0);
          if (data.texture.names[data.meta[vertex * 4]] !== 'rustler92body256' || alignment < 0.999) return -1;
          if (distance < 0.0002) return 8;
          if (Math.abs(distance - STOCK_RADIUS) > 0.0002) return -1;
          const vertical = delta.reduce((sum, v, i) => sum + v * UP[i], 0);
          const angle = Math.atan2(vertical, delta[0]);
          const slot = ((Math.round((angle * 4) / Math.PI) % 8) + 8) % 8;
          const expected = dialPoint(center, STOCK_RADIUS, (slot * Math.PI) / 4, 0);

          return Math.hypot(...Array.from(p, (v, i) => v - expected[i])) < 0.0002 ? slot : -1;
        });
        if (corners.some((v) => v < 0) || !corners.includes(8)) continue;
        const edge = corners.filter((v) => v !== 8).sort((a, b) => a - b);
        if (edge.length !== 2 || ![1, 7].includes(edge[1] - edge[0])) return false;
        edges.add(edge.join(','));
        count++;
      }
    }

    return count === 8 && edges.size === 8;
  });
}

function dialPoint(center: Point, radius: number, angle: number, depth: number): Point {
  const v = radius * Math.sin(angle),
    x = radius * Math.cos(angle);

  return center.map((p, i) => p + (i === 0 ? x : v * UP[i]) + depth * RUSTLER_DIAL_NORMAL[i]) as unknown as Point;
}
