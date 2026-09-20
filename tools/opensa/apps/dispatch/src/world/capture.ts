/**
 * A picture of the situation (201/7-07): the world, the symbology over it, and a line saying what it is.
 *
 * **The naive version is wrong in a way that looks right.** `canvas.toDataURL()` on the WebGPU canvas
 * captures the city and nothing else — every unit, call, callsign and trail lives on the SECOND canvas
 * stacked over it, which is the whole point of the console's two-layer design. An export that quietly loses
 * the operational half is worse than no export: it is a screenshot of a video game, sent into a report as
 * evidence of a shift.
 *
 * So the two are composed. The stamp is not decoration either: an image in a chat window a week later
 * answers "where" and "when" or it answers nothing, and a picture of San Andreas at 3 am with no caption is
 * indistinguishable from any other picture of San Andreas at 3 am.
 */
import type { MapPose } from '../map/map-camera';

/** What the footer says. All of it is state the console already has, none of it is computed for the image. */
export interface CaptureStamp {
  /** The pak's build time — the same string the status bar shows, so an image can be traced to a build. */
  readonly build: string;
  /** Where this is, in the world's own words when it has them. */
  readonly district: string;
  readonly pose: MapPose;
}

/** Footer height and type size in CSS px — small enough to stay out of the picture, big enough to read in
 *  a chat window. Both scale with the device pixels so an export is as sharp as the screen it came from. */
const STAMP_HEIGHT = 26;
const STAMP_TYPE = 12;
const STAMP_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * Compose the two canvases plus the stamp into one PNG.
 *
 * Called at the END of a frame, where the layers are in step. `null` when the browser cannot produce a blob
 * at all — an export that silently hands back an empty file would be worse than one that says it failed.
 */
export async function composeImage(
  world: HTMLCanvasElement,
  overlay: HTMLCanvasElement,
  stamp: CaptureStamp,
): Promise<Blob | null> {
  const width = Math.max(1, world.width);
  const height = Math.max(1, world.height);
  // Device pixels, so the export is as sharp as the screen it was taken on; the stamp scales with them.
  const scale = width / Math.max(1, world.clientWidth || width);
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height + Math.round(STAMP_HEIGHT * scale);
  const context = sheet.getContext('2d');
  if (context === null) {
    return null;
  }

  context.drawImage(world, 0, 0, width, height);
  // The overlay is sized in its own device pixels and may differ by a pixel after a resize; drawing it into
  // the world's rectangle keeps a callsign over the unit it belongs to rather than one pixel beside it.
  context.drawImage(overlay, 0, 0, width, height);

  context.fillStyle = '#080c12';
  context.fillRect(0, height, sheet.width, sheet.height - height);
  context.fillStyle = '#c9d6e4';
  context.font = `${Math.round(STAMP_TYPE * scale)}px ${STAMP_FAMILY}`;
  context.textBaseline = 'middle';
  context.fillText(stampLine(stamp), Math.round(8 * scale), height + Math.round((STAMP_HEIGHT * scale) / 2));

  return new Promise((resolve) => sheet.toBlob((blob) => resolve(blob), 'image/png'));
}

/** `Ganton · 1480, -1720 · 900 m · plan · 21:14 · build 2026-08-22 09:57`. */
function stampLine(stamp: CaptureStamp): string {
  const [x, y] = stamp.pose.at;
  const parts = [
    stamp.district,
    `${x.toFixed(0)}, ${y.toFixed(0)}`,
    `${stamp.pose.height.toFixed(0)} m`,
    stamp.pose.projection === 'ortho' ? 'plan' : '3D',
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    stamp.build,
  ];

  return parts.filter((part) => part !== '').join(' · ');
}
