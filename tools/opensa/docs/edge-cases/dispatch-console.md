# Dispatch console — current limitations

The operator surface's own boundaries: what the map does not do today, and why. Engine-wide limits live in
[engine-rendering.md](./engine-rendering.md) and [streaming-formats.md](./streaming-formats.md); the rules a
new design must satisfy are next door in [`restrictions/`](../restrictions/README.md) — in particular
[view-gated residency](../restrictions/streaming-residency.md), which is the map's and not the game's.

## Measuring and drawing (201/7-05)

- **A sketch does not follow the ground.** A ruler, a cordon or a circle is drawn as symbology — world
  points projected onto the overlay canvas with the frame's own view-projection, exactly like the unit chips
  — so its line runs where the operator put it and not over the hill between. This is a decision rather than
  an omission: an operator's cordon has to be visible THROUGH the buildings it is drawn around, and a shape
  draped on the ground disappears behind the first block it crosses. The alternative is Cesium's
  classification technique (render a volume, classify the fragments it covers), and it stays available for
  the day an annotation must read as paint on the road.
- **Nothing occludes a sketch**, for the same reason. A cordon over a tunnel is drawn over the hill above it.
- **A distance is the straight line between two points, not the drive.** SA's vehicle path graph is
  `original`-only ([assets-and-data](../restrictions/assets-and-data.md)), so a routed distance would be
  right on stock San Andreas and a lie on every total conversion. The ruler says what it measures.
- **An ETA circle is not built.** It needs a speed, and the console has never measured one: the units'
  positions arrive every 4 s from PCAD and nothing in the repo has turned that into a travel speed for a
  road, a district or a unit kind. A radius in metres is honest; a radius in minutes would be a constant
  chosen by eye.

## Units drawn as cars (201/5-04)

- **A unit is drawn with ONE angle, so it never leans.** The feed publishes a position and a heading
  ([202 §4](../plans/202-pcad-dispatch/readme.md): `pos_x, pos_y, pos_z, heading`) — SA's z-angle and nothing
  else — so the map turns a car about the up axis and leaves it level. The game's own vehicle handle takes a
  full quaternion and does lean; the map cannot, because roll and pitch are not in the packet. **What it
  looks like:** on a slope the car sits flat and cuts into the road — a 15° hill loses the forward vector's
  0.2588 vertical component, so a 4.6 m car buries a nose or a tail by roughly 0.6 m. Invisible at city zoom,
  visible at street zoom on the hills.

  **Deriving a lean from consecutive fixes would be the tempting fix and it is barred**
  ([restrictions/architecture](../restrictions/architecture.md)): at a 4 s publish rate two fixes are ~110 m
  apart, so the "slope" between them is noise, and the map may not invent an orientation any more than it may
  invent a position. What retires this is upstream — PCAD publishing the two extra floats — and it is worth
  asking for only if a field verdict at street zoom says the flat cars read badly.

- **The wheels do not turn.** No spin, no steer: every part stays at its bind pose, because the feed carries
  no wheel data and the alternative is animating a car from a position it was at four seconds ago. The
  fixture's wheel parts are there and the primitive is one call away if a field verdict ever wants it
  (`RigidEntity.setPartRotation`, the way the engine lab drives its convoy).

- **Peds are not drawn at all.** A unit on foot keeps its symbol — and PCAD sends nothing for it either
  (`isCharInAnyCar` gates the whole publish), so the map has no position to draw a ped at even if it drew one.

## At rest (201/4-01)

- **The picture freezes, sway included.** When nothing that affects the picture has changed, the console
  draws no frames at all — so the palms stop moving and the UV scrollers stop scrolling until the next
  input, board tick or streaming create. Nothing is cut (the protected list is about what the build and the
  frame carry, not about a still map), and the first input resumes all of it. If a frozen world ever reads
  as a hung one, the lever is an idle RATE rather than an idle stop.
- **The status bar says `idle` instead of a frame rate**, and the numbers beside it are the last drawn
  frame's — a console at rest still has the cells, the residency and the pose it stopped at.
- **A change nobody touched can take up to 100 ms to appear** (the idle poll). An operator's own input never
  waits for it: the pointer, wheel and key handlers re-arm the animation frame in their own handler.

