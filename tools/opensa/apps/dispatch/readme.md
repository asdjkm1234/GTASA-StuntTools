# @opensa/dispatch

**Design system: [`DESIGN.md`](./DESIGN.md)** — the palette's step roles, the layering rule, the type
and spacing scales, and why a unit's colour may not live in the style table.

A computer-aided-dispatch (CAD) operator console over the streamed San Andreas map: top-down 3D view, live
units, a call queue, and click-to-inspect on any map object.

```bash
npm run dev
# with a built game (default ?src=build/original):
open http://localhost:5173/dispatch.html
# without one — a synthetic block city:
open http://localhost:5173/dispatch.html?demo=1
```

## Controls

| Gesture            | Does                                             |
| ------------------ | ------------------------------------------------ |
| left-drag          | pan the map                                      |
| right-drag         | orbit / tilt around the point you are looking at |
| wheel              | zoom                                             |
| click              | select a unit, a call, or a map object           |
| right-click        | open a new call at that spot                     |
| double-click a row | centre the map on that unit or call              |

The time slider drives the world's lighting; "Auto-dispatch" makes the desk assign the nearest free unit to
every pending call by itself.

## What it uses from OpenSA

`@opensa/engine` (renderer + streaming) and `@opensa/engine-formats`. **Nothing from `packages/game`** except
the shared config→`Environment` driver, so no ECS, no Rapier, no peds, no vehicle physics, no weather sim.
Camera rig steps come from `@opensa/web/ui/camera/*`, the demo city's fixture from
`@opensa/engine-lab/synthetic`. Unit models come from `@opensa/loaders` — the lazy VER2 archive reader and
the `.osm` decode, both of which moved there rather than being imported out of `packages/game`
([201/5-04](../../docs/plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md)).

## One file you can send someone

```bash
npm run build:share:dispatch   # → dist-share/dispatch.html, and nothing beside it
```

The whole console in a single HTML file, streaming a real world when it is given a `?src=` — the pak worker
is carried inline rather than fetched, which is what used to make a shared link work only on `?demo=1`
(201/2-02). The build fails rather than emit an artifact that would load a file it does not ship.

## Embedding the map elsewhere

```bash
npm run build:embed:dispatch   # → dist-embed/dispatch.js + assets/pak-worker-*.js
```

`src/embed.ts` exports the surface without this app's chrome, for a host with its own dispatch board:

```ts
const map = await bootDispatch({ canvas, overlay, ops, selection, onClick, onGround, onReadout });
map.camera.applyPose({ at: [1700, -1500], height: 900, pitch: -Math.PI / 2, yaw: MAP_YAW }); // north-up plan view
```

Serve the worker chunk beside the entry, configure through `window.__opensaDispatch` rather than the address
bar (the host owns the URL), and point `src=` at an absolute URL to stream a hosted pak — no local game
files, no folder picker. Details and the costs:
[docs/features/dispatch-console.md](../../docs/features/dispatch-console.md#embedding-it).

## Design notes

Two things are worth knowing before changing anything here:

- **All text is 2D, on a canvas stacked over the WebGPU one**, positioned by projecting world points with the
  frame's own view-projection. The renderer has no font, and operator text should not be in a 3D scene anyway.
- **Fog is pushed to the far plane on purpose.** The engine culls cells past `fogCutDistance`; leave it at the
  game's value and a city-wide view renders nothing. `?fog=1` puts it back.

Full write-up, including the known gaps and what was and was not verified:
[docs/features/dispatch-console.md](../../docs/features/dispatch-console.md).
