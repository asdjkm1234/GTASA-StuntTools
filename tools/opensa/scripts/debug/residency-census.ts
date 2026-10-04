import type { CameraState, Engine, ResidencyView, StreamingRadii } from '@opensa/engine';
/**
 * What the residency rule ASKS FOR, per zoom (plan 201/1-05) — the desk half of the streaming profile.
 *
 * Why it exists. The rings and the view gate are two different answers to *"which cells does this frame
 * need"*, and the difference between them is not a matter of opinion: it is a count, and it is a property of
 * the RULE rather than of any particular world. So this census drives the shipped {@link StreamingDriver}
 * — the real one, over a fake engine and a fake worker, exactly as its unit tests do — and counts what it
 * requests at each of the console's zoom levels under each policy.
 *
 * What it does NOT measure: milliseconds, bytes on the wire, or anything about a real district's contents.
 * The world here is a plain grid of equal cells, because a policy that fetches half as many cells fetches
 * half as many cells whatever is inside them. The bytes, the frame time and the time-to-picture belong to a
 * device run ([2/03](../../docs/plans/201-dispatch-console/2-real-device-truth/readme.md)).
 *
 * Run:
 *
 * ```sh
 * npx tsx scripts/debug/residency-census.ts [--cells 41] [--json out.json]
 * ```
 */
import type { OspakManifest } from '@opensa/engine-formats';

import { StreamingDriver } from '@opensa/engine/stream/streaming';
import { CAMERA_FOV_Y } from '@opensa/web/ui/camera/engine-camera';
import { writeFileSync } from 'node:fs';

/** The pak the console streams today: 250 u render cells, HD 450 / LOD 2200 (`apps/dispatch/src/world/boot.ts`). */
const CELL_SIZE = 250;
const RADII: StreamingRadii = { hdRadius: 450, lodRadius: 2200 };
/** The shipped LOD bake's promise as a world size — `promisedGeometricError({ 300, 2 })`. */
const LOD_ERROR = 0.6415;
const LOD_PIXELS = 2;
/** A phone in the operator's hand: 800 CSS px tall at DPR 2, which is what the frame is judged on. */
const PIXEL_HEIGHT = 1600;
const ASPECT = 0.45;
/** Every cell is one storey of city — the height only has to be a real number, not a real building. */
const CELL_HEIGHT: [number, number] = [0, 30];

interface Pose {
  readonly name: string;
  readonly pitch: number;
  readonly plan: boolean;
  /** Ground span the view frames, world units — the console's zoom levels are spans, not distances. */
  readonly span: number;
}

const POSES: readonly Pose[] = [
  { name: 'block · tilted', pitch: -Math.PI / 3, plan: false, span: 250 },
  { name: 'district · tilted', pitch: -Math.PI / 3, plan: false, span: 1500 },
  { name: 'city · tilted', pitch: -Math.PI / 3, plan: false, span: 4400 },
  { name: 'block · plan', pitch: -Math.PI / 2 + 0.01, plan: true, span: 250 },
  { name: 'district · plan', pitch: -Math.PI / 2 + 0.01, plan: true, span: 1500 },
  { name: 'city · plan', pitch: -Math.PI / 2 + 0.01, plan: true, span: 4400 },
];

function cameraFor(pose: Pose): CameraState {
  const distance = pose.span / (2 * Math.tan(CAMERA_FOV_Y / 2));
  const eye: [number, number, number] = [
    0,
    distance * -Math.sin(pose.pitch),
    distance * Math.cos(pose.pitch), // yaw = π (north up): the eye sits +Z of the focus, looking −Z
  ];

  return {
    aspect: ASPECT,
    eye,
    far: 12000,
    fovYRad: CAMERA_FOV_Y,
    near: 0.1,
    ...(pose.plan ? { orthoHalfHeight: pose.span / 2 } : {}),
    target: [0, 0, 0],
    up: [0, 1, 0],
  };
}

