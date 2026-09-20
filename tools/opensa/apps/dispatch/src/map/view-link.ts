/**
 * A view, written down (201/7-07): the link an operator sends when they say *look at this*.
 *
 * **The parameter names live here and are read here**, both directions, so a link this console writes is one
 * it can open. Splitting the two — a writer that builds a string and a reader somewhere else that parses it
 * — is how a share button ends up producing a URL that silently opens the default view: nothing throws, the
 * console just ignores what it does not recognise, and the operator on the other end sees the wrong place
 * while being told it is the right one.
 *
 * What a link carries, and what it deliberately does not:
 *
 * | Carried | Why |
 * | --- | --- |
 * | the pose — ground point, height, tilt, heading | where they were standing |
 * | the projection | 7/01: the same pose reads differently in plan view, and "the same view" includes it |
 * | the world hour | the light is half of what a night scene looks like |
 * | how far behind live the shift clock was | 8/03: a moment is part of a view once time is an axis |
 * | the pak the world came from (`src`) and the named district | the same coordinates over a different build are a different place |
 * | the skin (`theme`) | 7-10: a shared link reproduced the view but not the look, and an embedding host had no way at all to pin one |
 *
 * Not carried: the SELECTION and the board. A selection is a thing on someone else's screen — ids from a
 * mock board mean nothing across sessions, and once the feed is real (202 phase 2) a call id belongs to the
 * CAD rather than to a URL. The link says where to look; the board says what is there.
 */
import type { MapPose, MapProjection } from './map-camera';

/** Everything a shared link restores. Every field optional: an operator may hand-write half a link. */
export interface SharedView {
  /** GTA ground point under the view. */
  readonly at?: readonly [number, number];
  /** How far BEHIND live the shift clock was, seconds. `0`/absent is live (8/03). */
  readonly behindLive?: number;
  /** The measurement district the view was opened over, when it was opened by name. */
  readonly district?: string;
  /** Eye height above the ground point, world units. */
  readonly height?: number;
  /** The world's hour, 0–24 — the light, not the shift clock. */
  readonly hour?: number;
  /** Radians, negative looks down. */
  readonly pitch?: number;
  readonly projection?: MapProjection;
  /** The pak base the world was streamed from. */
  readonly src?: string;
  /**
   * The skin, by preset id.
   *
   * Read on open and **never persisted**: a link is someone else's view, not a change to how this operator's
   * console looks from now on. Whoever opens it sees the sender's skin for that session and keeps their own
   * stored choice — which is also what lets an embedding host pin a preset with `?embed=1&theme=…` without
   * quietly rewriting the browser it is running in.
   */
  readonly theme?: string;
  /** Radians. */
  readonly yaw?: number;
}

/** The names, in the order a link writes them — so two links to the same view are the same string. */
const VIEW_PARAMS = {
  at: 'at',
  behindLive: 'back',
  district: 'district',
  height: 'h',
  hour: 'hour',
  pitch: 'pitch',
  projection: 'proj',
  src: 'src',
  theme: 'theme',
  yaw: 'yaw',
} as const;

/**
 * What a link asks for. Anything missing or unreadable is simply absent, never a default invented here —
 * the caller owns its own defaults, and a `pitch=banana` that silently became `-66` would be a link that
 * lies about where it points.
 */
