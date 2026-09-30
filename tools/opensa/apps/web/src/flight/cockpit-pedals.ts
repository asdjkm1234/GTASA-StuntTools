/** Procedural replay-only Hydra rudder pedals, placed below the stock dashboard. */
import type { Engine, VehicleModelInit, VehicleSubmesh } from '@opensa/engine';

import type { Quat, Vec3 } from './math';

import { conjugate, quatMultiply } from './math';

export interface CockpitPedals {
  dispose(): void;
  setRoot(root: Float32Array): void;
  setVisible(visible: boolean): void;
  state: null | PedalMotion;
  update(node: null | Quat, bind: null | Quat, inferredYaw: number): void;
}

export interface PedalMotion {
  control: number;
  leftTravel: number;
  rightTravel: number;
  source: 'inferred' | 'recorded';
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
  function box(center: Vec3, size: Vec3, color: number): void {
    for (const face of faces) {
      const first = positions.length / 3;
      for (const corner of face.corners) {
        positions.push(...corner.map((v, axis) => center[axis] + (v * size[axis]) / 2));
        normals.push(...face.normal);
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
  for (const side of [-1, 1]) box([side * 0.18, 3.4, -0.275], [0.15, 0.28, 0.025], 90);
  group(0, 0, [0, 3.4, -0.275], 0.3);
  for (let part = 1; part <= 2; part++) {
    const start = indices.length;
    box([0, 0, 0], [0.135, 0.024, 0.24], 160); // metal rim
    box([0, -0.015, 0.003], [0.108, 0.01, 0.197], 45); // rubber foot face
    for (let rib = 0; rib < 6; rib++) box([0, -0.023, -0.069 + rib * 0.03], [0.096, 0.009, 0.006], 90);
    box([0, -0.032, -0.105], [0.135, 0.055, 0.02], 150); // heel stop
    box([0, 0.025, -0.048], [0.035, 0.035, 0.13], 100); // carriage
    group(part, start, [0, 0, 0], 0.16);
  }
  const vertexCount = positions.length / 3;
  const bytes = (array: number[]): Uint8Array => new Uint8Array(new Float32Array(array).buffer);
  const tilt = (-20 * Math.PI) / 180;

  return {
    colors: new Uint8Array(colors),
    indexCount: indices.length,
    indices: new Uint8Array(new Uint16Array(indices).buffer),
    meta: new Uint8Array(vertexCount * 4),
    night: new Uint8Array(night),
    normals: bytes(normals),
    parts: [
      { localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'replay_pedal_rails' },
      ...[-1, 1].map((side) => ({
        localRotation: [Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)] as Quat,
        localTranslation: [side * 0.18, 3.4, -0.12] as Vec3,
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
export function cockpitPedalMotion(node: null | Quat, bind: null | Quat, inferredYaw: number): PedalMotion {
  const recorded = !!node && !!bind && node.every(Number.isFinite);
  let control = inferredYaw / 0.28;
  if (recorded) {
    const delta = quatMultiply(node, conjugate(bind));
    const angle = 2 * Math.atan2(delta[2], delta[3]);
    control = -Math.atan2(Math.sin(angle), Math.cos(angle)) / ((40 * Math.PI) / 180);
  }
  control = Number.isFinite(control) ? Math.max(-1, Math.min(1, control)) || 0 : 0;

  return {
    control,
    leftTravel: -control * 0.07,
    rightTravel: control * 0.07,
    source: recorded ? 'recorded' : 'inferred',
  };
}

export function createCockpitPedals(engine: Engine): CockpitPedals {
  const model = buildCockpitPedalMesh();
  const modelId = engine.createVehicleModel(model);
  const instance = engine.createVehicle(modelId);
  const handle: CockpitPedals = {
    dispose(): void {
      engine.destroyVehicle(instance);
      engine.destroyVehicleModel(modelId);
    },
    setRoot(root): void {
      instance.entity.setRoot(root);
    },
    setVisible(visible): void {
      model.submeshes.forEach((_, index) => instance.setSubmeshVisible(index, visible));
    },
    state: null,
    update(node, bind, inferredYaw): void {
      const motion = cockpitPedalMotion(node, bind, inferredYaw);
      handle.state = motion;
      instance.entity.setPartTranslation(1, [0, motion.leftTravel, 0]);
      instance.entity.setPartTranslation(2, [0, motion.rightTravel, 0]);
    },
  };

  return handle;
}
