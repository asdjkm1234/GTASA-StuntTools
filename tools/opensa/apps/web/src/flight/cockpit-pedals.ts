/** Procedural replay-only Hydra rudder pedals, placed below the stock dashboard. */
import type { Engine, VehicleModelInit, VehicleSubmesh } from '@opensa/engine';

import type { Quat, Vec3 } from './math';

import { pedalPresses, surfaceFeedback } from './surface-feedback';

// Straight suspended arms recessed into the footwell, entirely behind the dashboard's lower lip.
const PEDAL_X = 0.12;
const BASE_PEDAL_Y = 3.74;
const BASE_PEDAL_Z = 0.04;
const PEDAL_SCALE = 0.72;
const PIVOT_Y = 3.98;
const PIVOT_Z = 0.29;
const PEDAL_TILT = (-40 * Math.PI) / 180;
const PEDAL_ATTACHMENT: Vec3 = [0, 0.05, 0];
const BOSS_Y = PEDAL_ATTACHMENT[1] * PEDAL_SCALE * Math.cos(PEDAL_TILT);
const BOSS_Z = PEDAL_ATTACHMENT[1] * PEDAL_SCALE * Math.sin(PEDAL_TILT);
// Extend the actual pivot-to-boss arm by 30%, retaining its direction and the rigid plate's dimensions.
const ARM_Y = (BASE_PEDAL_Y - PIVOT_Y + BOSS_Y) * 1.3 - BOSS_Y;
const ARM_Z = (BASE_PEDAL_Z - PIVOT_Z + BOSS_Z) * 1.3 - BOSS_Z;

export interface CockpitPedals {
  dispose(): void;
  setRoot(root: Float32Array): void;
  setVisible(visible: boolean): void;
  state: null | PedalMotion;
  update(node: null | Quat, bind: null | Quat, damage?: null | number): void;
}

export interface PedalMotion {
  control: number;
  leftAngle: number;
  leftTravel: number;
  rightAngle: number;
  rightTravel: number;
  source: 'recorded' | 'unknown';
}