/** A square grid of cells around the origin, each with both levels, a true rect, a height and an error. */
function gridManifest(side: number): OspakManifest {
  const half = Math.floor(side / 2);
  const cells: OspakManifest['cells'] = {};
  for (let cx = -half; cx <= half; cx += 1) {
    for (let cy = -half; cy <= half; cy += 1) {
      const rect: [number, number, number, number] = [
        cx * CELL_SIZE,
        (cx + 1) * CELL_SIZE,
        -(cy + 1) * CELL_SIZE,
        -cy * CELL_SIZE,
      ];
      cells[`${cx},${cy},hd`] = { aabb: rect, aabbY: CELL_HEIGHT, geometricError: 0, hash: 0, length: 4, offset: 0 };
      cells[`${cx},${cy},lod`] = {
        aabb: rect,
        aabbY: CELL_HEIGHT,
        geometricError: LOD_ERROR,
        hash: 0,
        length: 4,
        offset: 0,
      };
    }
  }

  return { byteLength: 4096, cells, cellSize: CELL_SIZE, lodPixelThreshold: LOD_PIXELS, textures: {}, version: 1 };
}

function main(): void {
  const args = process.argv.slice(2);
  const side = Number(args[args.indexOf('--cells') + 1]) || 41;
  const jsonAt = args.indexOf('--json');
  const manifest = gridManifest(side);
  const rows = POSES.map((pose) => {
    const camera = cameraFor(pose);
    const rings = requestsAt(manifest, undefined);
    const viewed = requestsAt(manifest, { camera, pixelHeight: PIXEL_HEIGHT });

    return {
      keptShare: Number(((viewed.hd + viewed.lod) / (rings.hd + rings.lod)).toFixed(3)),
      pose: pose.name,
      ringCells: rings.hd + rings.lod,
      ringHd: rings.hd,
      viewCells: viewed.hd + viewed.lod,
      viewHd: viewed.hd,
    };
  });
  const report = {
    note: `Synthetic ${side}×${side} grid of ${CELL_SIZE} u cells, HD ${String(RADII.hdRadius)} / LOD ${String(RADII.lodRadius)}, viewport ${String(PIXEL_HEIGHT)} px tall, LOD error ${String(LOD_ERROR)} u against a ${String(LOD_PIXELS)} px budget. Counts what the shipped StreamingDriver requests on its first update — not milliseconds, not bytes.`,
    rows,
  };
  console.log(
    ['pose', 'ring cells', 'ring HD', 'view cells', 'view HD', 'kept share'].map((head) => head.padEnd(18)).join('') +
      '\n' +
      rows
        .map((row) =>
          [row.pose, row.ringCells, row.ringHd, row.viewCells, row.viewHd, row.keptShare]
            .map((cell) => String(cell).padEnd(18))
            .join(''),
        )
        .join('\n'),
  );
  if (jsonAt >= 0 && args[jsonAt + 1]) {
    writeFileSync(args[jsonAt + 1], `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nwrote ${args[jsonAt + 1]}`);
  }
}

/** One policy's answer at one pose: the keys the driver asks the worker for on the first update. */
function requestsAt(manifest: OspakManifest, view: ResidencyView | undefined): { hd: number; lod: number } {
  const requested: string[] = [];
  const engine = {
    cells: { load: (): void => undefined, unload: (): void => undefined },
    environment: { fogCutDistance: 2400 },
    releaseWorldArray: (): boolean => true,
    textures: { beginLoad: (): void => undefined, drainUploads: (): number => 0, has: (): boolean => true },
  } as unknown as Engine;
  const worker = {
    addEventListener: (): void => undefined,
    postMessage: (message: { key: string }): void => {
      requested.push(message.key);
    },
  } as unknown as Worker;
  new StreamingDriver(engine, manifest, worker, RADII).update([0, 0, 0], view);

  return {
    hd: requested.filter((key) => key.endsWith(',hd')).length,
    lod: requested.filter((key) => key.endsWith(',lod')).length,
  };
}

main();