## The radar (201/7-04)

- **One scale, the whole world.** The dial frames what the pak carries (its cell extent), so at block zoom
  the view footprint is a few pixels — legible as a position, useless as a shape. A second scale (the
  district box) is the obvious answer and has not been asked for.
- **No world picture.** The radar draws the world's baked district boxes, not a map image. The flat-2D tile
  pyramid ([6/02](../plans/201-dispatch-console/6-display-modes/readme.md)) exists now and the radar does not
  read it yet; a world with no `info.zon` — a total conversion may ship none — gets an empty dial with its
  units on it rather than somebody else's city.
- **Absent in plan mode.** The no-GPU fallback has no pak, so it has no world extent to frame and no
  district table to draw; its own 250-unit grid is what locates the view there. Measuring and drawing DO
  work in plan mode.
- **Only real board entities are drawn**, which is the console's rule everywhere: nothing on the radar is
  ever a decoration that could be mistaken for a unit.

## The flat 2D map (201/6-02)

- **Tiles are drawn under the plan projection and under no other.** The ground plane maps affinely to the
  screen under an orthographic projection at any heading and any tilt, so a tile is one `drawImage` under
  the transform between its own projected corners. Under perspective that map is a homography, which a 2D
  canvas cannot express — an affine per tile would bend every straight road at the tile seams. So opening a
  pyramid takes the view to the plan projection, and a perspective view in the flat mode draws the grid and
  says so in the status bar. Subdividing each tile into affine patches is the way out if a tilted flat map
  is ever wanted; nobody has asked for one.
- **The bake runs in the operator's browser, and only there.** There is no headless capture on the
  development machine ([termux](../development/termux.md)), so `?bake=tiles` drives the console's own engine
  and hands the archive over as a download. A run past **4096 tiles** is refused with the count in the
  message — z8 alone is 65 536 tiles, each one waiting for the streamer.
- **The tiles are lit by whatever hour the bake ran at.** They are pictures of the live world, so a pyramid
  baked at `hour=22` is a night map for good. Baking a map LOOK — even light, no time of day, muted
  surfaces — is [6/01](../plans/201-dispatch-console/6-display-modes/readme.md)'s work, not this mode's.
- **A tile that never streamed is baked as it rendered.** The baker waits for the streamer before every
  capture (up to 180 frames), but a cell the pak does not carry never arrives, and what goes into the file
  is the empty ground that was on screen. Nothing re-renders a tile later.
- **The archive is not incremental.** A rebuilt world means a re-baked pyramid; there is no patch path, and
  a pyramid and a pak that disagree look exactly like a correct map of a different city.

## The phone layout (201/3-01)

**A control the map pushes off the screen cannot be scrolled to.** The console's clusters are absolutely
positioned against the map cell, so when that cell is wider than the viewport — which a bare `1fr` grid
track allows, since it keeps `min-width: auto` — the controls anchored to its right edge are simply gone.
Measured 2026-08-25 at 360 CSS px: layout 403 px wide, and `⟳`, `▼`, `BLK`, `−`, the `Auto` switch and
every call row's state were past the edge. There is no page scroll to recover them and nothing draws a
clipped edge. Fixed by `minmax(0, 1fr)`; guarded by `apps/dispatch/src/ui/styles.test.ts`.

**A native checkbox cannot be given a touch target from this codebase.** `<input type="checkbox">` renders
13x13 and its box is drawn by the browser — `width`/`height` do not resize the control, and this app styles
inline, so there is no stylesheet to reach the appearance from either. A two-state control that needs 44 px
is a `<button aria-pressed>`.

**A range input's thumb is the browser's; its BOX is the target.** The thumb cannot be resized without a
stylesheet, but a range drags from anywhere inside its box, so `height: 44` makes the control catchable even
while the thumb still looks 16 px. Both of the console's sliders were 16 px tall until 2026-08-25.

**Landscape is the posture width cannot see.** At 740x360 the viewport reads as roomy and is 360 px TALL:
the map came to 98 px with the sheet at its 44 % cap. `useShortViewport()` answers it; a width query never
will.
