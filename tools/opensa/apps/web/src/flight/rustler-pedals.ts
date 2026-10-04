/** P-51-inspired replay pedals fitted to the stock Rustler footwell, not measured aircraft hardware. */
import type { Engine, VehicleModelInit, VehicleSubmesh } from '@opensa/engine';

import type { CockpitPedals } from './cockpit-pedals';
import type { Quat, Vec3 } from './math';

import { createCockpitPedals } from './cockpit-pedals';

const SIZE = 256;
const PEDAL_X = 0.17;
const PIVOT_Y = 0.68;
const PIVOT_Z = -0.04;
const TILT = (-12 * Math.PI) / 180;
export const RUSTLER_PEDAL_ARM = [-0.21, -0.26] as const;

/** Fixed cross shaft + two rigid suspended plates with rounded corners, raised rim and heel lip. */
export function buildRustlerPedalMesh(rgba: Uint8Array): VehicleModelInit {
  const colors: number[] = [],
    indices: number[] = [],
    night: number[] = [],
    normals: number[] = [],
    positions: number[] = [],
    uvs: number[] = [];
  const submeshes: VehicleSubmesh[] = [];
  const white = 255.5 / SIZE;
  const vertex = (p: Vec3, n: Vec3, color: number, uv: [number, number] = [white, white]): number => {
    const index = positions.length / 3;
    positions.push(...p);
    normals.push(...n);
    colors.push(color, color, color, 255);
    night.push(Math.round(color * 0.55), Math.round(color * 0.55), Math.round(color * 0.55), 255);
    uvs.push(...uv);

    return index;
  };
  function quad(points: Vec3[], color: number): void {
    const u = points[1].map((v, i) => v - points[0][i]);
    const v = points[2].map((p, i) => p - points[0][i]);
    const cross: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...cross);
    const n = cross.map((p) => p / length) as Vec3;
    const ids = points.map((p) => vertex(p, n, color));
    indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  function box(center: Vec3, size: Vec3, color: number, tilt = 0): void {
    const point = (x: number, y: number, z: number): Vec3 => [
      center[0] + (x * size[0]) / 2,
      center[1] + (y * size[1] * Math.cos(tilt) - z * size[2] * Math.sin(tilt)) / 2,
      center[2] + (y * size[1] * Math.sin(tilt) + z * size[2] * Math.cos(tilt)) / 2,
    ];
    for (const corners of [
      [
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
        [-1, -1, 1],
      ],
      [
        [1, 1, -1],
        [-1, 1, -1],
        [-1, 1, 1],
        [1, 1, 1],
      ],
      [
        [-1, 1, -1],
        [-1, -1, -1],
        [-1, -1, 1],
        [-1, 1, 1],
      ],
      [
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
        [1, -1, 1],
      ],
      [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
      [
        [-1, 1, -1],
        [1, 1, -1],
        [1, -1, -1],
        [-1, -1, -1],
      ],
    ])
      quad(
        corners.map(([x, y, z]) => point(x, y, z)),
        color,
      );
  }
  function group(part: number, start: number, center: Vec3, radius: number): void {
    submeshes.push({
      array: 0,
      center,
      indexCount: indices.length - start,
      indexOffset: start,
      part,
      radius,
      translucent: false,
    });
  }
  box([0, PIVOT_Y, PIVOT_Z], [PEDAL_X * 2 + 0.045, 0.025, 0.025], 110);
  for (const side of [-1, 1]) box([side * PEDAL_X, PIVOT_Y + 0.025, PIVOT_Z], [0.036, 0.065, 0.045], 85);
  group(0, 0, [0, PIVOT_Y, PIVOT_Z], 0.23);

  const [armY, armZ] = RUSTLER_PEDAL_ARM;
  const point = ([x, y, z]: Vec3): Vec3 => [
    x,
    armY + y * Math.cos(TILT) - z * Math.sin(TILT),
    armZ + y * Math.sin(TILT) + z * Math.cos(TILT),
  ];
  const normal = ([x, y, z]: Vec3): Vec3 => [
    x,
    y * Math.cos(TILT) - z * Math.sin(TILT),
    y * Math.sin(TILT) + z * Math.cos(TILT),
  ];
  const outline: [number, number][] = [];
  for (const [cx, cz, start] of [
    [-0.038, 0.068, 180],
    [0.038, 0.068, 90],
    [0.038, -0.068, 0],
    [-0.038, -0.068, -90],
  ]) {
    for (let step = 0; step <= 6; step++) {
      const angle = ((start - step * 15) * Math.PI) / 180;
      outline.push([cx + 0.022 * Math.cos(angle), cz + 0.022 * Math.sin(angle)]);
    }
  }
  for (let part = 1; part <= 2; part++) {
    const start = indices.length;
    box([0, 0, 0], [0.032, 0.035, 0.036], 115);
    const attachment = point([0, 0.025, 0]);
    box(
      [0, attachment[1] / 2, attachment[2] / 2],
      [0.025, 0.018, Math.hypot(attachment[1], attachment[2])],
      85,
      Math.atan2(-attachment[1], attachment[2]),
    );
    box(attachment, [0.065, 0.038, 0.065], 100, TILT);
    const faceVertex = (x: number, z: number): number =>
      vertex(point([x, -0.006, z]), normal([0, -1, 0]), 255, [
        0.02 + ((x + 0.06) / 0.12) * 0.96,
        0.02 + ((0.09 - z) / 0.18) * 0.96,
      ]);
    const front = faceVertex(0, 0);
    const back = vertex(point([0, 0.006, 0]), normal([0, 1, 0]), 85);
    for (let edge = 0; edge < outline.length; edge++) {
      const a = outline[edge];
      const b = outline[(edge + 1) % outline.length];
      indices.push(front, faceVertex(b[0] * 0.91, b[1] * 0.94), faceVertex(a[0] * 0.91, a[1] * 0.94));
      indices.push(
        back,
        vertex(point([a[0], 0.006, a[1]]), normal([0, 1, 0]), 85),
        vertex(point([b[0], 0.006, b[1]]), normal([0, 1, 0]), 85),
      );
      quad(
        [
          point([a[0], -0.008, a[1]]),
          point([b[0], -0.008, b[1]]),
          point([b[0], 0.006, b[1]]),
          point([a[0], 0.006, a[1]]),
        ],
        110,
      );
      quad(
        [
          point([a[0] * 0.91, -0.006, a[1] * 0.94]),
          point([b[0] * 0.91, -0.006, b[1] * 0.94]),
          point([b[0], -0.008, b[1]]),
          point([a[0], -0.008, a[1]]),
        ],
        150,
      );
    }
    // Raised lower lip and side edges remain a single rigid plate throughout its swing.
    box(point([0, -0.024, -0.076]), [0.108, 0.045, 0.024], 135, TILT);
    for (const side of [-1, 1]) box(point([side * 0.054, -0.015, -0.056]), [0.012, 0.025, 0.045], 115, TILT);
    group(part, start, [0, armY / 2, armZ / 2], 0.3);
  }
  const bytes = (values: number[]): Uint8Array => new Uint8Array(new Float32Array(values).buffer);
  const vertexCount = positions.length / 3;

  return {
    colors: new Uint8Array(colors),
    indexCount: indices.length,
    indices: new Uint8Array(new Uint16Array(indices).buffer),
    meta: new Uint8Array(vertexCount * 4),
    night: new Uint8Array(night),
    normals: bytes(normals),
    parts: [
      { localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'rustler_pedal_mounts' },
      ...[-1, 1].map((side) => ({
        localRotation: [0, 0, 0, 1] as Quat,
        localTranslation: [side * PEDAL_X, PIVOT_Y, PIVOT_Z] as Vec3,
        name: side < 0 ? 'rustler_pedal_left' : 'rustler_pedal_right',
      })),
    ],
    positions: bytes(positions),
    reflect: new Uint8Array(vertexCount * 4),
    submeshes,
    textures: [{ height: SIZE, kind: 'rgba', layers: 1, rgba, width: SIZE }],
    uvs: bytes(uvs),
    vertexCount,
  };
}

/** One static texture, shared by both plates; it never updates or touches the streamed map arrays. */
export function createRustlerPedals(engine: Engine): CockpitPedals {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Rustler pedal markings require Canvas2D');
  c.fillStyle = '#5e6958';
  c.fillRect(0, 0, SIZE, SIZE);
  c.textAlign = 'center';
  c.font = 'bold 29px sans-serif';
  c.fillStyle = '#c4c9b6';
  c.fillText('NAA', 128, 51);
  c.fillRect(57, 58, 142, 2);
  c.font = 'bold 19px sans-serif';
  for (const [i, text] of ['DEPRESS PEDAL', 'TO RELEASE', 'PARKING BRAKE'].entries()) {
    c.fillStyle = '#323b30';
    c.fillText(text, 129, 101 + i * 25);
    c.fillStyle = '#c4c9b6';
    c.fillText(text, 128, 100 + i * 25);
  }
  c.fillStyle = '#fff';
  c.fillRect(254, 254, 2, 2);

  return createCockpitPedals(
    engine,
    buildRustlerPedalMesh(new Uint8Array(c.getImageData(0, 0, SIZE, SIZE).data.buffer)),
    RUSTLER_PEDAL_ARM,
  );
}