/** Small private white texture and three rigid parts; no game textures or map-array changes. */
export function buildCockpitPedalMesh(): VehicleModelInit {
  const colors: number[] = [],
    indices: number[] = [],
    night: number[] = [],
    normals: number[] = [],
    positions: number[] = [];
  const submeshes: VehicleSubmesh[] = [];
  // Each quad is counterclockwise as seen from outside the box.
  const faces: { corners: Vec3[]; normal: Vec3 }[] = [
    {
      corners: [
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
        [-1, -1, 1],
      ],
      normal: [0, -1, 0],
    },
    {
      corners: [
        [1, 1, -1],
        [-1, 1, -1],
        [-1, 1, 1],
        [1, 1, 1],
      ],
      normal: [0, 1, 0],
    },
    {
      corners: [
        [-1, 1, -1],
        [-1, -1, -1],
        [-1, -1, 1],
        [-1, 1, 1],
      ],
      normal: [-1, 0, 0],
    },
    {
      corners: [
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
        [1, -1, 1],
      ],
      normal: [1, 0, 0],
    },
    {
      corners: [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
      normal: [0, 0, 1],
    },
    {
      corners: [
        [-1, 1, -1],
        [1, 1, -1],
        [1, -1, -1],
        [-1, -1, -1],
      ],
      normal: [0, 0, -1],
    },
  ];
  function box(center: Vec3, size: Vec3, color: number, tilt = 0): void {
    const cosine = Math.cos(tilt),
      sine = Math.sin(tilt);
    for (const face of faces) {
      const first = positions.length / 3;
      for (const corner of face.corners) {
        const [x, y, z] = corner.map((v, axis) => (v * size[axis]) / 2);
        positions.push(center[0] + x, center[1] + y * cosine - z * sine, center[2] + y * sine + z * cosine);
        const [nx, ny, nz] = face.normal;
        normals.push(nx, ny * cosine - nz * sine, ny * sine + nz * cosine);
        colors.push(color, color, color, 255);
        night.push(Math.round(color * 0.55), Math.round(color * 0.55), Math.round(color * 0.55), 255);
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }
  function group(part: number, start: number, center: Vec3, radius: number): void {
    submeshes.push({
      center,
      indexCount: indices.length - start,
      indexOffset: start,
      part,
      radius,
      translucent: false,
    });
  }
  function arm(start: Vec3, end: Vec3): void {
    const dy = end[1] - start[1],
      dz = end[2] - start[2];
    box(
      start.map((value, axis) => (value + end[axis]) / 2) as Vec3,
      [0.035, 0.03, Math.hypot(dy, dz)],
      85,
      Math.atan2(-dy, dz),
    );
  }
  box([0, PIVOT_Y, PIVOT_Z], [PEDAL_X * 2 + 0.04, 0.024, 0.024], 100); // fixed upper shaft
  for (const side of [-1, 1]) box([side * PEDAL_X, PIVOT_Y + 0.02, PIVOT_Z], [0.034, 0.06, 0.05], 75);
  group(0, 0, [0, PIVOT_Y, PIVOT_Z], PEDAL_X + 0.055);
  const tilt = PEDAL_TILT;
  const attachment = PEDAL_ATTACHMENT;
  function platePoint(point: Vec3): Vec3 {
    const [x, y, z] = point.map((value) => value * PEDAL_SCALE);

    return [x, ARM_Y + y * Math.cos(tilt) - z * Math.sin(tilt), ARM_Z + y * Math.sin(tilt) + z * Math.cos(tilt)];
  }
  function plate(center: Vec3, size: Vec3, color: number): void {
    box(platePoint(center), size.map((value) => value * PEDAL_SCALE) as Vec3, color, tilt);
  }
  function shapedPlate(): void {
    const outline: [number, number][] = [
      [-0.055, 0.1],
      [0.055, 0.1],
    ];
    for (let step = 0; step <= 18; step++) {
      const angle = (step * Math.PI) / 18;
      outline.push([0.075 * Math.cos(angle), -0.015 - 0.075 * Math.sin(angle)]);
    }
    const point = ([x, z]: [number, number], y: number, scale = 1): Vec3 => [x * scale, y, z * scale];
    function vertex(p: Vec3, n: Vec3, color: number): number {
      const index = positions.length / 3;
      const [x, y, z] = p.map((value) => value * PEDAL_SCALE);
      positions.push(
        x,
        ARM_Y + y * Math.cos(tilt) - z * Math.sin(tilt),
        ARM_Z + y * Math.sin(tilt) + z * Math.cos(tilt),
      );
      normals.push(n[0], n[1] * Math.cos(tilt) - n[2] * Math.sin(tilt), n[1] * Math.sin(tilt) + n[2] * Math.cos(tilt));
      colors.push(color, color, color, 255);
      night.push(Math.round(color * 0.55), Math.round(color * 0.55), Math.round(color * 0.55), 255);

      return index;
    }
    function quad(corners: Vec3[], color: number): void {
      const u = corners[1].map((value, axis) => value - corners[0][axis]);
      const v = corners[2].map((value, axis) => value - corners[0][axis]);
      const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...n);
      const ids = corners.map((p) => vertex(p, n.map((value) => value / length) as Vec3, color));
      indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
    const front = vertex([0, -0.014, 0], [0, -1, 0], 135);
    const back = vertex([0, 0.009, 0], [0, 1, 0], 95);
    for (let edge = 0; edge < outline.length; edge++) {
      const a = outline[edge],
        b = outline[(edge + 1) % outline.length];
      indices.push(
        front,
        vertex(point(b, -0.014, 0.92), [0, -1, 0], 135),
        vertex(point(a, -0.014, 0.92), [0, -1, 0], 135),
      );
      indices.push(back, vertex(point(a, 0.009), [0, 1, 0], 95), vertex(point(b, 0.009), [0, 1, 0], 95));
      quad([point(a, -0.006), point(b, -0.006), point(b, 0.009), point(a, 0.009)], 110);
      quad([point(a, -0.014, 0.92), point(b, -0.014, 0.92), point(b, -0.006), point(a, -0.006)], 175);
    }
    for (const side of [-1, 1]) {
      const circle = (angle: number, radius: number, y: number): Vec3 => [
        side * 0.036 + Math.cos(angle) * radius,
        y,
        0.023 + Math.sin(angle) * radius,
      ];
      const center = vertex([side * 0.036, -0.0145, 0.023], [0, -1, 0], 30);
      for (let step = 0; step < 16; step++) {
        const a = (step * Math.PI) / 8,
          b = ((step + 1) * Math.PI) / 8;
        indices.push(
          center,
          vertex(circle(a, 0.0135, -0.0145), [0, -1, 0], 30),
          vertex(circle(b, 0.0135, -0.0145), [0, -1, 0], 30),
        );
        quad(
          [circle(a, 0.016, -0.017), circle(b, 0.016, -0.017), circle(b, 0.0135, -0.0145), circle(a, 0.0135, -0.0145)],
          65,
        );
      }
    }
  }
  for (let part = 1; part <= 2; part++) {
    const start = indices.length;
    box([0, 0, 0], [0.03, 0.035, 0.035], 110); // rotating clevis
    // Terminate inside the rear boss, not at the face center: the arm has real thickness.
    arm([0, 0, 0], platePoint(attachment));
    shapedPlate();
    plate(attachment, [0.075, 0.045, 0.11], 100); // broad rear attachment boss
    group(part, start, [0, ARM_Y / 2, ARM_Z / 2], 0.37);
  }
  const vertexCount = positions.length / 3;
  const bytes = (array: number[]): Uint8Array => new Uint8Array(new Float32Array(array).buffer);

  return {
    colors: new Uint8Array(colors),
    indexCount: indices.length,
    indices: new Uint8Array(new Uint16Array(indices).buffer),
    meta: new Uint8Array(vertexCount * 4),
    night: new Uint8Array(night),
    normals: bytes(normals),
    parts: [
      { localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'replay_pedal_mounts' },
      ...[-1, 1].map((side) => ({
        localRotation: [0, 0, 0, 1] as Quat,
        localTranslation: [side * PEDAL_X, PIVOT_Y, PIVOT_Z] as Vec3,
        name: side < 0 ? 'replay_pedal_left' : 'replay_pedal_right',
      })),
    ],
    positions: bytes(positions),
    reflect: new Uint8Array(vertexCount * 4),
    submeshes,
    textures: [{ height: 1, kind: 'rgba', layers: 1, rgba: new Uint8Array([255, 255, 255, 255]), width: 1 }],
    uvs: bytes(Array.from({ length: vertexCount * 2 }, () => 0.5)),
    vertexCount,
  };
}

/** Positive control presses the right pedal. GTA's measured rudder rotates about native Z. */
export function cockpitPedalMotion(
  node: null | Quat,
  bind: null | Quat,
  damage?: null | number,
  arm: readonly [number, number] = [ARM_Y, ARM_Z],
): PedalMotion {
  const yaw = surfaceFeedback([node], [bind], [damage ?? null]).yaw;
  const control = yaw.value ?? 0;
  const presses = pedalPresses(yaw.value);
  const leftTravel = (presses.left ?? 0) * 0.07;
  const rightTravel = (presses.right ?? 0) * 0.07;
  const swing = (travel: number): number =>
    travel === 0 ? 0 : Math.asin((arm[0] + travel) / Math.hypot(...arm)) - Math.atan2(arm[0], -arm[1]);

  return {
    control,
    leftAngle: swing(leftTravel),
    leftTravel,
    rightAngle: swing(rightTravel),
    rightTravel,
    source: yaw.source === 'unknown' ? 'unknown' : 'recorded',
  };
}

export function createCockpitPedals(
  engine: Engine,
  model = buildCockpitPedalMesh(),
  arm: readonly [number, number] = [ARM_Y, ARM_Z],
): CockpitPedals {
  const modelId = engine.createVehicleModel(model);
  const instance = engine.createVehicle(modelId);
  let visible = true;
  const handle: CockpitPedals = {
    dispose(): void {
      engine.destroyVehicle(instance);
      engine.destroyVehicleModel(modelId);
    },
    setRoot(root): void {
      instance.entity.setRoot(root);
    },
    setVisible(value): void {
      visible = value;
      model.submeshes.forEach((_, index) =>
        instance.setSubmeshVisible(index, visible && (index === 0 || handle.state?.source === 'recorded')),
      );
    },
    state: null,
    update(node, bind, damage): void {
      const motion = cockpitPedalMotion(node, bind, damage, arm);
      handle.state = motion;
      handle.setVisible(visible);
      for (const [part, angle] of [
        [1, motion.leftAngle],
        [2, motion.rightAngle],
      ])
        instance.entity.setPartRotation(part, [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)]);
    },
  };

  return handle;
}