export function readView(params: URLSearchParams): SharedView {
  const at = (params.get(VIEW_PARAMS.at) ?? '').split(',').map(Number);
  const view: {
    -readonly [K in keyof SharedView]: SharedView[K];
  } = {};

  if (at.length === 2 && at.every(Number.isFinite)) {
    view.at = [at[0], at[1]];
  }
  const height = number(params, VIEW_PARAMS.height);
  if (height !== undefined) {
    view.height = height;
  }
  const pitch = number(params, VIEW_PARAMS.pitch);
  if (pitch !== undefined) {
    view.pitch = radians(pitch);
  }
  const yaw = number(params, VIEW_PARAMS.yaw);
  if (yaw !== undefined) {
    view.yaw = radians(yaw);
  }
  const projection = params.get(VIEW_PARAMS.projection);
  if (projection === 'ortho' || projection === 'perspective') {
    view.projection = projection;
  }
  const hour = number(params, VIEW_PARAMS.hour);
  if (hour !== undefined) {
    view.hour = hour;
  }
  const behindLive = number(params, VIEW_PARAMS.behindLive);
  if (behindLive !== undefined && behindLive > 0) {
    view.behindLive = behindLive;
  }
  const district = params.get(VIEW_PARAMS.district);
  if (district !== null && district !== '') {
    view.district = district;
  }
  const src = params.get(VIEW_PARAMS.src);
  if (src !== null && src !== '') {
    view.src = src;
  }
  const theme = params.get(VIEW_PARAMS.theme);
  if (theme !== null && theme !== '') {
    // Not checked against the shipped list here: this module owns the parameter NAMES, and which presets
    // exist is `ui/theme.ts`'s to know. `resolveHostTheme` refuses an id nobody ships, and says so.
    view.theme = theme;
  }

  return view;
}

/**
 * The same view as a whole URL, on top of wherever the console is being served from.
 *
 * The comma in `at=` is written as a comma. `URLSearchParams` escapes it to `%2C`, which is correct and
 * unreadable — and a link the DOCS spell one way and the button spells another is one nobody can compare by
 * eye. A comma is a legal sub-delimiter in a query, and both forms parse back the same.
 */
export function viewLink(base: string, view: SharedView): string {
  const query = viewQuery(view).toString().split('%2C').join(',');
  const withoutQuery = base.split('?')[0].split('#')[0];

  return query === '' ? withoutQuery : `${withoutQuery}?${query}`;
}

/** A camera pose as a shared view's half of it — what the copy button reads off the map. */
export function viewOfPose(pose: MapPose): SharedView {
  return { at: pose.at, height: pose.height, pitch: pose.pitch, projection: pose.projection, yaw: pose.yaw };
}

/**
 * The query for a view: `?src=…&district=…&at=1480,-1720&h=900&pitch=-66&yaw=180&proj=ortho&hour=21&back=120`.
 *
 * Angles go out in DEGREES because a human reads and edits these — `pitch=-66` is a number somebody can
 * change by hand, `pitch=-1.1519173063162575` is not — and they are rounded to what the view can actually
 * show: a tenth of a degree of heading is under one pixel at any zoom this camera reaches.
 */
export function viewQuery(view: SharedView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.src !== undefined && view.src !== '') {
    params.set(VIEW_PARAMS.src, view.src);
  }
  if (view.district !== undefined && view.district !== '') {
    params.set(VIEW_PARAMS.district, view.district);
  }
  if (view.theme !== undefined && view.theme !== '') {
    params.set(VIEW_PARAMS.theme, view.theme);
  }
  if (view.at) {
    params.set(VIEW_PARAMS.at, `${round(view.at[0], 1)},${round(view.at[1], 1)}`);
  }
  if (view.height !== undefined) {
    params.set(VIEW_PARAMS.height, String(round(view.height, 0)));
  }
  if (view.pitch !== undefined) {
    params.set(VIEW_PARAMS.pitch, String(round(degrees(view.pitch), 1)));
  }
  if (view.yaw !== undefined) {
    params.set(VIEW_PARAMS.yaw, String(round(degrees(view.yaw), 1)));
  }
  if (view.projection !== undefined) {
    params.set(VIEW_PARAMS.projection, view.projection);
  }
  if (view.hour !== undefined) {
    params.set(VIEW_PARAMS.hour, String(round(view.hour, 2)));
  }
  if (view.behindLive !== undefined && view.behindLive > 0) {
    params.set(VIEW_PARAMS.behindLive, String(round(view.behindLive, 0)));
  }

  return params;
}

function degrees(value: number): number {
  return (value * 180) / Math.PI;
}

function number(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);

  return Number.isFinite(value) ? value : undefined;
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function round(value: number, places: number): number {
  const scale = 10 ** places;

  return Math.round(value * scale) / scale;
}
