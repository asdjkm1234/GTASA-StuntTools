/**
 * Rigid-entity probe host (074/08 B2c, `?vehicle=N`): read a CONVERTED vehicle `.osm` from the served build
 * (plan 079 phase 2 — the same bytes and `readModelOsm` decode the game uses, replacing the old vehicle-probe
 * fixture), feed it to the engine, and drive a circle around the focus with game-style transform updates —
 * root matrix per frame, wheels spin by arc distance and hold the turn's steer angle. `?vehicle=N` spawns N
 * instances of the ONE model (B5 multi-instance check — they share the geometry and the texture array, only
 * their part matrices differ). Pairs with `?ped=1`.
 */
import type { Engine, VehicleInstance, VehiclePaint } from '@opensa/engine';

import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';

export interface VehicleProbeHost {
  /** Advance the drive loop to `nowSec`, flatten + upload; returns the CPU cost in ms. */
  update(nowSec: number): number;
}

const CIRCLE_RADIUS = 22;
const SPEED = 9; // engine units per second
const STEER = 0.32; // constant turn — matches the circle visually

/** Convoy paints (linear RGB) — one per car, so the shared-model paint slots are visible at a glance. */
const CONVOY_PAINTS: VehiclePaint[] = [
  {
    primary: [0.05, 0.16, 0.45],
    quaternary: [0.6, 0.6, 0.6],
    secondary: [0.62, 0.62, 0.62],
    tertiary: [0.05, 0.16, 0.45],
  },
  { primary: [0.5, 0.03, 0.03], quaternary: [0.2, 0.2, 0.2], secondary: [0.2, 0.2, 0.2], tertiary: [0.5, 0.03, 0.03] },
  { primary: [0.02, 0.3, 0.1], quaternary: [0.8, 0.8, 0.8], secondary: [0.8, 0.8, 0.8], tertiary: [0.02, 0.3, 0.1] },
  { primary: [0.85, 0.6, 0.02], quaternary: [0.1, 0.1, 0.1], secondary: [0.1, 0.1, 0.1], tertiary: [0.85, 0.6, 0.02] },
  {
    primary: [0.75, 0.75, 0.78],
    quaternary: [0.3, 0.3, 0.3],
    secondary: [0.3, 0.3, 0.3],
    tertiary: [0.75, 0.75, 0.78],
  },
];

export function loadVehicleProbe(
  engine: Engine,
  center: readonly [number, number, number],
  count = 1,
  name = 'landstal',
  osm: Uint8Array,
  drive = false,
): VehicleProbeHost {
  // The converted `.osm` is self-contained (geometry + `.ostex` texture arrays + the pre-built parts in DESC),
  // so `readModelOsm` yields both the engine-ready upload and the same `VehicleFixture` the drive loop below
  // reads — the fetch/hand-slice fixture path is gone, the decode is the game's.
  const { fixture, model } = readModelOsm(name, osm);
  const modelId = engine.createVehicleModel(model);
  const cars: VehicleInstance[] = [];
  // SA's optional parts are mutually exclusive, so the convoy walks them instead of choosing at random —
  // N instances of one model then show N different extras side by side, which is the point of the bench.
  const extras = [
    ...new Set(fixture.submeshes.map((submesh) => submesh.extra).filter((name): name is string => !!name)),
  ];
  for (let index = 0; index < Math.max(1, count); index += 1) {
    const car = engine.createVehicle(modelId);
    car.setPaint(CONVOY_PAINTS[index % CONVOY_PAINTS.length]);
    const extra = extras.length > 0 ? extras[index % extras.length] : null;
    // The `_dam` twins and the `_vlo` LOD ride in the same buffers — hide them until damage/LOD drive them
    // (B5 steps 3-4). This is the visibility primitive doing exactly what prod's `.visible` flags did.
    fixture.submeshes.forEach((submesh, index) => {
      if (submesh.kind !== 'body' || (submesh.extra && submesh.extra !== extra)) {
        car.setSubmeshVisible(index, false);
      }
    });
    cars.push(car);
  }

  const root = new Float32Array(16);
  const headlight = fixture.dummies.find((dummy) => dummy.name === 'headlights') ?? null;
  const taillight = fixture.dummies.find((dummy) => dummy.name === 'taillights') ?? null;

  return {
    update(nowSec: number): number {
      const started = performance.now();
      engine.dynamicLights.length = 0;
      cars.forEach((car, index) => {
        if (drive) {
          // Circle drive: heading tangent to the circle, wheels roll by arc distance. Extra cars ride the
          // same circle, evenly spaced — a convoy, so multi-instance is obvious at a glance.
          const angular = SPEED / CIRCLE_RADIUS;
          const angle = nowSec * angular + (index * 2 * Math.PI) / cars.length;
          const x = center[0] + Math.cos(angle) * CIRCLE_RADIUS;
          const z = center[2] + Math.sin(angle) * CIRCLE_RADIUS;
          // Tangent in the engine XZ plane; GTA vehicles face +y (engine −z after the axis change).
          const heading = -angle - Math.PI / 2;
          writeRoot(root, [x, center[1], z], heading);
          car.entity.setRoot(root);
          const spin = (nowSec * SPEED) / Math.max(0.1, fixture.wheels[0]?.radius ?? 0.35);
          for (const wheel of fixture.wheels) {
            const spinQuat = axisAngle(1, 0, 0, spin);
            car.entity.setPartRotation(
              wheel.part,
              wheel.front ? quatMul(axisAngle(0, 0, 1, STEER), spinQuat) : spinQuat,
            );
          }
          pushLampLights(engine, root, heading, headlight, taillight);

          return;
        }
        // The look bench (074/16 round 2 default): PARKED at the focus — the camera orbits/zooms the car
        // itself. Extra cars line up side by side; wheels neutral. NO lamp pool lights: a parked SA car
        // runs no headlights, and four per-pixel dynamic lights halved the night frame rate (bench round 3).
        const heading = Math.PI / 4;
        writeRoot(root, [center[0] + (index - (cars.length - 1) / 2) * 3.4, center[1], center[2]], heading);
        car.entity.setRoot(root);
      });
      engine.updateVehicles();

      return performance.now() - started;
    },
  };
}

