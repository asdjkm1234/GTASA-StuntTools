# Dispatch console (CAD surface over the streamed map)

`apps/dispatch` (`dispatch.html`) — a computer-aided-dispatch operator surface built on the engine and the
streamer alone: a top-down map of the world, live units, a call queue, and click-to-inspect on any map object.

It is the worked answer to "can OpenSA drive a non-game map application?". It uses the renderer and the world
streaming and **nothing from the game layer** except the one shared config→`Environment` driver, so it is also
the smallest complete example of embedding the engine.

## State

Implemented and running. The world half is verified only on real GPU hardware — see [Verification](#verification).

**Under active development as [plan 201](../plans/201-dispatch-console/readme.md)** (opened 2026-08-06), which
declares the console as the engine's second consumer ([project-goals, directive 7](../project-goals.md)) and
carries eight chains: the map profile (trim the engine to what the map draws — and only that: cars and peds
drawn, vegetation swaying, the day turning and the weather colouring the world are all protected, and one
engine serves PC and mobile on a budget rather than a branch), real device truth (the repo's first
real-world mobile benchmark row), the operator surface at 360 CSS px, render-on-demand for a surface that
idles most of a shift, picking taken off its debug flag, **three display modes**, **the operator's map**
(orthographic mode, flyTo, follow, bookmarks, a minimap, measuring, drawing, keys, embedding) and **the time
axis**. The deferred CAD half — a live feed, real routes, cross-shift history, multi-operator,
install/offline — is [roadmap 0.6.0](../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md).

**The product it is aimed at** (settled with the user 2026-08-06): the dispatcher is a **player** on the
server and so are the units; the data source is a **native CAD plugin**; the console stays a separate web
application beside the game. Its named budgets are 150 units drawn as models, 60 fps on a phone, ≤3 s to a
working picture and a hard 300–500 MB residency ceiling — see the
[plan's budget table](../plans/201-dispatch-console/readme.md), which also states plainly that those four may
not be satisfiable at once and how that gets decided.

## Three ways to draw the world

Decided 2026-08-06 — one camera, one symbology, one board, three sources for what is beneath them
([201/6](../plans/201-dispatch-console/6-display-modes/readme.md)):

| Mode | What it is | State |
| --- | --- | --- |
| Live render | the streamed pak — the game's own world | shipped, this document |
| Baked 3D city map | the world pre-simplified offline and lit like a map rather than a game | the bake exists (`tools/opensa-lod-generator`), the mode does not |
| Flat 2D | top-down tiles, no 3D at all | **shipped 2026-08-23** — `?mode=flat`, one `tiles.pmtiles` beside the pak; [below](#the-flat-2d-map) |

The operator picks; a device that cannot carry the choice starts in one that works **and says why**. Camera
pose, selection and the moment in time survive a switch. The 2D tiles are baked by our own orthographic pass
so every build — including total conversions, which have no third-party map raster and never will — gets all
three modes.

## Switching what draws the world

Three ways to draw the same world and the operator picks (201/6-03): **`m`**, or the `2D`/`3D` key in the
map's nav cluster. It is not a quality ladder — a mode you CHOSE raises no banner.

**The camera comes across; the selection and the moment never move.** The pose is read off the surface that
is leaving and applied to the one arriving, and that is the only thing a switch carries: the board, the
selection and the clock live above the mode, so nothing has to save or restore them.

**A device that cannot carry the 3D map gets the flat one and is told why** — the automatic floor, the same
banner plan mode has always shown. That is a failure being honest, not a downgrade being hidden.

`?mode=` follows the choice, so a reload or a shared link opens the same surface. An embedded console writes
nothing: the address bar belongs to its host.

**A switch is a full teardown and boot**, and the cost is whatever that costs on the device — it is logged
(`[mode] live → flat in N ms`) rather than estimated. The teardown is real: the WebGPU device is destroyed,
the pak worker terminated, and plan mode gives the canvases back exactly as it found them.

## The plan view

**201/7-01, since 2026-08-22.** The `PLAN` button in the top bar (or `?proj=ortho`) draws the same world with
an **orthographic** projection: parallel rays, so buildings stop leaning over the streets they hide and a
distance on screen is the same distance wherever it is measured. Perspective stays the default — this is a
projection an operator turns on, not a display mode ([the three modes](#three-ways-to-draw-the-world) are the
world underneath, and both projections work in all of them, plan mode included).

It is one field on the camera state (`orthoHalfHeight`) rather than a second camera: the view matrix, the
culling, the passes and the symbology are the same code, and only the projection matrix differs. The same
matrix is what [6/02](../plans/201-dispatch-console/6-display-modes/readme.md) bakes the 2D tiles with,
so the mode and the generator cannot drift apart.

## The flat 2D map

**201/6-02, since 2026-08-23.** `?mode=flat` opens the console over a baked tile pyramid instead of the
streamed world: no WebGPU, no pak, no streaming — the same camera, the same gestures, the same symbology and
the same board, over a picture of the city. It is the mode that runs where nothing else does, and the one an
operator can leave open all shift on a phone.

**The whole pyramid is ONE file.** `tiles.pmtiles` sits beside the built game and is read by HTTP range
requests ([PMTiles v3](../links.md)), so the 2D mode adds no tile server, no directory of loose PNGs, and —
the part that matters for the product — **nothing for an operator to calibrate**. PCAD's current 2D map needs
each dispatcher to align a picture to the world by hand and keep the result in `localStorage`; our engine IS
the world, so the archive states the square it was baked over and `map/coords.ts` converts exactly.

| Piece | Where |
| --- | --- |
| the format, written and read | `packages/engine-formats/src/pmtiles.ts` |
| the tile scheme (SanMap's: one square, `y` from the north edge down) | `apps/dispatch/src/map/tiles.ts` |
| the range reader, LRU-capped at 256 decoded tiles | `apps/dispatch/src/map/tile-source.ts` |
| the draw | `apps/dispatch/src/map/tile-layer.ts` |
| the baker (`?bake=tiles`) | `apps/dispatch/src/world/tile-bake.ts`, `tile-bake-host.ts` |

**The tiles are ours, baked from our own world.** An orthographic top-down pass over whatever build is loaded
— so a total conversion gets a 2D map too, which no third-party San Andreas raster will ever give it, and the
picture matches the world that actually streams. The bake runs **in the browser** (`?bake=tiles`, then the
file lands in Downloads): the development machine is a phone with no headless Chromium, and the console
already has the world streamed and the renderer warm.

**It draws under the plan view and nowhere else.** The ground plane maps affinely to the screen under an
orthographic projection at any heading and any tilt, so a tile is one `drawImage` under the transform between
its own projected corners — exact. Under perspective the same map is a homography that a 2D canvas cannot
express, and an affine per tile would bend every straight road at the tile seams. So opening the pyramid
takes the view to the plan projection, and a perspective view draws the grid and says why in the status bar.

**What it says when it has nothing.** No archive, a server that refuses the request, an archive baked over no
square: the map keeps its projected grid and the status bar carries the reason. An empty 2D map that is
silent about it is indistinguishable from one that is still loading.

Three things fall out of the projection rather than being chosen, and each one is a place a naive port goes
silently wrong:

- **The box is sized to frame exactly what perspective frames at the focus plane** (`distance × tan(fov/2)`),
  so switching is a change of projection and not a jump, and pan / dolly / pinch go on meaning what they meant.
- **The front plane sits as far in front of the focus as the far plane sits behind it**, which a perspective
  frustum cannot express: an orthographic box has no apex, so this is what keeps a tower taller than the eye
  from being sliced off at block zoom.
- **Picking and labels read the projection**: under perspective the rays fan out from one eye and clip `w` is
  the distance ahead; under orthographic every ray is parallel and `w` is 1 for the whole world, including
  what is behind the operator. Both are read from the view matrix now, so a plan-view pick lands where the
  cursor is and no callsign is drawn for a unit that is behind the camera.

**What the mode does not change, and says so rather than pretending:** fog, specular and the sky are computed
from the eye POINT (`frame.camera.xyz`), which is exact for a perspective view and an approximation under
parallel rays. The console pushes the fog cut to the far plane anyway, so fog is invisible in normal use —
`?fog=1` with `?proj=ortho` is where it would show. The sky is the one place where the approximation is the
BETTER picture and is kept deliberately: a truly parallel view has one view direction, so an honest
orthographic sky is a single flat colour. Branching the shader on the projection is not on the table —
[one engine, one frame](../restrictions/architecture.md).

## Where the camera may go

**201/7-02, since 2026-08-22.** The map camera's two bounds are **derived from how much world there is
around the focus**, and re-taken whenever the frame moves:

- **it cannot tilt so shallow that the top of the picture leaves the world** — the bound is the tilt whose
  top edge lands exactly at the streamed reach, solved per frame rather than written down;
- **it cannot zoom out past what the reach covers**, because at the top-down limit the frame's half-span is
  the view distance times `tan(fov/2)`.

`reach` is the world's number: the LOD ring for a streamed pak, its own extent for the synthetic demo, and
nothing at all for plan mode, which draws no world and keeps flat bounds. What this replaced was a pitch
floor of `-0.35 rad` and a zoom cap of `7000` units against a `2200`-unit ring — one drag and one wheel turn
away from a map that ends in mid-air ([the restriction](../restrictions/architecture.md)).

**Three zoom levels, on keys `1` / `2` / `3`** — widest to tightest, and each is a thing the world is made of
rather than a number: `city` is everything around the focus, `district` is the baked zone box under the view,
`block` is one render cell. A pak with no zone table falls back to the geometric mean of the other two, since
zoom levels are logarithmic.

**Getting there is a flight, not a jump.** `locate` and the level keys fly along Van Wijk & Nuij's path
([links](../links.md)) — the same one MapLibre's `flyTo` follows: the camera pulls up, crosses, and settles,
and the duration is the path length in screenfuls over a speed in screenfuls per second, so a longer trip
takes longer without anyone choosing a number. The arc is also what keeps the flight honest about streaming:
a long trip crosses at a zoom where resident far-LOD covers the ground, the destination streams as the focus
approaches, and the same zoom cap clamps the arc, so the picture never outruns the ring. **Any input cancels
a flight** — the operator's hand always wins.

## Getting somewhere

**201/7-03, since 2026-08-22.** Four ways to reach a place, all of them flights rather than jumps, in the
cluster at the top-left of the map (`ui/map-tools.tsx`) and on keys:

- **Follow a unit** (`c`, or the Follow button) — the view rides the selection, and the streaming anchor
  comes with it, because on this surface the anchor is the focus. The damper is re-based on the unit rather
  than on the world, so a car at constant speed does not tow the camera behind it, and its time constant is
  **one publish interval over three**: 95 % of any gap closed before the next fix can land. Smoothing the
  camera is not smoothing the data — the marker still steps exactly as the feed sent it
  ([8/02](../plans/201-dispatch-console/8-the-time-axis/readme.md)). A pan, a locate or a bookmark ends a
  follow; orbiting and zooming while riding do not.
- **Fit the board** (`f`, or the Fit button) — every unit and every open call in frame, with one render cell
  of air around them. A board spread across the state is capped by the zoom bound, so the fit shows as much
  world as there is rather than a view of emptiness.
- **Saved views** — named poses in `localStorage`, per operator and per browser. Shape-checked on read, and
  the store never throws: private mode and a full quota lose the save, not the session.
The degraded-map banner moved to the bottom-right in the same change: it used to run across the top, which
is where the cluster now is, and it covered the search box in exactly the mode — plan mode — where an
operator has the least else to work with.

- **Search a place** — the world's own baked district table (the same data behind the readout's district
  name), case- and accent-folded, prefix matches first, with the boxes of one name unioned so flying to
  Vinewood frames Vinewood rather than a third of it. A world that ships no `info.zon` finds nothing, which
  is the honest answer for a total conversion rather than stock San Andreas names.

## At rest, it draws nothing

A dispatch map is idle for most of a shift, so the console draws a frame when something changed and not
otherwise: the view moved, the board ticked, the selection or the hour changed, a sketch grew, a cell
finished streaming, the window resized. *Nothing changed* is a state the loop compares — not an event it
could miss — so a change that arrives while it is asleep is still there when it looks.

An input is answered in the next animation frame (the pointer, wheel and key handlers re-arm the fast
schedule themselves); a change nobody touched is picked up within 100 ms. The status bar shows `idle`
instead of a frame rate, and `?inventory=1` reports `framesSkipped` beside `frames` so a capture says which
kind of run it was. Plan mode does the same — it is the mode a weak device gets.

**And the frame rate is counted over the frames rather than over the loop** (201/3-05, `world/frame-clock.ts`).
Because the loop wakes on a timer and draws nothing, `1000 / mean(dt)` over the last sixty loop passes is a
rate for the loop: a console at rest for six seconds reported **10 fps** and then climbed back over the next
sixty frames as the idle samples aged out of the window. `fps` is now a COUNT of frames drawn in the last
second, and the frame time beside it is the median interval between two **consecutive** drawn frames — the
one that spans a rest is dropped rather than averaged in, and when the window holds no consecutive pair the
bar prints `—` rather than an invented `0.0`. At rest it reads `idle · 16.7 ms last`, since what the last
frames cost is what a touch gets back, and on a desk `cpu N ms` sits beside it: the loop body's own cost is
the number that survives a second with a single frame in it.

**The filed capture is split the same way, and it had the defect worse.** The collector is never called on
a skipped wake — the call sits behind the gate — but a skipped pass arms the next loop entry with
`setTimeout(100 ms)`, so the frame drawn *after* one carries a `dt` that is 99 % sleep. On a live 150-unit
board the console alternates draw/skip continuously: **706 of 835 samples** in the
[2026-08-31 capture](../benchmarks/opensa-engine/2026-08-31-mobile-honest-frame-counter-150u.json) were that
interval, so `dtP50Ms` read the idle poll and `shareOfFrame` (2.3 %) described a resting loop.

`frame.*` is now the paced intervals alone; a `rest` block carries the other population (`frames`, `meanMs`,
`maxMs`, `totalMs`) so a window can still be read, and `rest.totalMs` against `windowMs` says how much of a
capture the console spent at rest on purpose. The whole CPU block divides by that same paced
population, and that half was found by the field run rather than argued: `cpu.bodyMs` is paired one pass
late on purpose, so after a skipped pass it carries the render gate's own ~0.2 ms — `bodyMeanMs` read
**1.48 ms against a real 13.84**, every segment ~11× low. The streamer, the engine timings, the spans and
the world stay over every drawn frame, because those are measured on the frame rather than paired to the
pass before it. The panel shows the split (`rest 706 of 835 frames · 65% of the window`).
**One owner decides which is which** — `FrameClock.drew()` returns the kind and the collector is told — so
the status bar and a filed capture cannot disagree about the same loop.

**The collector also stopped growing.** It kept every `dt` and copied-and-sorted the whole array on each
report, which the panel asks for twice a second: at two hours and 30 drawn fps that was
[58.2 ms a report — ~12 % of the main thread it was reporting on](../benchmarks/opensa-engine/2026-08-31-inventory-collector-storage.json).
A bounded histogram (2 ms bins to 100, 20 ms to a second, one tail) makes it 0.002 ms and 0 bytes of held
samples, at the cost of a percentile that is a bin's floor — the precision every row since 2026-08-22
already had, since they were all read off these bins by hand.

**The `?inventory=1` panel folds** (201/3-05). Fourteen rows of monospace over a 360 CSS px phone is most of
the screen the map is the subject of, so it opens folded where the pointer is coarse, open where it is a
mouse, and the operator's own choice is kept from then on. Folded it is its header, and the header is the
whole target at the full 44 px: it carries the frames sampled, the frame time and — the rule the fold had to
satisfy — a `⚠ n` count over the warnings, the errors and the unavailable GPU timings, so folding can never
swallow one.

**And while the phone panel is driving the page** (`&agent=1`, [phone-console plan 002](../../tools-debug/phone-console/docs/plans/002-mcp.md)),
the band that says so is a live reading rather than a caption. It carries an `offline` state, entered when
the panel stops answering, and counts up how long ago it last did — before that the band could only be
entered on a poll that SUCCEEDED, so a dead panel left *keep this tab in front* on screen in front of
somebody doing exactly that. Under it, each command raises one line saying what it does to this console
(`moving the camera — 1700, -1501 · 900 m`, `switching the map surface`, `taking a picture of the map`),
settling into `done` or `failed` and going: a map that flies somewhere with no hand on it is otherwise
indistinguishable from a defect, and that is the report it produced.

While idle the picture is frozen, sway included; the first input resumes it.

**One wake used to arrive twice.** The idle wait stored its timeout handle and nothing dropped it when the
timer fired, so after an idle wake that drew, an input handler read the dead handle as *a wake is already
pending*, cleared it and armed an animation frame on top of the one the drawn frame had armed — two passes
through the loop for one displayed frame, each paying the held keys, the camera advance and the gate, plus
the wake-up itself. Nothing errored and the picture stayed correct, so the only trace was frames faster than
a vsync interval in a capture: **192 of 808 (23.8 %) on the phone, 6 of 229 (2.6 %) once the handle was
dropped as the timer fires** ([the pair](../benchmarks/opensa-engine/2026-08-30-mobile-idle-timer-fix.json)).
The moving-frame p50 did not move, so what went away was the wasted passes and their wake-ups — battery on a
phone — and no frame time.

## Nothing over the map, when the engine is what is being measured

`?overlay=0` draws the world and nothing above it: the symbol pass, the callsign chips, the sketches, the
radar, and the per-frame update that feeds them. It exists because of what the field round of 2026-08-30
measured — **the symbology and the board are 3.79 ms of a 5.11 ms frame body at 150 units, against the
engine's own 0.72** ([the A/B](../benchmarks/opensa-engine/2026-08-30-mobile-overlay-ab-150u.json)) — so a
streaming or texture number taken with the overlay on is mostly a number about drawing symbols.

The pass is **skipped, not subtracted**: taking the segment off afterwards would credit the engine with work
the GPU still did. The render gate stops watching the board with it, because a window meant to price the
engine may not be paced by a roster nobody can see; the layers stay constructed, so it measures the draw
cost and never the allocation; and the capture carries `overlay: false`, because with the pass skipped
`overlay-2d` reads ~0 for a reason no reader could otherwise tell from a fast frame. `?embed=1&overlay=0` is
the engine with nothing above it at all, and the phone panel offers the pair as two links so the halves
cannot drift apart.

## Labels that declutter

At 150 units a city view collides with itself, so the labels compete for pixels rather than overdrawing each
other. Every **symbol** is always drawn — an icon is the datum — and the **names** are placed best-first
through a collision index: the selection, then open calls worst-priority first, then units committed to a
call, then whatever is nearest the eye. A chip that cannot sit above its symbol tries below, then either
side, before it is dropped, and the status bar says how many names did not fit (*"104 names hidden"*) so a
crowded map is never mistaken for a complete one.

There is no labels-per-frame constant: the screen holds `floor(area / chipArea)` of them, which is 1371 on a
1920×1080 desk and 152 on a 360×640 phone. At 150 units + 40 calls the desk places
[179 of 190 and the phone 86](../benchmarks/opensa-engine/2026-08-22-dispatch-overlay-census.json).

## The radar

**Round** (the user's call, 2026-08-22), bottom-right, 132 CSS px on a desk and 108 on a phone — the one
corner nothing else claims. A dispatch radar answers a distance question, and a circle is the only frame in
which a pixel of travel means the same thing in every direction.

It draws the world's own description of itself rather than a picture of it: the **baked district boxes**
(the city's shape), every unit and open call in their status colours, and the **view's ground footprint** —
a polygon, because under perspective the frame covers a trapezoid of ground and a rectangle would claim the
view reaches somewhere it does not. North-up always, so the world stays put and the footprint turns inside
it. A tap flies there keeping the current zoom: *look over there*, not *zoom in on that*.

**It repaints only when something on it moved** — the board tick, the pose, the selection or its own size —
so a still map costs 20 repaints a second instead of 60 and an idle console costs none. One repaint is 914
canvas calls at 150 units + 40 calls + a 160-box city; a skipped frame is
[zero](../benchmarks/opensa-engine/2026-08-22-dispatch-overlay-census.json).

Not in plan mode: with no pak there is no world extent to frame and no district table to draw, and the plan's
own 250-unit grid locates the view instead.

## Measuring and drawing

Three tools in the operator cluster — **ruler** (tap along a route), **circle** (tap the centre, then the
edge) and **area** (tap the corners, then Finish, for a cordon or a search area) — with the live measurement
in metres, kilometres and square kilometres. Finish, Undo and Clear appear only while a tool is armed. An
armed tool takes the tap whole, so a cordon can be placed over a unit without picking the unit up.

**They are symbology, not world geometry**, and that is the decision worth knowing: a cordon has to be
visible *through* the buildings it is drawn around, so a shape is projected onto the overlay canvas and never
occluded. What it costs is that a shape does not drape over the ground and a distance is the straight line
rather than the drive — both, and why there is no ETA circle, in
[edge-cases/dispatch-console](../edge-cases/dispatch-console.md). Measuring works in **plan mode** too; the
no-GPU fallback is a 2D map, which is what a ruler is best on.

## The keyboard, and the controls on the map

**201/7-06, since 2026-08-22.** Every command the map takes is in one table (`src/map/keymap.ts`), which is
what the keys resolve against, what the `?` sheet prints, and what the rebinder writes to.

| | Keys |
| --- | --- |
| Pan | `W` `A` `S` `D`, arrows |
| Turn / tilt | `Q` `E`, `Shift`+`↑` `↓` |
| Zoom | `+` `-`, levels on `1` `2` `3` |
| Go | north `N`, fit `F`, follow `C`, calls `[` `]` |
| Other | stop following `Escape`, the key sheet `?` |

Movement runs in the frame loop while the key is held, not on the operating system's key repeat, so it moves
smoothly and at a rate rather than in steps: panning is measured in **screenfuls per second**, which means a
key crosses the same share of the picture at city zoom and at street zoom. **Any of it can be rebound** —
open the sheet with `?`, click a row, press the key. Only what differs from the defaults is stored, per
operator and per browser.

**On the map itself** (top-right) there is a compass that says which way north is and puts it back when
clicked, plus turn, tilt, zoom and the three zoom levels. They are the same commands through the same handle,
which is the point rather than duplication: **a capability that lives only on a keyboard ships to one
platform**, and the phone is the device this console is aimed at. Every control takes a finger-sized target
(≥ 44 CSS px, in both axes) where the pointer is coarse and stays dense where it is a mouse — one component
with two sizes, never two layouts ([the rule](../restrictions/cross-platform-surface.md)).

## The first frame, and what it actually costs

**201/4-01, measured 2026-08-25.** The console's first drawn frame was ~2 s on the phone and the whole of it
sat in one span called `overlay-2d`. Splitting that span for its first three draws named the offender: the
first `clearRect` — **212 ms of a 333 ms frame, 64 %** — against 22.6 ms for the symbol layer's first glyph
raster. A 2D canvas on Android Chromium is GPU-backed, and the first drawing operation is what allocates its
backing store, at boot, in the same GPU process that is creating the WebGPU device for the map canvas beside
it.

Both are warmed before the loop now (`warmOverlaySurface`, `warmTextMetrics`), and the resize guard stops
the `ResizeObserver`'s first tick from throwing the warmed store away by re-assigning an unchanged
`canvas.width`. **Measured after: `overlay:clear` 212.1 ms → 0.1, the worst frame 333.1 → 123.0, `dtMax`
390.5 → 140.1.** The split stays in the build as the regression detector for it — six timestamps a session
against a cost that was once two seconds.

Two things are honestly still open. The `fillText` added to the font warm bought 2.3 ms of 22.6, so what
`symbology.render` pays on its first pass is not the glyph atlas and is not yet known. And **`engine-frame`
measured 77.9 ms on the first frame in both captures, to the tenth** — a fixed cost of the engine's own
first pass, untouched by any of this, and now the largest single item on that frame.

The lesson worth keeping is the order: the first attempt warmed the FONT on the assumption that font
resolution was the cost, and the measurement after it shipped did not support that. The split is what
answered it.

[The two capture rows](../benchmarks/index.md) carry the numbers, and the absolute value is not stable — the
same span read 1 850 ms under a taller viewport and a colder start. The shape is: it is one-shot, it is the
allocation, and it is paid once per session.

## The boot shell, and when it is allowed to leave

**Since 2026-08-26.** Between the tap and the first drawn frame the console used to show the page's
background and nothing else — on the phone, seconds of a black rectangle that is indistinguishable from a
crash. The shell is the answer: markup and a script **inline in `dispatch.html`**, painted before a byte of
the module graph is fetched. It cannot import the style table for the same reason it exists — importing
anything would put the 944 kB engine chunk in front of the first pixel — so its colours are ramp literals
with a comment saying why, and `apps/dispatch/src/ui/styles.test.ts` is not the guard for them.

**It leaves when there is a PICTURE, not when `bootDispatch` returns.** Returning only means the loop
started; the world arrives cell by cell after it, and a shell removed at that moment hands the operator the
same empty rectangle a few hundred milliseconds later. `reportBoot` in `boot.ts` watches the frame's own
stats and releases on the first of three: `cellsVisible > 0` (the world is on screen), `cellsTotal === 0`
(there is nothing to stream — the demo city, a pak with no cells), or frame 40 (whatever is happening, the
loop is running and the shell is not the thing to look at). Plan mode has no cells at all and calls
`bootDone()` directly.

**What it reports is what has a denominator.** The bar sweeps — indeterminate, saying "working" — through
the phases that cannot be counted (`starting the GPU…`, `reading the world…`, `the water and the places…`)
and becomes a real fraction the moment the streamer knows how many cells the district holds. Bytes read ride along as a
note with no denominator, because nothing knows in advance how much of the pak the opening view will pull. A
percentage nobody can defend is worse than a sweep.

Two failure shapes are handled, and both matter more on a phone than on a desk. A boot that **throws** calls
`bootFail`, which leaves the reason on screen instead of a bar that never fills — including the WebGPU
fallback, which reports `no 3D map here — switching to the plan view…` on its way to plan mode rather than
vanishing. A boot that **neither finishes nor throws** — a `?src=` that hangs — is caught by the shell's own
30 s watchdog: it says what it was still waiting on, then removes itself, because a fixed overlay left in
the tree keeps eating taps over the whole map. `done()` removes the element for that same reason; it is not
`hidden`.

The app's side is [`src/world/boot-progress.ts`](../../apps/dispatch/src/world/boot-progress.ts) — a typed
handle whose every function is a **no-op when the shell is absent**. The viewer harness, the tests and an
embedding host all mount the console without that markup, and in none of them is a missing shell an error.

## The 77.9 ms nobody owned

**Since 2026-08-26.** The 08-25 round left one number standing: `engine-frame` measured **77.9 ms on the
first frame in both captures, to the tenth** — a fixed cost of the engine's own first pass, and the largest
single item on that frame once the overlay was warmed. Two things ship against it.

**The pipeline compile is asynchronous and overlapped.** `compileAll` enumerates 34 pipelines and used to
create every one of them synchronously, one after another on the thread the boot runs on.
`createRenderPipelineAsync` is the same descriptor compiled on the implementation's own threads: every
pipeline is started, then all of them are awaited once. `compileAll` is therefore async, and a shader that
no longer validates now rejects the boot at that await instead of at the first draw that binds it. Note
where this lands: **`compileAll` runs inside `engine.init`, not inside a frame**, so it shortens the
`starting the GPU…` phase rather than `engine-frame` — the capture records it as `boot.gpuMs`, which is the
number to compare across builds.

**And the frame itself is split, because 77.9 ms with no owner is a guess waiting to happen.** The first
three frames time six phases — `frame:targets`, `frame:sky-lut`, `frame:probe`, `frame:cull`,
`frame:record`, `frame:submit` — and no frame after them pays anything for the split. Three frames rather
than one on purpose: the first pays for everything, and the two behind it are what separate a one-shot
allocation from a steady-state cost. It reaches the capture as `firstFrames`, one entry per frame in order.

It is **not** `frameSpans`. That recorder is for work BETWEEN frames, and the game shell subtracts its total
from the loop body to print `unattributed` — a span from inside the frame would drive that negative, which
is exactly what its own second rule warns about. This one is the engine's own, read once by the host
(`engine.firstFrames`).

The order here is the 08-25 lesson applied rather than restated: the overlay's cost was found by splitting a
span, after a confident guess about font resolution had already shipped and measured wrong.

**And it answered in one capture. `frame:sky-lut` was 75.8 ms of the 77.9** — 0 on the second frame and 0.1
on the third, so a one-shot CPU cost and not a per-frame one
([the row](../benchmarks/opensa-engine/2026-08-26-mobile-boot-split.json)). The cause was not the
atmosphere maths: `f32ToF16` allocated **a new `Float32Array(1)` and a `Uint32Array` view on every call**,
and the 96×48 LUT calls it 18 432 times per build. The pair is module-level now and the alpha channel's
constant is precomputed — **13.29 → 4.05 ms per build in node, 3.3×, output bit-identical**.

That matters beyond the boot, which is why it is worth the paragraph: **the LUT rebuilds whenever the hour
or the weather moves**, so this was a ~76 ms main-thread hitch on every one of them — on the device the
time axis (chain 8) scrubs across.

**The device confirmed it and beat the bench: `frame:sky-lut` 75.8 → 15.4 ms on the first frame, 4.9×**
([the row](../benchmarks/opensa-engine/2026-08-26-mobile-boot-warm-second-open.json)), where desktop node had
predicted 3.3×. The whole first frame goes **85.1 → 23.7 ms**, and what is left on it is `frame:record` at 6.8.

The other number that capture produced has no owner yet: **`engine.init` measured 2 607.5 ms**, larger than
everything else in the boot put together. It is split by phase now (`init:device`, `init:canvas`,
`init:pipelines`, `init:resources`, `init:sky-lut`, `init:targets`, in `boot.phases`) for exactly the
reason above — a number that big with no breakdown is the next confident wrong guess waiting to be made.

**The split answered, and the answer is a question.** The next capture read **`boot.gpuMs` 398.4** with
`init:pipelines` 226.8, `init:device` 117.4, resources 28.9, sky-LUT 17.6, targets 4.9, canvas 2.0 — 397.6 of
the 398.4 attributed. Nothing is claimed for that 6.5×: the only code difference between the two runs is the
sky-LUT fix, which can own at most those 17.6 ms, so ~2.2 s changed hands with no owner at all. **The standing
hypothesis is the browser's persisted pipeline cache — warm on the second open, cold on the first** — and if
it holds, the boot this section is about (the FIRST one after an app rebuild) is still the 2.6 s run and is
currently unmeasured. One capture with the site's data cleared, against one straight after it, settles it.

## The GPU and the radio, at the same time

**Since 2026-08-26.** The boot used its two machines one at a time. `engine.init` measured **2 607.5 ms** on
the phone with the network idle, and only when it returned did the world start looking for its manifest —
a `?src=` probe (up to four `HEAD`s), the manifest itself, the worker and its `Range:` probe, then the game's
`data/timecyc.dat` (up to three candidate names), then the water mesh, then the district table. Every one of
them a round trip, and every one of them behind a GPU that was not using the radio.

**Nothing about that was necessary, and the fix is scheduling rather than cleverness.** The pak's engine-free
half is now a function of its own — `openPakSource(source)` in
[`stream/setup.ts`](../architecture/world-streaming.md), the manifest plus a worker already probed onto its IO
mode and its slice cache — and `bootDispatch` STARTS it, with the timecyc read beside it, before it awaits
`engine.init`. `setupStreaming` takes the result as its `opened` argument and does the engine half only.
Downstream, the water mesh (2.66 MB) and the district table are two independent reads off the same server and
are now fetched together. The pair costs **`max` rather than `sum`**.

Three things worth knowing before touching it:

- **A promise nobody is awaiting still rejects.** `opening` is started before `engine.init` and awaited after
  it, so its rejection has no handler in between — which is an unhandled rejection the moment it happens. It
  gets a discarding `catch`; the real error is still thrown by the `await`.
- **A failing world now fails later.** A bad `?src=` used to report before the GPU started; it now reports
  after. Same message, and the wait in front of it is the one every successful boot pays anyway.
- **The shell narrates the pole, not the race.** `openWorld` reports no step of its own: while it runs, what
  the console is actually waiting on is the GPU, and a bar that narrates the faster of two parallel halves is
  a bar that lies about where the time went.
- **A GPU that fails leaves a worker behind, so the boot closes it.** A device with no WebGPU does not stop
  here — `map-canvas` falls back to the plan view and keeps working — and the pak worker the parallel open
  produced would idle in that session for good, holding its slice cache. `engine.init`'s failure path
  `terminate()`s it when it arrives. That is the price of starting it early, and the only one.

**It is counted, not claimed.** The capture carries `boot.openMs` (the whole pak open — probe, manifest,
worker) beside `boot.gpuMs`, and **`boot.overlapMs`**: how much of the two actually ran at the same time,
derived from the wall clock across both rather than asserted. Both are `0` under `?demo=1`, which opens no
pak.

**Measured on the device, 2026-08-26: `openMs` 230.5, `overlapMs` 227.7 — 98.8 % of the world open ran
underneath the GPU** ([the row](../benchmarks/opensa-engine/2026-08-26-mobile-boot-overlap.json)). The pair
cost **690.8 ms of wall instead of 918.5**: 227.7 ms off the boot, for a change that added 0.41 kB and no
machinery.

**Two more reads moved in behind it.** The sea (`water.bin`, 2.66 MB) and the district table are loose files
the MANIFEST points at, so they cannot be fetched until it is read — but they were being fetched after the
GPU and after `setupStreaming` instead of during them, and the sea was the largest single read left on the
serial path. `openWorld` now reads both as a second wave, still inside the GPU's wait; `installWater` takes
the bytes and does the engine half (a parse and one `setWater`). `streamedWorld` reaches the network for
nothing at all now.

**And the capture says which app produced it.** `app` carries `__APP_BUILD__` — the commit vite stamped in,
with a `+` when the tree was dirty — beside `build`, which is the PAK's `buildTime`. It is there because
three captures in a row on 2026-08-26 were taken of an app the device had never updated to, twice while
everyone believed otherwise; the trap and both of its halves are
[a restriction](../restrictions/architecture.md) now. `dev` means a bundle nobody stamped: the dev server, a
test host, an embedding host.

The first stamp it produced was `67432d1+` from a tree that had been clean one command earlier, which is the
instrument's own bug and is fixed: `appBuild` runs INSIDE the build, after `tsc -b`, so a plain
`git status --porcelain` counts the build's own leavings — and untracked files — as uncommitted work. It
reads tracked files only now, minus the incremental cache. **A `+` that fires on every build is a `+` that
means nothing**, which is the same failure as a capture that cannot name its app, one level down.

## The second open, and why it is cheap

**Since 2026-08-26.** The opening view of a district pulls tens of megabytes out of the pak — the 08-25
captures read **38.6 MB for four cells** — and every open paid for all of it again. The reads are `Range:`
requests over one immutable file, so they cache perfectly: the only thing that can make a slice stale is a
REBUILD, and the manifest already stamps that (`buildTime`).
[`stream/pak-cache.ts`](../architecture/world-streaming.md) keeps them in Cache Storage, named for the
build, and drops the caches of other builds of the same pak when it opens.

Three shapes of "no cache", and all three read from the network exactly as before: **no Cache Storage** (a
secure-context API — the phone's own `http://localhost:3001` has it, another device on `http://<lan-ip>`
does not), **no `buildTime`** (a pak built before the field existed; an unversioned cache is one nobody can
invalidate, and serving a stale slice is silent corruption rather than a miss), and **a refused write**
(quota — one warning, then network for the rest of the session).

Two details the API forces, both worth knowing before touching this: `cache.put` **rejects a 206 by spec**,
so the slice is re-wrapped as a plain 200; and `cache.match` **ignores the `Range:` header**, so every slice
of `world.ospak` would collide on one entry — the range goes in the key instead. Writes are serialized
rather than fired in parallel, which is what makes a refusal able to stop the writes queued behind it.

**Measured on the device, 2026-08-26: a second open of the pinned district read 23.60 MB of 26.26 out of the
cache — 89.9 %, over 40 of 41 requests** ([the row](../benchmarks/opensa-engine/2026-08-26-mobile-boot-warm-second-open.json)),
against 33 % over 59 of 88 on the open that reached past what had filled it. The blob handler's mean halves
with it (0.130 → 0.065 ms). **The single request the cache does not answer is `water.bin`, to the byte** — it
is a loose file beside the pak rather than a pak slice, so it is a miss by construction and not a cache
failure; whether those 2.66 MB crossed the network was not something that capture could say.

**It can now.** `installWater` asks Resource Timing what the network actually carried for that file:
`transferSize === 0` means the browser's own HTTP cache served it outright, and only then is it counted as a
hit — a 304 revalidation carries bytes and counts as a miss, and an entry Resource Timing cannot produce is
never counted at all. So `cachedBytes` means **what did not cross the wire**, over both caches, rather than
one of them.

**It is visible, which on a phone is the whole point.** `pakTraffic.cachedBytes` counts what the disk
answered as a SUBSET of what the world asked for — the bytes a district needs do not change because they
were already local — and the inventory capture carries `bytes.cachedBytes` / `bytes.cachedRequests` beside
the totals. The boot shell shows the same share while the world streams (`38.6 MB read · 38.6 MB cached`),
so an operator with no devtools can see a repeat open working.

## The look, and where its rules live

**[`apps/dispatch/DESIGN.md`](../../apps/dispatch/DESIGN.md), since 2026-08-25.** The console has a design
system now rather than a colour list: a 12-step neutral ramp with one declared role per step, depth carried
by value and shadow instead of a border on everything, three radii, one spacing scale, and a type scale whose
every changing number is tabular.

The rule that matters outside the console: **chrome colour and STATE colour are different things and do not
mix.** Chrome comes from the ramp in `src/ui/styles.ts`. A unit's status and a call's priority come from
`src/map/beacons.ts` → `SET_COLORS` — the one table the beacons, the 2D overlay, the radar and the two lists
all read, which is why a chip in the queue cannot drift from the pillar on the map. A status colour added to
the style table would break that, and `styles.test.ts` fails the build if one appears.

## Skins

**201/7-09, since 2026-08-26; five since 7-10 on 2026-08-30.** In the header's picker: **Night** (the
default), **Day** (a phone outdoors), **Contrast** (bad screen, bright sun, tired eyes), **Amber** (warm
near-black with a monospace chrome and tighter rows) and **Mark43** (an achromatic ramp on a lighter ground,
separating its surfaces with a hairline instead of a shadow — read off the vendor's own product screen).

Switching is one attribute on the app root: the token table holds `var(--os-…)` and each skin is a block of
custom properties, so the browser repaints and **React does no work at all**. A preset costs **197 gzipped
bytes** ([measured](../benchmarks/opensa-engine/2026-08-30-dispatch-bundle-theme-contract.json)), which is
what "a skin is data, not a fork" means in bytes.

A skin carries the neutral ramp, the accent, the two semantic surfaces, the shadows, the font stacks, its
**shape** (the three radii, and whether a surface is told apart by a line or by a shadow) and its
**density** (row padding and the two row-level type steps, together). It cannot change the status colours
(those are the map's own table — a chip in a list and a pillar on the map are the same number), the 44-px
targets, the `input` step at 15 px (below it iOS zooms the page on focus), or where anything sits.

**A dense preset does not reach a phone.** `dense` is refused where the pointer is coarse, in the resolver
and emitted as a `(pointer: coarse)` block — a skin is chosen once on a desk and travels to the same
operator's phone through one `localStorage` key, and nothing else on that path re-asks the question.

**Which skin opens, in this order** (7-10): a link's or an embedding host's `theme=`, then the operator's
stored choice (`opensa.dispatch.theme`), then what their machine asks for (`prefers-contrast`, then
`prefers-color-scheme`), then Night. A link's theme applies for that session and is **never persisted** —
it is somebody else's view — and an id nobody ships falls through to the operator's own skin rather than
resetting them to Night.

**An embedding host has two ways in and one that is refused.** It may name a preset id
(`?embed=1&theme=mark43`), or — mounting the chrome itself — pass a whole `ConsoleTheme` through
`resolveHostTheme`, which measures it and falls back loudly when it fails. What it may **not** do is
override `--os-*` from its own root: the cascade would allow it and no guard would ever see it.

**No skin can ship with unreadable text**, a host's included: every preset goes through APCA and fails
below Lc 90 for primary text and Lc 60 for secondary. A colour the measure cannot read is a **failure**,
not a skip — it used to yield `NaN` and slip through, which is the defect 7-10 closed.

## The workspace: the map is the desk

**201/7-08, since 2026-08-26.** On a desk the map fills the viewport and the two lists float on top of it as
**windows the operator moves and sizes** — by dragging the title bar and the corner grip, or, with either
focused, by arrow keys (shift+arrows to size). Each window remembers where it was put, per browser, under
`opensa.dispatch.windows`.

Three rules make that safe rather than clever:

- **A window is always fully inside the map.** Dragging it past an edge stops it; shrinking the map pulls it
  back in; where the map is smaller than 200×120 the map wins and the window is squeezed. A panel hanging
  half off the screen is a bug that looks like a feature.
- **The map's own corners stay clear.** The windows open at y 180 down the left and right edges, below the
  operator cluster (which ends at y 165) and the turn/tilt/zoom cluster (y 285) — the map's controls are not
  something a list may cover by default.
- **The phone does not get windows.** Under `COMPACT_MAX_WIDTH` the same two panels are the sheet below the
  map, because a window that covers the map it floats over is not a smaller desk, it is a worse one.

Each window's title bar carries its **status tally** — `AVAILABLE 7 · EN ROUTE 2` for the roster, `P1 1 · P3 1`
for the queue — read from `map/beacons.ts` → `SET_COLORS`, so the legend in the header and the pillars on the
map are the same numbers rather than two colours matched by eye.

## What the phone shows, and what it folds

**201/3-01, since 2026-08-25.** A 360-px screen cannot hold the desk's chrome and a map worth looking at, so
on a compact layout the console keeps out only what is pressed constantly and folds the rest one tap away —
folded, never dropped, because a capability that exists on a desk and not on a phone is the failure this
console is measured against.

| | On a desk | On a phone |
| --- | --- | --- |
| The operator cluster (search, fit, follow, save, measure, share) | open | one `TOOLS` handle |
| Turn, tilt, the three zoom levels | open | behind one key beside the compass |
| North, zoom in, zoom out | open | open |
| The calls and units lists | **windows over the map**, moved and sized by the operator (201/7-08) | a tabbed sheet capped at 44 % of the screen, and **collapsed by default when the viewport is short** — a phone in landscape is wide and 360 px tall, where the sheet at its cap left the map 98 px |

Collapsed, the sheet still carries both counts, which are the two numbers a dispatcher watches; tapping the
tab you are on closes the list, tapping the other switches to it.

**The measurements this replaced** are in
[201/3-01](../plans/201-dispatch-console/3-the-operator-surface-on-a-phone/readme.md): a layout 403 CSS px
wide inside a 360-px screen with four nav keys and the `Auto` switch off the edge, nine controls under 44 in
one axis, and a tool cluster covering ~60 % of the map.

## Leaving the console

**201/7-07, since 2026-08-22.** Three ways a view goes somewhere else.

**A link to what is on screen.** `Copy link` writes a URL carrying the pose, the projection, the world hour
and how far behind live the shift clock was — everything that makes the picture what it is. Opening it puts
another operator on the same view, including the moment. It does not carry the selection: an id from one
board means nothing on another. Angles are degrees and the coordinates keep their comma, so a link can be
edited by hand.

**Embedded in another page** (`?embed=1`), and what it may do is stated rather than discovered:

| | |
| --- | --- |
| Shows | the map and its own controls — nav cluster, operator cluster, selection panel |
| Never shows | the queue, the roster, the shift timeline, the status bar — the host has its own board |
| Never writes | the address bar; a host owns its URL, which is also why `dispatchParams()` reads `window.__opensaDispatch` |
| Keeps | the keyboard, the gestures, saved views and rebound keys — they belong to the person at the screen |
| Reports out | through the handle, the same seam `embed.ts` gives a host that mounts the map itself |

**An image of the situation.** `Save image` writes a PNG of the world **with the symbology over it** —
composed from both canvases, because the units, calls, callsigns and trails all live on the second one and a
naive capture of the first is a screenshot of a video game. Under the picture is a stamp: place,
coordinates, eye height, projection, time and the pak build, so an image in a chat a week later still says
where and when it was. Plan mode exports too, and says `plan mode` on its face.

## What it is made of

| Concern                | Where                                    | Notes                                                                                       |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Engine host, frame loop | `src/world/boot.ts`                     | boots the engine, picks a world, owns input; React never enters the loop                     |
| Boot shell             | `dispatch.html` + `src/world/boot-progress.ts` | the progress overlay painted before any module; leaves on the first frame that has a picture |
| Pak slice cache        | `@opensa/engine` `stream/pak-cache.ts`   | range slices kept between sessions, keyed by the pak's `buildTime`; optional everywhere |
| World (real)           | `src/world/pak-source.ts` + `water.ts`   | `?src=` → `setupStreaming` + the baked `water.bin`                                           |
| World (demo)           | `src/world/demo-city.ts`                 | `?demo=1` — a synthetic block grid, no pak needed; reuses `@opensa/engine-lab/synthetic`      |
| Camera                 | `src/map/map-camera.ts`                  | ground-focus map rig over `@opensa/web/ui/camera/*` — pan / orbit / dolly, north-up default, **perspective or plan view**, bounds derived from the world's reach |
| Camera flights         | `src/map/fly.ts`                         | Van Wijk & Nuij's zoom-and-pan path — pure, so the host samples it from its own loop           |
| Saved views            | `src/map/bookmarks.ts`                   | named poses in `localStorage`, shape-checked and non-throwing                                  |
| Operator cluster       | `src/ui/map-tools.tsx`                   | search, fit, follow and saved views — a skin over the map handle, never on the frame path      |
| Keyboard               | `src/map/keymap.ts` + `keys.ts`          | one binding table; held commands run in the loop, pressed ones fire once                       |
| Map controls           | `src/ui/map-nav.tsx`, `key-help.tsx`     | compass, turn, tilt, zoom; the key sheet and its rebinder                                      |
| Per-operator storage   | `src/map/storage.ts`                     | the one place `localStorage` is touched, and the one place it is allowed to throw              |
| Shareable view         | `src/map/view-link.ts`                   | the link's parameter names and both directions, so a URL it writes is one it opens             |
| Image export           | `src/world/capture.ts`                   | world + symbology composed at the end of a frame, with a stamp under it                        |
| 3D symbology           | `src/map/beacons.ts`                     | through-depth `createDebugLines` pillars, routes, selection ring                             |
| 2D symbology           | `src/map/overlay-2d.ts`                  | icons, chips, leader lines, scale bar — on a plain 2D canvas, and it owns hit-testing        |
| World→screen           | `src/map/projection.ts`                  | `mat4LookAt` × the frame's own projection (perspective or orthographic), rebuilt per frame    |
| Board (domain)         | `src/ops/*`                              | units, calls, assignment, a pure `stepOperations` tick — renderer-free and unit-tested       |
| Chrome                 | `src/ui/*`, `src/app.tsx`                | call queue, roster, selection panel, status bar; desk and phone layouts                      |
| Gestures               | `src/map/gestures.ts`                    | mouse and touch through one set of Pointer Events                                            |
| No-WebGPU fallback     | `src/world/plan-mode.ts`                 | the same camera and symbology, 2D only — no engine, no GPU                                   |

## The two decisions worth reading

**Labels are not in the scene.** The engine has no font — its only text is baked road-sign glyph quads and
license-plate rasters. Everything an operator reads must stay upright, legible at any zoom and never occluded,
which is 2D by nature, so the symbology is drawn on a second canvas stacked over the WebGPU one and positioned
by projecting world points with the same view-projection the frame was rendered with. Nothing in the renderer
has to know it exists. Only the beacons — which must read as being *in* the world — are 3D.

**Fog is pushed to the far plane, and that is not a look preference.** The engine culls a cell that lies
entirely past `fogCutDistance` (2400 by default), so from the kilometre-high eye a city view needs, every cell
is culled and the map comes back empty. `pushFogOut` ties the cut to `CAMERA_FAR`, and re-applies after every
hour change because the environment driver rewrites both distances. `?fog=1` restores the game's own fog.
(`sa-map-viewer` learned this the same way; the note there is the other half of this one.)

## On a phone

The console runs on a phone, and this is the one surface in the repo that does — the game needs a BC-capable
GPU, which no phone has.

- **Layout** flips below 860 px (`use-compact.ts`, a media query — a phone in landscape, a narrow window and a
  split screen all need the same treatment and none is reliably identifiable any other way): the map fills the
  screen, the two lists move into a tabbed sheet under it, and the top and status bars drop what does not fit.
- **Gestures** (`gestures.ts`): one finger pans, two fingers pinch to zoom and drag to orbit, a long press
  opens a call — touch has no wheel, no second button and no hover, so three of the five desk gestures had to
  be re-cast rather than mapped. The canvas carries `touch-action: none`, without which the browser claims the
  drag for scrolling before a single `pointermove` arrives.
- **Chips clamp to the canvas** and calls drop their title below 620 px — on a phone most icons sit near an
  edge, and an unclamped chip hangs half off screen.
- **The worlds it can show** are `?demo=1` (synthetic, RGBA8) and any pak built with `opensa-pack --rgba8`.
  A stock pak is BC-compressed and mobile GPUs ship ETC2/ASTC, so it will not load; the engine boots without
  BC and fails on the first BC texture instead, by name. See
  [edge-cases/browser-runtime.md](../edge-cases/browser-runtime.md) for the cost of `--rgba8` and what a
  cheaper encoding would take, and [restrictions/assets-and-data.md](../restrictions/assets-and-data.md) for
  why it is a build-time decision.
- **Plan mode is the floor.** If WebGPU is missing entirely — an older phone, a locked-down browser, a
  blocklisted GPU — the console does not die: `plan-mode.ts` runs the same camera, gestures, symbology and
  board on a 2D canvas with a projected ground grid, and a banner says what is missing. The world is gone;
  the dispatcher's job is not.

## Embedding it

`src/embed.ts` is the library entry: the map surface without the console's own chrome, for a host that
already HAS a dispatch board and wants the map fed from its own data. `npm run build:embed:dispatch` emits it
to `dist-embed/` as one ES module (337 kB, 104 kB gzipped) **plus a separate `assets/pak-worker-*.js`, which
must be served beside it at the path the entry names** — the same trap the single-file build hit, and the
reason this build does not try to be single-file.

It exports nothing new. `bootDispatch` and `bootPlanMode` are the functions `app.tsx` already calls, so an
embedding host and this repo's own console run identical code and cannot drift. React is absent from the
bundle by construction rather than by configuration — the surface is plain DOM and engine, and only the
chrome is React, so a React import appearing in `dist-embed` means chrome has leaked into the surface.

**A host owns its own URL**, so the surface must not read it: configuration goes through
`window.__opensaDispatch` (see `dispatchParams`). That channel already existed for opaque-origin pages on a
phone; an embedding host is its second, and less exotic, user.

**Worlds are HTTP, and that is the whole point.** `resolvePakBase` probes `manifest.json` over `fetch` and
accepts an absolute URL, so a hosted pak needs no local game files, no folder picker and no File System
Access prompt — a user opens the page and the world streams. The folder picker belongs to `sa-map-viewer`,
which is a different app answering a different question. Two costs are attached and neither is a bug: the
reference pak is **1.27 GB at 1137 cells** (streamed, so a session pays for the cells it visits, cached per
build version), and a stock pak is BC throughout, so **a hosted world is desktop-only** until
[plan 200 / chain 2](../plans/200-platform-reach/2-universal-textures/readme.md) lands — `--rgba8` is the
interim, at 4–8× texture memory.

`MapCamera.applyPose` exists for hosts: every other camera step is relative, which is right for input and
wrong for a host that has a pose in hand — locking a view north-up, or restoring the tilt it left, would
otherwise mean solving through `orbit` and knowing the camera's private step scale. `pitch` is clamped like
any other, so a caller may ask for straight down without knowing how far down this camera goes.

## Clicking

A click resolves against the symbology first (the operator aimed at a chip), then against the world through
`CellStore.pick`, which needs `engine.cells.debugPicking = true` set **before the first cell loads** and a pak
carrying the placement mapper (minor 6). A world hit answers the **model and TXD names** the pak was built from
plus GTA coordinates — the readout a mod author wants, and one no tile-based map stack can produce. Right-click
opens a call at the ground point under the cursor.

## Units are drawn as cars

The unit a dispatcher sees is a **model with a symbol over it**, which is the whole difference between this
and every other dispatch map (all of them are flat tiles with dots on them). The model is resolved the way
the game resolves a spawn — `<model>.osm` **by name**, out of `models/vehicles.img` and its neighbours beside
the pak, over HTTP Range requests, directory first and one entry per type. One upload serves every unit
driving that type, so a 150-car shift of six kinds is six models.

**The fix is drawn exactly as it arrived.** The position, the height and the facing are the server's own
numbers — the run that published them had collision, so the car was on the road when they were taken, and
this surface adds nothing to that: no ground snap, no smoothing, no re-simulation. A unit here is a model
drawn on the map rather than an object in a world. The placement is pinned to the game's own (`[x, z, −y]`,
height verbatim) by a test, because the operator's job is done on the belief that the map and the game agree.

**Everything about it degrades to the symbol.** No game dir (a pak deployed alone, or `?demo=1`), a build
converted without `--vehicles`, a total conversion that never had a car called `copcarls`, a feed that names
no model: the unit is drawn exactly as it was before models existed, the console says so once per name in the
log, and the readout counts it (`cars 7/9 · 3 types · 12.5 MB`). A unit is never dropped from the map for
want of a model — that would read as a unit going off duty.

The names it looks for, and what a wrong one does, are in
[contracts/dispatch-map](../contracts/dispatch-map.md) §2.

## Known gaps

Each now names the step that owns it, so none of them is an open-ended note.

- **Routes are straight lines**, not driven paths. The vehicle path graph is `original`-only
  ([assets-and-data](../restrictions/assets-and-data.md)), so a total conversion has nothing to route on; a
  bearing that is honest about being a bearing beat a route that silently lies on half the games.
  → deferred: [roadmap 0.6.0](../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md).
- **The board is a mockup feed.** `stepOperations` stands in for a real one; wiring this to a game server
  replaces that one module and nothing else. → deferred, contract first:
  [roadmap 0.6.0](../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md).
- ~~**No unit models.**~~ **CARS LANDED 2026-08-26; peds still keep their symbol.** A unit is drawn as the
  model the board says it is driving, with the chevron and chip still on top of it (they carry the callsign
  and the status, and they are what an operator picks out at city zoom). The models come from the built
  game's own archives BY NAME over Range requests — the pak carries nothing about a vehicle, by decision —
  and every way that can fail ends at the symbol the unit already had, once per name in the log and counted
  in `?inventory=1`. Units are **kinematic**: a position is a claim the feed makes, so nothing here reads
  collision. Peds are deliberately not drawn yet — the ped path is a skinned probe rather than a rigid model,
  and it should not be built before 150 cars have been timed on a phone.
  → [201/5-04](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- **Demo mode has no model names.** Synthetic cells carry no placement mapper, so a click on a demo block
  resolves to bare ground. → picked up with the production pick capability,
  [201/5-01](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- ~~**Picking stands on a debug flag.**~~ **CLOSED 2026-08-12.** The flag is `engine.cells.picking`, a named
  capability, and its cost is counted (`cells.pickingBytes` → the report's `world.pickingMb`) rather than
  reported as free by every instrument in the repo.
  → [201/5-01](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- ~~**The beacon layer silently dropped markers at 96 per set.**~~ **CLOSED 2026-08-21.** The buffers are
  allocated at the declared 150 (`src/ops/budget.ts`) and grow past it, counting each growth into the report:
  a unit the dispatcher cannot see is not an acceptable way to hit a budget. `?units=150&calls=40` loads the
  board to the declared count — until then it could not be loaded past the nine-car demo shift on any device.
  → [201/5-02](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- ~~**Places come from a hardcoded landmark table.**~~ **CLOSED 2026-08-21.** The world's own districts are
  baked beside the pak (`districts.json`, from `info.zon` × `american.gxt` at pack time — a surface streaming
  a pak reaches neither file) and a click answers model, TXD, **district** and coordinates. The twenty Los
  Santos landmarks remain the fallback for `?demo=1`, plan mode, an older pak, and any game shipping no
  `info.zon`. → [201/5-03](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- **The units are not an instanced symbol layer yet.** They are a chevron and a label chip drawn per unit on
  the 2D canvas. The per-symbol canvas cost is down (text measured once per distinct label, font set once a
  frame, instead of both per chip per frame —
  [the counts](../benchmarks/opensa-engine/2026-08-21-dispatch-symbology-call-counts.json)), and `fillText`
  is still one call per chip. Whether that needs to become an instanced draw is a question the milliseconds
  at 150 units answer first. → [201/5-02](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- ~~**Time is an axis now, but nothing drives it yet.**~~ **The clock landed 2026-08-22.** The shift strip
  scrubs, plays at ×1/×2/×8, returns to Live and holds bookmarks; the board is reconstructed at whatever
  moment is on screen — units where they were, calls with the status they had. The world's dial says `WORLD`
  and the shift strip says `SHIFT`, because they are two different times and the console was labelling one
  of them "Time". A resolve costs p50 0.071 ms.
  → [201/8-03](../plans/201-dispatch-console/8-the-time-axis/readme.md).
- ~~**Units step between fixes and nothing SAYS a marker is stale.**~~ **Closed 2026-08-22.** Interpolation
  was dropped on the user's call (a straight line across a 4 s gap at 100 km/h runs through buildings), and a
  unit whose fix has aged past one publish interval is now drawn hollow, faded with age, and carrying that
  age on its chip. Both thresholds are PCAD's own — 4 s publish, 300 s backend sweep.
  → [201/8-02](../plans/201-dispatch-console/8-the-time-axis/readme.md).
- ~~**No trails.**~~ **Landed 2026-08-22.** Every unit draws its current LEG — back to its last status
  change, not a fixed number of minutes. 150 legs resolve in p50 0.200 ms and produce 7 500 segments a
  frame. They ride at a fixed height rather than following the ground: that clamp belongs to
  [7/05](../plans/201-dispatch-console/7-the-operator-map/readme.md) and building it here would build it
  twice. → [201/8-04](../plans/201-dispatch-console/8-the-time-axis/readme.md).
- **The mobile evidence is emulated, not hardware.** The phone runs below are an emulated Pixel 7 and a
  simulated mobile adapter; the one real device in the repo's record (Mali-G51, 360×800 DPR 2) ran the
  synthetic `?demo=1` city, not a streamed world. → the real-district row is
  [201/2-03](../plans/201-dispatch-console/2-real-device-truth/readme.md).

## Verification

- `apps/dispatch/src/ops/sim.test.ts`, `src/map/coords.test.ts` — the board and the coordinate conversion.
- `apps/dispatch/src/ops/budget.test.ts`, `src/ops/seed.test.ts` — the declared count off the query string,
  and a board seeded to it: unique ids, scattered rather than stacked, and the same board on a second run.
- `apps/dispatch/src/map/overlay-2d.test.ts` — the symbology layer against a stub 2d context, so what is
  pinned is the WORK IT ASKS FOR rather than a time this machine happens to take: a label is measured once
  and never again — **including a stale unit whose chip carries a fix age that ticks every second**, which
  is measured in parts so the cache still settles — the font is set a fixed number of times per frame rather
  than once per chip, an aged unit is marked and says how old, and the counts match what was drawn. Every
  one was verified by reintroducing its defect.
- `apps/dispatch/src/ops/tracks.test.ts` — the time axis and the trails: that a trail stops at the last
  status change rather than running the whole shift, that one sample is no trail, that it never exceeds its
  work bound, and — for the axis itself — that it answers with the LAST FIX rather than a
  slide between two, that it does not extrapolate past the last sample (it holds and says how old the answer
  is), that it records at the PUBLISH rate rather than the tick rate, and that a stationary run collapses to
  two samples. Each of the three policy rules was verified by reintroducing its defect.
- `apps/dispatch/src/ops/clock.test.ts` — the shift clock: it cannot be scrubbed outside what was recorded,
  it does not slip into live when playback catches up, picking a rate while live enters replay at the moment
  on screen, and Live returns to the wall clock rather than to where the scrub was.
- `apps/dispatch/src/ops/history.test.ts` — the reconstruction: a call is absent before it was opened, a unit
  with no sample is dropped rather than drawn where nobody saw it, both a call and a unit carry the status
  they HAD rather than the one they ended with, and a unit that went OFF DUTY stays in the replay of the
  hour it worked (the history keeps its own roster; the live board's is the wrong one to read).
- `apps/dispatch/src/world/zones.test.ts` — the baked district table: a missing file, a malformed one and a
  pak that declares none all answer "no districts" rather than throwing into the boot, a row missing its
  corners is dropped instead of reaching `zoneAt` and throwing inside the map's tap handler, and a point
  resolves to the smallest containing district rather than the city around it.
- `apps/dispatch/src/map/beacons.test.ts` — the whole declared budget fits in ONE status without growing, a
  board past it grows instead of dropping, and a grown buffer never writes past the set's allocation (which
  on a real device is a WebGPU validation error, not a dropped marker).
- `apps/dispatch/src/map/map-camera.test.ts` — `applyPose`: that it is what the constructor does (so a fresh
  camera and an applied pose agree), that it round-trips a saved pose, and that it answers its own bound to
  anything past it — the test that pinned `TOP_DOWN_PITCH` at a hundredth of a radian short of vertical
  rather than at vertical, which is what a host asking for "straight down" actually receives.
- The embed build, 2026-08-07: `dist-embed/dispatch.js` emits all five exports, carries **no React**, names
  its `pak-worker-*.js` chunk, and imports cleanly in a bare Node runtime — so the module has no top-level
  browser dependency. **Not verified: the embedded surface has never been rendered by a host** — that needs a
  GPU, and the artifact's first real consumer is outside this repo.
- `packages/engine/src/core/ostex-upload.test.ts` — both directions of the BC rule: a BC payload is refused by
  name on a GPU without BC (and no texture is created), an RGBA8 one uploads.
- `packages/cell-weld/src/textures.rgba8.test.ts` — both directions of `--rgba8`, on a SYNTHETIC DXT1
  dictionary so it runs without a game tree (the planner's other tests need `npm run test:fixtures`).
- Phone, emulated (Pixel 7, 412×839 CSS px, DPR 3, touch, 2026-08-04): the compact layout, the tabbed sheet,
  the clamped chips and the demo world (576 recorded draws, 44/144 cells visible, 38-46 fps under SwiftShader).
  Re-run with `texture-compression-bc` filtered out of the adapter — **the console boots and builds its world
  on a simulated mobile GPU**, which is the change's whole point. Re-run again with `navigator.gpu` returning
  undefined — **plan mode takes over**, banner and all.
- Single-file build (the shareable artifact): `npm run build:share:dispatch` → **one `dist-share/dispatch.html`,
  655 kB raw / 217 kB gzip**, which streams a real `?src=` as well as `?demo=1`. It adds its own
  `<meta name=viewport>` at runtime (without it a phone lays out at ~980 px and the DESK layout wins on a
  412 px screen — found by publishing it).
  **It used to be single-file only for `?demo=1`**, and that is closed (201/2-02): the pak worker was a
  separate `assets/pak-worker-*.js` chunk that `?demo=1` never constructs, so a real pak fetched its manifest
  and then 404'd on the worker — a hang, not a missing file, and invisible for months because a shared link
  only ever opened the demo. The share entry (`src/share.tsx`) now carries the worker inline and hands the
  constructor to the boot, and the build **refuses to emit an artifact that would fetch anything beside
  itself** — verified in both directions by dropping `?worker&inline` and watching the build fail by name.
- In-browser (SwiftShader, 2026-08-04): engine boot, `.oscell`/`.ostex` load (576 recorded draws), the frame
  loop, frustum culling (53/144 cells visible), the projected symbology, the whole console and the
  pak-missing failure path all run. **The rendered world image was NOT verified** — the software WebGPU
  device produces a blank canvas, and the pre-existing `engine-lab` synthetic district renders blank on the
  same device, so the limitation is the rasterizer rather than this app. The world half needs a real GPU.
