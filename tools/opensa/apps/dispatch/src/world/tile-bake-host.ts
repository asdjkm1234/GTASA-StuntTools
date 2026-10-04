/**
 * Driving the tile bake with the console's own engine (201/6-02).
 *
 * **It runs in the browser, and that is not a shortcut.** The development machine is a phone with no
 * headless Chromium, so a bake that needed Playwright would be a bake nobody here can run. The console
 * already has the world streamed and the renderer warm: pointing the camera straight down, one tile at a
 * time, is the cheapest correct way to produce the pyramid — and it produces one for whatever build is
 * loaded, total conversions included.
 *
 * The two things this file is careful about:
 *
 * - **a tile must be rendered from a world that has ARRIVED.** A frame drawn while the streamer is still
 *   fetching bakes a hole into a file nobody re-renders, and it looks exactly like a tile of empty ground;
 * - **the encoder decides the format, not us.** A browser that cannot write WebP hands back a PNG with no
 *   error, and an archive that declared WebP would then serve pictures no reader can open.
 */
import type { CameraState } from '@opensa/engine';

import type { GtaGround } from '../map/coords';
import type { TileScheme } from '../map/tiles';
import type { BakedTile, TileBakeReport } from './tile-bake';

import { CAMERA_FAR } from '../map/map-camera';
import { DEFAULT_TILE_SIZE } from '../map/tiles';
import { bakeTiles, describeBake } from './tile-bake';

export interface FlatMapBakeHost {
  readonly canvas: HTMLCanvasElement;
  /** Where the world is and how far it reaches — the square the pyramid covers. */
  readonly extent: { readonly centre: GtaGround; readonly radius: number };
  /** Draw one frame with this camera. */
  frame: (camera: CameraState) => void;
  /** What the world is called, for the archive's own record. */
  readonly label: string;
  /** Stop and restart the console's own frame loop — the bake owns the canvas while it runs. */
  pause: (on: boolean) => void;
  /** Make this view resident, and answer how many cells are still on their way. */
  stream: (camera: CameraState, pixelHeight: number) => number;
}

export interface FlatMapBakeOptions {
  readonly maxZoom: number;
  readonly minZoom: number;
  readonly tileSize: number;
}

/** How high over the ground the bake camera sits. Ortho, so it changes no scale — only what is in front of
 *  the near plane, and San Andreas' tallest tower is under 300. */
const BAKE_EYE = 2000;
/** Frames a tile is given to settle before it is captured anyway. At ~16 ms each this is a few seconds per
 *  tile worst case, and a tile that never settles is a tile whose cells the pak does not have. */
const SETTLE_FRAMES = 180;
/** Even a resident tile gets these, so the streamer's uploads land before the capture. */
const MIN_FRAMES = 3;

/** The bake camera for one tile: straight down, north up, framing exactly the tile's square. */
export function bakeCamera(extent: { max: GtaGround; min: GtaGround }): CameraState {
  const cx = (extent.min[0] + extent.max[0]) / 2;
  const cy = (extent.min[1] + extent.max[1]) / 2;

  return {
    aspect: 1,
    eye: [cx, BAKE_EYE, -cy],
    far: CAMERA_FAR,
    // Unread under an orthographic projection; carried because the state is one shape for both.
    fovYRad: 1,
    // The same rule the map camera's plan view follows: the front plane is as far in FRONT of the focus as
    // the far plane is behind it, so a tower taller than the eye is drawn rather than sliced off.
    near: 2 * BAKE_EYE - CAMERA_FAR,
    orthoHalfHeight: (extent.max[1] - extent.min[1]) / 2,
    target: [cx, 0, -cy],
    // North is −z in engine space, so an up of [0, 0, −1] puts north at the top of every tile — the
    // orientation every tile reader assumes, and the one the console's own plan view uses.
    up: [0, 0, -1],
  };
}

/**
 * Bake the pyramid and hand the archive to the browser as a download.
 *
 * The report goes to the console as one line, because it is the number this step owes and it has to survive
 * being pasted into a benchmark row from a phone.
 */
export async function bakeFlatMap(host: FlatMapBakeHost, options: FlatMapBakeOptions): Promise<TileBakeReport> {
  const scheme = bakeScheme(host.extent, options);
  const width = host.canvas.width;
  const height = host.canvas.height;
  host.pause(true);
  try {
    const { archive, report } = await bakeTiles(
      { maxZoom: scheme.maxZoom, minZoom: scheme.minZoom, scheme, world: host.label },
      (extent, size) => renderTile(host, extent, size),
      (done, total, tile) => {
        if (done === total || done % 16 === 0) {
          // eslint-disable-next-line no-console -- a long job with no progress is one nobody lets finish
          console.log(`[tilebake] ${done}/${total} · z${tile.z} ${tile.x}/${tile.y}`);
        }
      },
    );
    downloadArchive(archive);
    // eslint-disable-next-line no-console -- the run's own record, written to be pasted into a benchmark row
    console.log(`[tilebake] ${host.label} — ${describeBake(report)}`);

    return report;
  } finally {
    host.canvas.width = width;
    host.canvas.height = height;
    host.pause(false);
  }
}

/** The pyramid's square, from the pak's own extent. Never a min/max box over placements. */
export function bakeScheme(
  extent: { readonly centre: GtaGround; readonly radius: number },
  options: FlatMapBakeOptions,
): TileScheme {
  return {
    maxZoom: options.maxZoom,
    minZoom: options.minZoom,
    origin: [extent.centre[0] - extent.radius, extent.centre[1] - extent.radius],
    span: extent.radius * 2,
    tileSize: options.tileSize > 0 ? options.tileSize : DEFAULT_TILE_SIZE,
  };
}

async function capture(canvas: HTMLCanvasElement, size: number): Promise<BakedTile> {
  const sheet = document.createElement('canvas');
  sheet.width = size;
  sheet.height = size;
  const context = sheet.getContext('2d');
  if (context === null) {
    throw new Error('tile bake: no 2d context to capture into');
  }
  context.drawImage(canvas, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, 'image/webp', 0.85));
  if (blob === null) {
    throw new Error('tile bake: the browser produced no picture for a tile');
  }

  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

/** Hand the finished archive to the browser. On the phone this lands in Downloads, which is where the
 *  built game's `tiles.pmtiles` is copied from. */
function downloadArchive(archive: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([archive as unknown as BlobPart], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.download = 'tiles.pmtiles';
  link.href = url;
  link.click();
  // Revoked on the next task: revoking synchronously races the click on some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One frame, awaited — the bake advances on the browser's own clock so the streamer gets to run. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderTile(
  host: FlatMapBakeHost,
  extent: { max: GtaGround; min: GtaGround },
  size: number,
): Promise<BakedTile> {
  host.canvas.width = size;
  host.canvas.height = size;
  const camera = bakeCamera(extent);
  for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) {
    const pending = host.stream(camera, size);
    host.frame(camera);
    if (pending === 0 && frame >= MIN_FRAMES) {
      break;
    }
    await nextFrame();
  }
  // One more with everything resident, captured in the same task so the swapchain still holds it.
  host.frame(camera);

  return capture(host.canvas, size);
}