/** Apply the root matrix (column-major) to a GTA vehicle-space point. */
function applyRoot(root: Float32Array, point: readonly [number, number, number]): [number, number, number] {
  return [
    root[0] * point[0] + root[4] * point[1] + root[8] * point[2] + root[12],
    root[1] * point[0] + root[5] * point[1] + root[9] * point[2] + root[13],
    root[2] * point[0] + root[6] * point[1] + root[10] * point[2] + root[14],
  ];
}

function axisAngle(x: number, y: number, z: number, angle: number): [number, number, number, number] {
  const half = angle / 2;
  const s = Math.sin(half);

  return [x * s, y * s, z * s, Math.cos(half)];
}

/** Head/taillight pool lights (074/06 row 7): the fixture dummies are the producers. SA authors the dummy
 *  on the LEFT side — mirror x for the right lamp. Headlights get a forward push so the pool light hits
 *  the road ahead, not the grille. */
function pushLampLights(
  engine: Engine,
  root: Float32Array,
  heading: number,
  headlight: null | { position: [number, number, number] },
  taillight: null | { position: [number, number, number] },
): void {
  if (engine.environment.dn <= 0.4) {
    return;
  }
  const forward: [number, number, number] = [-Math.sin(heading), 0, -Math.cos(heading)];
  for (const [anchor, mirror] of [
    [headlight, false],
    [headlight, true],
    [taillight, false],
    [taillight, true],
  ] as const) {
    if (!anchor) {
      continue;
    }
    const world = applyRoot(root, [
      mirror ? -anchor.position[0] : anchor.position[0],
      anchor.position[1],
      anchor.position[2],
    ]);
    const head = anchor === headlight;
    const ahead = head ? 4.5 : -1;
    engine.dynamicLights.push({
      color: head ? [1.15, 1.05, 0.85] : [0.75, 0.06, 0.05],
      position: [world[0] + forward[0] * ahead, world[1], world[2] + forward[2] * ahead],
      radius: head ? 24 : 9,
    });
  }
}

function quatMul(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
    a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Root = translate(engine position) × (GTA Z-up → engine Y-up) × yaw about GTA Z. */
function writeRoot(out: Float32Array, position: readonly [number, number, number], yaw: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.set([c, 0, -s, 0, -s, 0, -c, 0, 0, 1, 0, 0, position[0], position[1], position[2], 1]);
}
