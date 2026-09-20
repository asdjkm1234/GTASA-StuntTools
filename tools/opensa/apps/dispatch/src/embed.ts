/**
 * The console's library entry: the map surface, without the console's own chrome.
 *
 * `main.tsx` mounts a whole application — top bar, panels, the mockup board. A host that already HAS a
 * dispatch board (a CAD with its own units, calls and radio) wants none of that; it wants the map, fed from
 * its own data. That is what this entry exports, and it is deliberately nothing new: the two boot functions
 * below are the same ones `app.tsx` calls, so an embedding host and this repo's own console run identical
 * code and cannot drift.
 *
 * What a host owes the surface:
 *
 * - **two stacked canvases of the same size.** The WebGPU one takes the gestures and must carry
 *   `touch-action: none`; the overlay is the symbology and must not eat pointer events — except in plan
 *   mode, where the surface hides the WebGPU canvas and claims the overlay itself.
 * - **a live board getter.** `ops()` is called once a frame; it must be cheap and must not allocate a new
 *   board per call if the host can avoid it.
 * - **configuration through `window.__opensaDispatch`**, not the address bar. A host owns its own URL, and
 *   the surface must not read it — see `dispatchParams`.
 * - **the pak worker chunk served beside the bundle**, at the path the bundle names — or a `createPakWorker`
 *   passed to the boot, which is how a host that cannot serve a second file carries it instead (201/2-02;
 *   `src/share.tsx` is this repo's own such host). Neither, with a real `src=`, means a 404 on the worker
 *   with the manifest already fetched, which reads as a hang rather than as a missing file.
 *
 * **Two ways to embed, and they answer different needs** (201/7-07). This entry is for a host that mounts
 * the map ITSELF and feeds it its own board. `?embed=1` on `dispatch.html` is the other one: the whole
 * console in an iframe with its chrome off — the map and its own controls, no queue, no roster, no
 * timeline, and it never writes the address bar it does not own. What an embedded console may do is stated
 * in `docs/features/dispatch-console.md` rather than left for an embedder to discover.
 *
 * Full write-up: `docs/features/dispatch-console.md`.
 */

export type { GtaGround } from './map/coords';
export type { CursorPick, MapPose, MapProjection } from './map/map-camera';
export { MAP_YAW, MapCamera } from './map/map-camera';
export type { SharedView } from './map/view-link';
export { readView, viewLink, viewOfPose, viewQuery } from './map/view-link';
export type {
  Incident,
  IncidentPriority,
  IncidentStatus,
  Operations,
  Selection,
  Unit,
  UnitKind,
  UnitStatus,
} from './ops/types';

/**
 * The skin, for a host that mounts this console's chrome itself.
 *
 * An iframe embedder pins a preset by id with `?embed=1&theme=…` and needs nothing from here. A
 * same-document host that wants its own palette passes a whole `ConsoleTheme` through `resolveHostTheme`,
 * which measures it against the same APCA thresholds every shipped preset clears and refuses it — loudly,
 * back to the default — when it does not. What a host must NOT do is override `--os-*` from its own root:
 * the cascade permits it, and it is an unmeasured skin that renders, lints and screenshots fine (201/7-10).
 */
export type { ConsoleTheme, HostThemeChoice, ThemeDensity, ThemeId, ThemeShape } from './ui/theme';
export { resolveHostTheme, THEMES, validateTheme } from './ui/theme';

export type { BootOptions, DispatchHandle, DispatchReadout, MapClick, ZoomLevel } from './world/boot';
export { bootDispatch, dispatchParams } from './world/boot';
export { bootPlanMode } from './world/plan-mode';
