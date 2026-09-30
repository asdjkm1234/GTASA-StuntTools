import type { VehicleModelInit, VehicleSubmesh } from '@opensa/engine';
import type { VehicleModelData } from '@opensa/renderware';

/** Atlas rectangles in pixels. The heading has alpha; the dashboard faces are opaque. */
export const INSTRUMENT_ATLAS = {
  altitude: [680, 0, 300, 300],
  attitude: [340, 0, 300, 300],
  gear: [680, 512, 300, 170],
  heading: [0, 720, 512, 256],
  health: [0, 360, 960, 128],
  nozzle: [340, 512, 300, 170],
  speed: [0, 0, 300, 300],
  throttle: [0, 512, 300, 170],
} as const;
export const ATLAS_SIZE = 1024;
type Point = readonly [number, number, number];
type Rect = readonly [number, number, number, number];

/** Fail closed for an aftermarket cockpit: these measured anchors belong to the stock Hydra. */
export function fitsHydraDashboard(data: VehicleModelData, model: number): boolean {
  if (model !== 520) return false;
  const chassis = data.parts[0];
  if (
    !chassis ||
    chassis.name !== 'chassis' ||
    Math.hypot(...chassis.localTranslation) > 0.001 ||
    Math.hypot(...chassis.localRotation.slice(0, 3)) > 0.001 ||
    Math.abs(chassis.localRotation[3] - 1) > 0.001 ||
    Math.abs((chassis.scale ?? 1) - 1) > 0.001
  )
    return false;
  const seat = data.dummies.find((d) => d.name === 'ped_frontseat');
  if (!seat || Math.hypot(seat.position[0], seat.position[1] - 2.84131, seat.position[2] - 0.09444) > 0.03)
    return false;
  const anchors: Point[] = [
    [0.339629, 3.627863, 0.350043],
    [0.000152, 3.704557, 0.537128],
    [-0.217204, 3.62215, 0.156749],
  ];

  return anchors.every((a) => {
    for (let i = 0; i < data.positions.length; i += 3) {
      if (Math.hypot(data.positions[i] - a[0], data.positions[i + 1] - a[1], data.positions[i + 2] - a[2]) < 0.002)
        return true;
    }

    return false;
  });
}

// Seven actual dashboard triangles. The separate 16-vertex ring at z=.73 is the windscreen frame.
const PANEL: Point[] = [
  [0.339629, 3.591063, 0.198603],
  [0.339629, 3.627863, 0.350043],
  [0.217507, 3.62215, 0.156749],
  [0.223306, 3.697757, 0.514637],
  [0.000152, 3.704557, 0.537128],
  [-0.217204, 3.62215, 0.156749],
  [-0.223003, 3.697757, 0.514637],
  [-0.339326, 3.627864, 0.350043],
  [-0.339326, 3.591063, 0.198603],
];
const PANEL_FACES = [
  [0, 1, 2],
  [2, 1, 3],
  [2, 3, 4],
  [2, 4, 5],
  [5, 4, 6],
  [5, 6, 7],
  [5, 7, 8],
];
/** Small separate rigid model. It shares the aircraft root, never a resident map texture array. */
export function buildCockpitInstrumentMesh(rgba: Uint8Array): VehicleModelInit {
  const colors: number[] = [],
    meta: number[] = [],
    normals: number[] = [],
    positions: number[] = [],
    uvs: number[] = [];
  const indices: number[] = [],
    submeshes: VehicleSubmesh[] = [];
  const white = 1023.5 / ATLAS_SIZE;
  function vertex(
    p: Point,
    uv: readonly [number, number],
    illuminated = true,
    color = 255,
    n: Point = [0, -0.9773, 0.212],
  ): number {
    const index = positions.length / 3;
    positions.push(...p);
    normals.push(...n);
    uvs.push(...uv);
    colors.push(color, color, color, 255);
    meta.push(0, 0, 0, illuminated ? 7 << 4 : 0);

    return index;
  }
  function group(start: number, translucent = false): void {
    submeshes.push({
      array: 0,
      center: [0, translucent ? 3.699 : 3.4, translucent ? 0.58 : 0.52],
      indexCount: indices.length - start,
      indexOffset: start,
      part: 0,
      radius: translucent ? 0.081 : 0.46,
      translucent,
    });
  }
  function uvFor(rect: Rect, x: number, y: number): [number, number] {
    return [(rect[0] + 0.5 + x * (rect[2] - 1)) / ATLAS_SIZE, (rect[1] + 0.5 + y * (rect[3] - 1)) / ATLAS_SIZE];
  }
  function disk(x: number, v: number, r: number, rect: Rect): void {
    const center = vertex(dashboardPoint(x, v, 0.015), uvFor(rect, 0.5, 0.5));
    const start = positions.length / 3;
    for (let j = 0; j <= 64; j++) {
      const a = (j * Math.PI) / 32,
        c = Math.cos(a),
        s = Math.sin(a);
      vertex(dashboardPoint(x + r * c, v + r * s, 0.015), uvFor(rect, 0.5 + 0.5 * c, 0.5 - 0.5 * s));
      if (j) indices.push(center, start + j - 1, start + j);
    }
  }
  function ring(x: number, v: number, r: number): void {
    for (let j = 0; j < 64; j++) {
      const a = (j * Math.PI) / 32,
        b = ((j + 1) * Math.PI) / 32;
      const start = positions.length / 3;
      for (const [angle, radius, depth, color] of [
        [a, r, 0.016, 38],
        [b, r, 0.016, 38],
        [b, r + 0.009, 0.012, 83],
        [a, r + 0.009, 0.012, 83],
      ] as const)
        vertex(
          dashboardPoint(x + radius * Math.cos(angle), v + radius * Math.sin(angle), depth),
          [white, white],
          false,
          color,
        );
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
      const wall = positions.length / 3;
      for (const [angle, depth] of [
        [a, 0.012],
        [b, 0.012],
        [b, 0.004],
        [a, 0.004],
      ] as const)
        vertex(
          dashboardPoint(x + (r + 0.009) * Math.cos(angle), v + (r + 0.009) * Math.sin(angle), depth),
          [white, white],
          false,
          30,
        );
      indices.push(wall, wall + 1, wall + 2, wall, wall + 2, wall + 3);
    }
  }
  function rectangle(x: number, v: number, width: number, height: number, rect: Rect): void {
    const start = positions.length / 3;
    for (const [u, w] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const)
      vertex(dashboardPoint(x + (u - 0.5) * width, v + (0.5 - w) * height, 0.012), uvFor(rect, u, w));
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const start = indices.length;
  for (const p of PANEL) vertex([p[0], p[1] - 0.006 * 0.9773, p[2] + 0.006 * 0.212], [white, white], false, 23);
  for (const face of PANEL_FACES) indices.push(...face);
  ring(-0.195, 0.235, 0.068);
  disk(-0.195, 0.235, 0.068, INSTRUMENT_ATLAS.speed);
  ring(0, 0.26, 0.084);
  disk(0, 0.26, 0.084, INSTRUMENT_ATLAS.attitude);
  ring(0.195, 0.235, 0.068);
  disk(0.195, 0.235, 0.068, INSTRUMENT_ATLAS.altitude);
  rectangle(0, 0.128, 0.52, 0.036, INSTRUMENT_ATLAS.health);
  rectangle(-0.175, 0.056, 0.16, 0.062, INSTRUMENT_ATLAS.throttle);
  rectangle(0, 0.056, 0.16, 0.062, INSTRUMENT_ATLAS.nozzle);
  rectangle(0.175, 0.056, 0.16, 0.062, INSTRUMENT_ATLAS.gear);
  group(start);
  const base = positions.length / 3,
    glassStart = indices.length;
  // Existing sight glass, offset 1 mm toward the pilot. Transparent texels keep the green glass visible.
  for (const [x, y, z, u, v] of [
    [-0.06865, 3.707227, 0.618736, 0, 0],
    [0.06865, 3.707227, 0.618736, 1, 0],
    [0.06865, 3.690875, 0.535889, 1, 1],
    [-0.06865, 3.690875, 0.535889, 0, 1],
  ] as const)
    vertex([x, y - 0.001, z + 0.0002], uvFor(INSTRUMENT_ATLAS.heading, u, v), true, 255, [0, -0.981, 0.194]);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  group(glassStart, true);
  const bytes = (values: number[]): Uint8Array => new Uint8Array(new Float32Array(values).buffer);
  const vertexCount = positions.length / 3;

  return {
    colors: new Uint8Array(colors),
    indexCount: indices.length,
    indices: new Uint8Array(new Uint16Array(indices).buffer),
    meta: new Uint8Array(meta),
    night: new Uint8Array(colors),
    normals: bytes(normals),
    parts: [{ localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'cockpit_instruments' }],
    positions: bytes(positions),
    reflect: new Uint8Array(vertexCount * 4),
    submeshes,
    textures: [{ height: ATLAS_SIZE, kind: 'rgba', layers: 1, rgba, width: ATLAS_SIZE }],
    uvs: bytes(uvs),
    vertexCount,
  };
}

/** Follow the original panel's slight compound slope; depth is positive toward the pilot. */
export function dashboardPoint(x: number, v: number, depth = 0.006): Point {
  const z = 0.156749 + v * 0.9773;
  for (const face of PANEL_FACES) {
    const [a, b, c] = face.map((i) => PANEL[i]);
    const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
    const w = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
    if (Math.min(u, w, 1 - u - w) >= -0.0001)
      return [x, u * a[1] + w * b[1] + (1 - u - w) * c[1] - depth * 0.9773, z + depth * 0.212];
  }
  throw new Error(`Instrument exceeds Hydra dashboard: ${x},${v}`);
}
