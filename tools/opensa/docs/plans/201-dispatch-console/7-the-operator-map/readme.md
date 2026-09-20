# 201/7 — The operator's map: camera modes and the tools on top

What a map application has that a game does not, beyond the world itself. All of it decided 2026-08-06; none
of it exists today.

The console's camera is `apps/dispatch/src/map/map-camera.ts` — a ground-focus rig over
`@opensa/web/ui/camera/*`, pan / orbit / dolly, north-up by default, perspective only. Everything below
extends that one class rather than introducing a second camera.

## Steps

### 01 — Orthographic mode

A real plan view: buildings stop leaning, distances read honestly, the picture becomes a drawing. The
operator switches it on; perspective stays the default.

This is not only a look. The same projection is what **bakes the 2D tiles** in
[6/02](../6-display-modes/readme.md), so the mode and the generator share one matrix rather than two that
drift.

Watch two things the engine currently assumes are perspective: frustum culling, and the fog cut that
[a restriction](../../../restrictions/architecture.md) already says must be pushed out at city height.

**Owes:** culling correctness under an orthographic frustum (a cell wrongly culled is an empty screen, and
the counters will still look healthy), and the frame cost against perspective at the same coverage.

**DONE 2026-08-22 on the desk half; the frame cost is owed by a device run.** One field on the camera state
(`CameraState.orthoHalfHeight`) and one matrix (`mat4OrthographicZO`) rather than a second camera — the view,
the culling, every pass and the symbology are the same code, and the map camera carries the projection in its
POSE so a shared or restored view opens as it was left. `?proj=ortho`, or the `PLAN` button in the top bar.

What the step actually had to settle, none of which is the matrix:

| Question | The answer taken, and why it is derived rather than picked |
| --- | --- |
| How big is the box? | `distance × tan(fov/2)` — it frames exactly what perspective frames AT THE FOCUS PLANE, so switching is a projection change and not a jump, and pan / dolly / pinch keep their meaning |
| Where is the front plane? | as far in front of the focus as the far plane is behind it. An orthographic box has no apex, so the plane may sit ABOVE the camera — which is what stops a tower taller than the eye being sliced off at block zoom, and a perspective near plane cannot express it. Depth stays ≤ 24 km, which `depth32float` carries at ~1.5 mm |
| Is the culling correct? | `frustumFromViewProj` is Gribb–Hartmann over any view-projection, so it needs nothing new — the ortho planes come out PARALLEL rather than converging, which is pinned by a test, together with the case that reads the two apart: a sphere 60 units off-axis and 500 deep is inside the perspective frustum and outside the box |
| Where does a pick go? | the variation swaps halves: perspective fans the DIRECTION out of one eye, orthographic slides the ORIGIN across the image plane. Getting this backwards is SILENT — every pick lands under the middle of the screen |
| And the labels? | the overlay's "behind me" test was clip `w`, which is **1 for the whole world** under an orthographic projection, so a unit behind the operator would keep its callsign on screen. It reads the view matrix now, in both projections (`depth` is unchanged for perspective: `w = −z_view`) |

**What it does NOT change, stated rather than discovered:** fog, specular and the sky all read the eye POINT
(`frame.camera.xyz`), which is exact under perspective and an approximation under parallel rays. Fog is
invisible in normal use because the console pushes the cut to the far plane — it shows only under `?fog=1`
with `?proj=ortho`. The sky is the one place the approximation is the better picture and is kept on purpose:
a truly parallel view has ONE view direction, so an honest orthographic sky is a flat single colour. No
shader branch either way — [one engine, one frame](../../../restrictions/architecture.md).

**Owed by the next field run:** the frame cost against perspective at the same coverage, and the eye
verdict that both projections show the same world at the same pose (no cell present in one and missing in
the other) — the desk has the parallel-plane test, the screen has the picture.

### 02 — Where the camera may go

- **Pitch is clamped** — below some angle a map stops being a map: near buildings occlude everything and the
  streamer is asked for half the city out to the horizon. The clamp is a rule derived from what is on screen,
  not a constant picked by eye.
- **Continuous zoom, with keys that jump to levels** — city / district / block.
- **`flyTo` with animation** on selecting a call or a unit, because an instant jump loses the operator's
  sense of where they were. It must not stall on streaming: name what is shown while the destination loads.

**Owes:** the clamp rule with the observation behind it, and the flyTo duration measured against the time the
destination district needs to stream.

**DONE 2026-08-22 on the desk half; the flyTo-vs-stream number is owed by a device run.** All three parts are
rules read off the world rather than constants, and the two they replaced show what that is worth: the pitch
floor was `-0.35 rad` and the zoom-out cap `7000` units of distance, against a **2200-unit** LOD ring — one
drag and one wheel turn put the top of the frame over ground nobody had loaded, which renders as a world that
simply ends.

| Part | The rule, and where its number comes from |
| --- | --- |
| **Pitch clamp** | the shallowest tilt whose TOP EDGE lands inside the world around the focus. Perspective: the top edge is a ray `fovY/2` above the axis, landing at `d·sin t / tan(t − f)`; orthographic: it is parallel and offset by the box half-height, landing at `half / sin t`. Solved by bisection (32 fixed halvings — the reach is monotonic in the tilt) and **re-taken on every step that moves the frame**, because zooming out widens the frame and invalidates a tilt that was legal a notch ago ([the restriction this produced](../../../restrictions/architecture.md)) |
| **Zoom cap** | at the top-down limit the frame's half-span is `d·tan f`, so the widest honest view is `reach / tan f` of distance. Past it the picture has ground outside the ring at ANY tilt |
| **`reach`** | the world's own number, not the camera's: the LOD ring for a streamed world, its extent for the synthetic demo, nothing for plan mode (which draws no world and keeps the flat bounds) |
| **Zoom levels** | `block` = one render cell (`CELL_SIZE`, the grid the pak is welded on) · `district` = the baked zone box under the view (201/5-03's table) · `city` = everything the world has around the focus. A world with no zone table falls back to the GEOMETRIC mean of the other two, because zoom levels are logarithmic and a missing level should land between its neighbours. Keys `1` / `2` / `3`, widest to tightest |
| **`flyTo`** | Van Wijk & Nuij's path ([links](../../../links.md)), the one MapLibre's `flyTo` follows: the camera pulls up, crosses and settles, and **the duration is the path length in zoom space over a speed in screenfuls per second** — derived, not picked. ρ = 1.42 is the paper's own user-study value, not one we fitted |

**What is shown while the destination loads, which this step had to answer rather than discover:** the arc
zooms OUT for a long trip, so the crossing happens over far-LOD content that is already resident, and the
destination's cells begin streaming as the focus approaches rather than on arrival — the ring follows the
focus along the path. The frame never outruns the ring because the zoom cap above applies to the arc too:
the flight's own widest point is clamped by the same rule as a wheel turn. What an operator sees on arrival
is LOD geometry sharpening to HD, never a hole.

**Any input cancels a flight** — pan, orbit, dolly, pinch, a pose applied by the host. A camera that keeps
flying under the operator's hand is the bug every map application has shipped at least once.

**The bound NARROWS the operator's tilt, it does not overwrite it.** The camera keeps the tilt that was
asked for beside the one it is drawing with, and re-derives the second from the first whenever the frame
moves. Without that the rule is one-way and quietly expensive: zooming out tilts the view down, zooming back
in leaves it there, and a flight's own climb costs the operator their viewing angle for good. A drag still
measures from what is on SCREEN rather than from the older request, so dragging up out of a clamped view
fights the bound immediately instead of running through invisible slack.

**Owed by the next field run:** the flyTo duration against the time a destination district actually needs to
stream (the desk can state the rule and not the milliseconds), and the eye verdict on the clamp at city
height — the rule says the frame stays inside the ring, and only a screen says whether that is also a view a
dispatcher wants to work in.

### 03 — Getting somewhere

Four capabilities, one step because they share a mechanism (a target → a camera pose):

| Capability | Note |
| --- | --- |
| **Follow a unit** | the camera rides the selection. The streaming anchor moves with it — see the [restriction on a camera the streaming does not follow](../../../restrictions/architecture.md) |
| **View bookmarks** | named poses ("my sector"), saved per operator |
| **Fit bounds** | one key puts every active call and unit in frame |
| **Search by place** | `map.zon` / `info.zon` + GXT are already parsed; this is the consumer side of the layer decision in [5/03](../5-symbology-and-picking-as-product/readme.md) |

**Owes:** for follow — that streaming keeps up with a car at speed; for fit bounds — behaviour when the set
spans the whole state.

**DONE 2026-08-22 on the desk half; the streaming-at-speed verdict is owed by a device run.** All four share
the mechanism the step predicted — a target becomes a camera pose — and every one of them flies rather than
jumps, because [7/02](#02--where-the-camera-may-go) already built the path.

| Capability | How it works, and the number it is derived from |
| --- | --- |
| **Follow a unit** | the view rides the selection and the streaming anchor comes with it, because on this surface the anchor IS the focus. **The damper is re-based on the subject**, per [the restriction](../../../restrictions/architecture.md): the offset is read against where the unit stood LAST frame and written against where it stands now, so a unit at constant speed leaves the damper nothing to do instead of towing the camera at a fixed lag. Its time constant is **one publish interval over three** (`PUBLISH_INTERVAL_MS / 3`, PCAD's own 4 s) — 95 % of any gap closed before the next fix can land, so the view is at most one fix behind by construction |
| **View bookmarks** | named poses in `localStorage`, per operator and honestly scoped to *this browser* until the console is a module of the CAD app. Shape-checked on read, because a half-pose written by an older version does not read as corrupt data — it puts the operator somewhere nobody asked for. The store never throws: private mode, a locked profile and a full quota all fail on the plain call, and a console that will not boot for want of a bookmark is worse than one with none |
| **Fit bounds** | the box of every unit and every OPEN call, with **one render cell of air** around it — the smallest unit of world the pak is built from, so a set inside one cell still gets context instead of a view zoomed to a millimetre. A set wider than the world is capped by 7/02's zoom bound, which is the answer to *what happens when it spans the whole state*: the fit frames as much as there IS, rather than a picture of emptiness |
| **Search by place** | the consumer side of [5/03](../5-symbology-and-picking-as-product/readme.md)'s decision. The world's own baked district table is what gets searched, so a total conversion's places are the ones an operator finds and a world with no `info.zon` finds nothing rather than answering with stock San Andreas. Case- and accent-folded, prefix matches first, and **boxes of one name are unioned** — `info.zon` cuts a place into several, and flying to a third of Vinewood is not flying to Vinewood |

**Keys:** `f` fits the board, `c` rides the selected unit (again to stop), `Escape` stops a follow — and only
when one is running, because Escape belongs to the selection everywhere else. The cluster that carries the
same four things on screen is `ui/map-tools.tsx`, top-left, on the existing tokens.

**Two defects the review pass caught before this landed.** A flight did not end a follow, so a fit or a
bookmark left the ride writing the focus in the same frame as the flight — the flight won and the follow
fought it silently until something else cancelled it. And the degraded-map banner ran across the top of the
map, which is where the cluster now sits: in plan mode, the one mode where an operator has least else to work
with, it covered the search box. The banner is bottom-right now.

**What cancels a follow, and what does not:** a pan, a locate, a bookmark and an applied pose end it — they
are the operator saying where to look, which is the one thing a follow owns. Orbit, dolly and pinch do not:
turning and zooming while riding a car is not a change of subject.

**Owed by the next field run:** that the streamer keeps up with a car at speed (the ring moves with the
followed unit, and only a device says whether the cells arrive before the car does), and the eye verdict on
the follow damper at the real 4-second publish rate rather than the mock's 20 Hz.

### 04 — The minimap

An overview inset: where am I relative to the whole city. **Nothing like it exists anywhere in this repo** —
`docs/features/zones-hud-debug.md` lists "no minimap/radar" as a gap of the game HUD too, so whatever is
built here should be built where both can reach it.

Cheapest honest version: the [flat 2D map](../6-display-modes/readme.md) at its lowest zoom, plus a viewport
rectangle. That is one more consumer of a thing 6/02 already bakes, rather than a second renderer in a corner
of the screen.

**Owes:** its cost per frame, and its behaviour under [render-on-demand](../4-a-console-is-not-a-game/readme.md)
— an inset that redraws every frame defeats chain 4 entirely.

**DONE 2026-08-22, and it is ROUND** — the user's call, and the shape turned out to carry an argument. A
dispatch radar answers a distance question (*how far off is my nearest available unit*), and a circle is the
only frame in which a pixel of travel means the same thing in every direction; a rectangle answers it
differently along the diagonal than along the edge. It is also what San Andreas' own radar is.

**The step's own "cheapest honest version" was not available and a better one was.** It called for
[6/02](../6-display-modes/readme.md)'s flat-2D tiles at their lowest zoom — a bake that does not exist yet.
What the radar draws instead is the world's own description of itself: the **baked district boxes**
(5/03's table, now reachable as `DistrictLookup.boxes`), the board's units and calls, and the camera's
**ground footprint** — a new `MapCamera.groundFootprint(aspect)` that is a polygon rather than a rectangle,
because under perspective the frame's footprint IS a trapezoid and a rectangle would claim the view reaches
ground it does not. In the plan view the same four rays are parallel and it comes out a rectangle by itself.
A corner whose ray never meets the ground (a shallow tilt) is pulled back to the world's reach rather than
dropped — a footprint with two corners is not a shape.

North-up always: the world stays put and the footprint turns inside it, so one glance answers where the view
is and which way it faces. A tap on the dial flies there **keeping the current zoom** — "look over there",
not "zoom in on that".

**Owed and paid**: [the census](../../../benchmarks/opensa-engine/2026-08-22-dispatch-overlay-census.json) —
**914 canvas calls per repaint** at the declared worst case (150 units, 40 calls, a 160-box city), and
**zero for a frame where nothing moved**. That last number is the answer to chain 4: the layer returns before
touching the context unless the board ticked, the pose moved, the selection changed or the dial was resized,
so a still map costs 20 repaints a second instead of 60 and an idle one costs none. The static district
outline is 160 of those 914 calls, and caching it is priced in
[radar-outline-cache](../../../performance/deferred-optimizations/radar-outline-cache.md) rather than taken.
Milliseconds are [2/03](../2-real-device-truth/readme.md)'s. Not in plan mode, and why:
[edge-cases/dispatch-console](../../../edge-cases/dispatch-console.md).

### 05 — Measuring and drawing

- **Measure**: distance, radius, an ETA circle around a point.
- **Draw**: a perimeter, a cordon, a search area — annotations laid on the world that stay where they were
  put.

Both need geometry that follows the ground rather than floating over it — the same clamp-to-ground problem
the runtime-recoloured data layers have, and the one
[8/04's unit trails](../8-the-time-axis/readme.md) have. **Solve it once, in the engine, for all three.**

The technique to copy is Cesium's **classification / ground primitives** ([links](../../../links.md)): do not
tessellate the shape to the ground mesh — render a **volume** and classify the fragments it covers. The shape
then needs to know nothing about the terrain under it, which matters here because our ground is welded cell
geometry rather than a heightfield, and fitting a polygon to it would be a per-cell join problem of exactly
the kind [the world-glass idea](../../../ideas/world-glass-material/readme.md) is stuck on.

**Owes:** the ground-following rule (what a shape does over a bridge, a tunnel mouth, water), the cost of
carrying N annotations, and a statement of whether the classification pass fits the frame budget named in
[1/04](../1-the-map-profile/readme.md).

**DONE 2026-08-22 — and the classification pass was NOT taken, on an argument rather than on cost.** The
technique is right for a shape that has to look like it is *on* the road. It is wrong for the shape this
step is actually for: an operator's cordon has to be visible THROUGH the buildings it is drawn around, and a
draped cordon disappears behind the first block it crosses — the thing the dispatcher drew in order to see
is the thing they can then no longer see. So a sketch is symbology: world points projected onto the overlay
canvas with the frame's own view-projection, exactly like the unit chips, drawn last so nothing hides it.

**The ground-following rule, stated:** a sketch does not follow the ground and nothing occludes it. Over a
hill its line runs where the operator put it; over a tunnel it is drawn on the hill above. A distance is the
straight ground line between two points, never the drive — the vehicle path graph is `original`-only, so a
routed distance would be right on stock SA and a lie on every total conversion. All of it, plus why there is
no ETA circle (it needs a travel speed nobody has measured; a radius in minutes would be a constant chosen by
eye), is in [edge-cases/dispatch-console](../../../edge-cases/dispatch-console.md).

**Three tools, because three is what the job has**: a ruler (tap along a route), a circle (tap the centre,
then the edge — it finishes itself), and an area (tap the corners, then Finish) with its shoelace area. The
store is the MAP's, not React's and not the board's: it is view state read inside the frame loop, and a
re-render must not be able to lose it. Arming a tool takes the tap whole, so a cordon can be placed over a
unit without picking the unit up.

**It works in plan mode too**, deliberately: the no-GPU fallback IS a 2D map, so a ruler and a cordon are
what it is best at, and 7's verification asks every capability to work in every mode or say why not.

**Owed and paid**: [the census](../../../benchmarks/opensa-engine/2026-08-22-dispatch-overlay-census.json) —
**422 canvas calls for ten shapes of eight points, 42 a shape**, drawn every frame the overlay is drawn.
Milliseconds are [2/03](../2-real-device-truth/readme.md)'s.

### 06 — Keyboard

A base set — zoom levels, north, fit bounds, next call, Escape — **and remapping**, because the operator
decides what they repeat. In a real CAD this is half the product.

**Owes:** the default map written down where an operator can read it, and the remap stored per operator.

**DONE 2026-08-22.** Both halves, plus the on-screen controls that are the same commands for an operator who
has no keyboard at all — which on this surface is the phone, so they are not a nicety.

**The map is written down in ONE table** (`map/keymap.ts`) and everything reads it: the input layer resolves
events against it, the sheet prints it, the rebinder writes to it. A key handled inline where it happened to
be convenient — which is what 7/02 and 7/03 left behind, and this step swept up — is a key that exists
nowhere an operator can read, cannot be rebound, and collides silently with the next one somebody adds.

| | Default | Why there |
| --- | --- | --- |
| Pan | `W` `A` `S` `D`, arrows | under the hand that is not on the mouse |
| Turn | `Q` `E` | beside the pan keys, same hand |
| Tilt | `Shift`+`↑` / `↓` | one modifier rather than two more letters |
| Zoom | `+` `-` | what every map has had since the first tile server |
| Zoom levels | `1` `2` `3` | widest to tightest, left to right |
| North | `N` · Fit | `F` · Follow `C` | the first letter of what it does |
| Calls | `[` `]` | previous / next open call, in the queue's own order |
| Stop following | `Escape` | and ONLY that, since Escape belongs to the selection everywhere else |
| The sheet | `?` | where the whole table above is readable at runtime |

**Held is not pressed, and they cannot share a path.** Movement runs in the frame loop while the key is down,
because acting on the operating system's key REPEAT moves the map in the OS's stutter — a long first gap,
then a burst, at a rate the operator set for typing. Rates: pan is **screenfuls per second** (the frame's own
unit, so a key crosses the same share of the picture at every zoom), turn a quarter lap per second, tilt half
that, zoom a factor per second. Opposite keys cancel and a diagonal is normalised, so it is not faster than a
straight line.

**Rebinding is a press, not a text field** — click a row in the sheet, press the key. Asking an operator to
type `Shift+ArrowUp` is asking them to know how this repository spells things. Only what DIFFERS from the
defaults is stored, so a later change to the base map still reaches an operator who never touched that
command; and binding a key that is taken takes it from the other command rather than leaving two rows
claiming it.

**The on-screen controls** (`ui/map-nav.tsx`, top-right) are the same commands through the same handle: a
compass that says which way north is and puts it back, turn, tilt and zoom. The compass is the only thing on
screen that answers *which way am I facing* at all, and it is drawn from the readout — so it updates at the
readout's four times a second rather than on the frame path.

**Two defects the tests caught while they were being written.** A key released while the window is not
focused never sends `keyup`, so alt-tabbing mid-pan left the map panning by itself — the blur clears the held
set. And a modifier pressed IN THE MIDDLE of a hold changes what the release resolves to: hold `↑`, then
press Shift, and the release reads as `Shift+↑`, which is a different command — so `panNorth` stayed held with
no key down. A release now clears every command that key could have started, shifted or not.

**Owed by nobody:** this step is desk work end to end. What a field run adds is a verdict on the RATES, which
are the one thing here that is a claim about hands rather than about the world.

### 07 — Leaving the console

Three ways the map goes somewhere else:

- **A link to a view** — partly there already (`?at=`, `?h=`, `?pitch=`, `?yaw=`); make it complete and
  shareable, including the mode and the moment in time.
- **Embedding in another site (iframe)** — `boot.ts` already carries a `window.__opensaDispatch` escape hatch
  for opaque-origin hosts, which is the hard half; the rest is deciding what a hosted console may do.
- **Exporting the view** — an image of the situation for a report or a chat.

**Owes:** what an embedded console is allowed to do, stated rather than discovered, and an export that
includes the symbology (which lives on a second canvas — a naive `toDataURL` will capture the world without
the units).

**DONE 2026-08-22.** All three ways out, and the two things this step owed are answered rather than
discovered.

**A link to a view.** `map/view-link.ts` owns the parameter NAMES and both directions, which is the point: a
writer that builds a string and a reader somewhere else that parses it is how a share button produces a URL
that silently opens the default view. What it carries — the pose, **the projection** (7/01: the same pose is
a different picture in plan view), the world hour, and **how far behind live the shift clock was** (8/03: a
moment is part of a view once time is an axis). What it does NOT carry is the **selection**: an id from one
board means nothing on another, and once the feed is real a call id belongs to the CAD rather than to a URL.
Angles go out in degrees and the comma in `at=` stays a comma, because a human edits these by hand.

**What an embedded console may do** (`?embed=1`), stated:

| | |
| --- | --- |
| **Shows** | the map and its own controls — nav cluster, operator cluster, selection panel |
| **Never shows** | the queue, the roster, the shift timeline, the status bar. The host has its own board, and two boards disagreeing on one screen is worse than none |
| **Never writes** | the address bar. It is not its to write — which is also why `dispatchParams()` already reads `window.__opensaDispatch` for a host with an opaque origin |
| **Keeps** | the keyboard, the gestures and per-operator storage, because they belong to the person at the screen rather than to the page around them |
| **Reports out** | through the handle (picks, readout, view state) — the same seam the library entry (`embed.ts`) hands a host that mounts the map itself |

**The export composes both canvases, and that is the whole defect it exists to avoid.** A `toDataURL` of the
WebGPU canvas captures a city with no units on it — every unit, call, callsign and trail lives on the second
canvas — so an export that looked right would have been a screenshot of a video game sent into a report. The
capture also has to happen at the END of a frame, where the two layers are in step, so `exportImage()`
resolves on the next frame rather than immediately. A stamp goes under the picture (place, coordinates, eye
height, projection, time, pak build), because an image in a chat a week later answers *where* and *when* or
it answers nothing.

**Plan mode exports too**, composing its single canvas with itself and stamping `plan mode` — an image of a
GPU-less shift should say so on its face.

**A defect caught while wiring the moment into the link:** the shift clock runs on `performance.now()`, not
`Date.now()` (`ops/use-operations.ts`), and mixing the two puts a scrub decades off with nothing to show but
an empty board.

**Owed by nobody here.** What a field run adds is the phone verdict on the two share buttons — the clipboard
and the download both behave differently on Android's browsers, and neither can be checked from a desk.

### 08 — The workspace

**The map is the desk, and the lists are windows on it.** Taken with the user 2026-08-26, out of a survey of
every working console in this field.

**The finding that forced it.** SnailyCAD, SonoranCAD, Resgrid and CrowdCAD were captured and measured
rather than read about (2026-08-26), and **none of them makes the map its main screen**: SnailyCAD puts it
on a separate PAGE, SonoranCAD in a separate WINDOW of its own dock, Resgrid in a card measuring
**475x302 of 1665x947 — 9.1 % of the screen**, and CrowdCAD's Lite Mode has no map at all. A map-first
console therefore has no pattern to copy in its own category, and the desk layout this console shipped with
was the category's: a 300-px and a 264-px column either side of the map, **564 px of a 1280-px screen, 44 %,
spent on two lists that are read in glances**.

**The rule.**

1. The map holds the whole viewport at every width — `styles.app` is one column.
2. The queue and the roster are windows over it, moved and sized by the operator with a pointer or with the
   keyboard, remembered per browser under `STORAGE_KEYS.windows`.
3. **A window is always fully inside the map.** Not "part of it stays reachable": a panel hanging off the
   edge is a bug that looks like a feature, and at 360 px it is simply lost. Where the map is smaller than
   `MIN_WINDOW`, the map wins — a window may be squeezed, never pushed out.
4. The phone keeps the sheet under the map (3/01). A window that covers the map it floats over is not a
   smaller desk, it is a worse one.

**Three mechanics taken from the survey**, each from the console that does it best:

| Taken | From | Why |
| --- | --- | --- |
| the **status tally in the panel header** (`AVAILABLE 7 · EN ROUTE 2`) | SonoranCAD | one line is both the colour legend and the shift summary; it reads from `SET_COLORS`, so it cannot disagree with the map it explains. No other console in the field has it |
| the **callsign as a filled pill**, coloured by status | SonoranCAD | the one field in a row that never truncates, so at 360 px it is the only place the status is guaranteed readable. The row's left rail says it a second time for anyone who cannot separate the hues |
| **windows rather than a split** | CrowdCAD, inverted | its panes resize (`react-resizable-panels`, a 25/75 splitter) but do not move, and a splitter still divides the map's space instead of floating over it |

**And one rejected on evidence:** SonoranCAD's light theme fills the whole ROW with the status colour, and
the text contrast fails exactly where the row matters most. Colour goes on the rail and the pill.

**No library.** `react-rnd` and `react-draggable` would be this package's first runtime dependencies, in
something that ships as an embeddable widget (`vite.lib.config.ts`, `embed.ts`) with none, and their touch
handling is an afterthought on a console whose primary device is a phone. GridStack is worse than
irrelevant: it is a GRID, tiles snap to columns and reflow, which takes space from the map in exactly the
way this step exists to stop. Pointer Events cover mouse, pen and touch in one handler; the geometry is
`ui/window-frame.ts` (pure, tested) and the gesture is `ui/panel-window.tsx`.

**Owes:** the phone verdict on the two touch targets that only exist here — the title bar as a drag handle
and the 44-px corner grip — which cannot be checked from a desk.

### 09 — Skins

**Four operator-selectable themes, and a guard that makes them cheaper than SonoranCAD's four.** Asked for
by the user 2026-08-26 ("разные стили как у SonoranCAD").

**What SonoranCAD does, and what it costs them.** Four hand-written skins over one fixed screen — `modern`,
`spillboy`, `trevor`, `mike19`, captured 2026-08-26. The idea is right: the console belongs to the operator
and a server owner wants it to be theirs. The execution is four times the surface on which contrast can
break, with nothing checking it, and it has broken: `trevor` fills a whole row with the status colour and
lands grey text on a mid-blue fill, so the row that matters most is the one that stops being readable.

**A theme here is DATA, not a fork.** It carries the neutral ramp, the accent, the two semantic surfaces,
the shadows, a font stack and one density lever — nothing else. Every value is emitted as a CSS custom
property under `[data-theme='…']`, so switching a skin is **one attribute on the app root**: no re-render, no
new style objects, no reconciliation. That is why colour left the TypeScript table, and it is what makes
four skins cost about as much as one.

**What a theme may not touch**, and each has a reason rather than a preference:

| Off limits | Why |
| --- | --- |
| `map/beacons.ts` → `SET_COLORS` | the engine draws pillars from it, and the lists, radar, labels and header tallies read the same table so a chip cannot drift from a pin. A theme that repainted statuses would break the one agreement that table exists to keep |
| `TOUCH_TARGET` | 44 px is WCAG 2.5.5 / HIG / Material, not taste |
| the layout and the dock | SonoranCAD moves its dock between skins (top in `spillboy`, bottom in `modern`), which breaks muscle memory on a theme change |

**The guard is the point of the step.** `theme.test.ts` runs every preset through **APCA** — the measure
DESIGN.md already declares, because WCAG 2.x is symmetric and gets the light-on-dark polarity wrong — and
fails the build under **Lc 90 for primary text, Lc 60 for secondary**, across all five surfaces each is set
on, plus the accent and danger pairs.

**And it immediately found a defect in the SHIPPED theme.** Night's secondary text (`#8fa1b6`) measured
**Lc 47–50** against the Lc 60 DESIGN.md had claimed since 2026-08-25 — the target was written down and
never measured. Corrected to `#a8bbd0` (Lc 61 on the worst surface it sits on). Three more were corrected
the same way: the danger readout in Night (Lc 38 → 61), in Contrast (49 → 64) and in Amber (50 → 65), and
Day's selected row could not reach Lc 90 for primary text until step 5 was lightened.

A second guard reads the components themselves for raw hex, because a colour written into a component has
opted out of the theme — it renders, it lints, and it stays dark-blue-on-white the moment Day is chosen.
Two were found in this change (`#0e3a52` on the region badge, `#7d8ea1` on a hint line).

**The four:**

| Skin | For | Not cosmetic because |
| --- | --- | --- |
| **Night** (default) | the shift | the palette the console shipped with, now measured |
| **Day** | a phone outdoors | the one condition a dark console genuinely cannot serve. Built in its own direction rather than inverted — in the dark each layer is one step lighter, in the light one step darker, and inverting breaks Carbon's rule |
| **Contrast** | a bad screen, bright sun, tired eyes | pure black ground, pure white text, mid steps pushed apart so a border is visible rather than implied |
| **Amber** | the identity slot | warm near-black, monospace chrome, rows two pixels tighter — the same lever `mike19` pulls |

**Deliberately NOT shipped: a colour-vision-safe STATUS palette.** Unit and call colours are red / amber /
green, the worst triple for deuteranopia (~8 % of men). It is wanted and it is not a theme: those colours
are the engine's, built into a debug-line set per key at boot, so repainting them means rebuilding those
sets rather than writing a variable. It needs an engine hook, it belongs with the symbology
([5](../5-symbology-and-picking-as-product/readme.md)), and it has to swap the whole table at once so the
map and the lists move together. Filed rather than half-done.

**Owes:** the phone verdict on the switcher (a native `<select>`, which opens the OS picker), and a reading
of Day against real daylight on a real screen — the condition it exists for is the one a desk cannot
reproduce.

### 10 — Skins from the field: Mark43 and Tickets CAD

**PLANNED 2026-08-28.** Asked by the user: evaluate the Mark43 and Tickets CAD screens as skins we intend to
ship, and state the architecture that carries them. [09](#09--skins) built the mechanism; this step is the
first attempt to point it at two REAL products rather than at four palettes of our own, and the interesting
part is not the colours — it is discovering which parts of a screenshot a theme structurally cannot carry.

#### What was captured, and what was not

The landscape rows of 2026-08-26 rest on captured screens, and this step keeps that bar. It does not clear
it twice:

| Product | Evidence | Quality |
| --- | --- | --- |
| **Mark43 CAD** | the vendor's own one-pager (`mark43.com/wp-content/uploads/Mark43CAD.pdf`, fetched 2026-08-28). Page 2 embeds a **1071 x 549 product screenshot**, pulled out with `pdfimages` and sampled with a histogram plus point probes | **measured**, with one caveat stated below |
| **Tickets CAD** (Open ISES) | both lines were stood up and measured locally on 2026-08-29: the 2.41 dev-repo build first (the wrong version, kept below for what it shows about hand-written skins), then **v4.2.26 NewUI** from the live repo — `github.com/openises/TicketsCAD`, which the legacy 3.44 codebase names in its own README and release check | **measured, current version** |

**The caveat on the Mark43 numbers.** The screenshot is a downscaled JPEG inside a marketing PDF. Flat
regions survive that (a panel fill is still its own colour); 1 px separators, small text and pill edges are
blended with their neighbours. So the ramp below is good to roughly +/-2 per channel, the hue COUNT is
sound, and the type sizes and row heights are **not** measurable from it — they are not quoted.

**And the consequence for Tickets CAD is the whole verdict on it.** A preset built from a page that says
"modern dark theme" is not a skin taken from a product; it is our own taste wearing somebody else's name.
It does not get built here — and the local run below, which reached the classic UI rather than the v4 one
the page is describing, does not change that: measuring the wrong version is not evidence about the right
one.

#### Mark43, measured

| What | Measured off the screen | Against Night |
| --- | --- | --- |
| ground | `#1e1f21`, **18.9 %** of all pixels | Night `#070a0f` — Mark43 sits several steps lighter |
| bars, panel headers, column headers | `#28292b` | Night `#0b111a` |
| grid rows | `#1d1e20` / `#1c1d1f` | Night `#111a26` |
| separators | `#333333`–`#343436` | Night `#222f40` / `#2b3a4d` |
| the map panel | a grey Esri canvas, `#303231` | ours is a rendered world with a day cycle |
| hue | **achromatic** — R, G and B within 2 of each other on every step | Night is cool slate at hue ~213 |
| depth | **a line, not a value.** Ground to surface is ~10/255, and there is **no shadow anywhere** | ours is Carbon's layering + `shadow.float` |
| shape | square. Zero radius, zero translucency, no gradient, no ornament | the same, since 2026-08-26 |
| state colour | **>= 11 saturated hues** (15-degree buckets over the whole screen: `#5d9be5` blue, `#6124a3` purple, `#9d0f28` crimson, `#49c9ac` teal, `#378fa3` cyan, `#af8328` amber, `#c9272d` red, `#a9722d` orange, `#aa9f12` olive, ...) on filled callsign pills, plus a red priority cell | ours is `SET_COLORS`, and it is not a theme's to touch |
| the map | a corner panel, roughly **630 x 250 of 1071 x 549 = 27 %** of the screen, under a command line | ours is the desk (7-08) |

**Two findings worth more than the palette.**

**1. The best-designed CAD in the field is square, opaque, borderless-dark and ornament-free.** That is the
direction this console was corrected back to on 2026-08-26 on the user's verdict that the built screen
looked generated. It was argued there from first principles; here it is a vendor whose own marketing calls
the product "the best-designed CAD available", arriving at the same place independently. The direction is
not ours to second-guess any more.

**2. Even Mark43 does not make the map the desk.** 27 % of the screen, third in the reading order behind two
data grids. That is a **fourth** data point for [7-08](#08--the-workspace)'s measurement (SnailyCAD another
page, SonoranCAD another window, Resgrid 9.1 % of the screen, CrowdCAD not at all) and the most
authoritative one, because this is the product real dispatchers work a shift in. Our decision stands
against it deliberately, and it stays the thing that distinguishes the product — but nobody may now claim it
is the obvious layout.

**And one thing that is not a skin at all.** Their command line (`TS P309C @COORS/PASEO DEL NORTE@`, set
large in mono over a ghosted syntax hint: `units #event @location@ /comment "plate"`) is the most
interesting control on the screen and it is an INPUT MODEL, not an appearance: a keyboard-first command
grammar for a telecommunicator who types faster than they point. It belongs beside [7-06](#06--keyboard),
it is a phone question before it is a desk one, and it is filed here rather than smuggled into a palette.

#### The verdict

- **Mark43 -> a preset, and it is worth building.** It is this console's own direction with a different ramp
  (achromatic, lighter ground) and a different depth strategy (a line where we use a value step and a
  shadow). Both differences are real work, and one of them the theme contract cannot express today.
- **Tickets CAD -> not a preset**, confirmed by running it (below): its own Night skin measures **Lc 0** on a
  live control, so the palette is not a thing to borrow. It is a landscape row, one still-owed capture of the
  version its page describes, and two architecture signals:
  **light and dark as a first-class instant toggle**, both declared "for extended use in dispatch
  environments" — a stronger reason to keep Day measured than the one we wrote (a phone outdoors) — and a
  **drag-and-drop widget dashboard** (incidents, responders, map, statistics, facilities, communications,
  recent events), which is Resgrid's BigBoard pattern for the third time. 7-08 rejected it with an argument
  and the argument has not changed: a grid whose tiles reflow takes back the space that decision won.

#### What the Tickets CAD run actually showed (2026-08-29)

**How it was run**, so nobody pays for it twice: the `khoegenauer/tickets-cad` dev repo (master is **2.41**, 2013)
against a local MariaDB, served by PHP 8.4 with a throwaway `ext/mysql` -> mysqli shim, because the app calls
the removed `mysql_*` API in 246 files. Five upstream defects had to be patched to reach a screen at all — a
missing paren in `install.php` (a hard parse error in any PHP), `is_resource()` on what is now a
`mysqli_result` (the login silently reports "expired"), `count($x == 0)` where `count($x) == 0` was meant, a
`break` outside any switch in `units.php` and `units_nm.php`, and a PHP-5 numeric coercion on an empty
setting. None of that is a judgement on the product; it is the cost of running a 2013 PHP application, and it
is written down only so the next attempt starts from the answer.

**The mechanism, and it is the one this chain already chose.** The skin is picked on the **login form** —
`Colors: Day / Night`, held for the session — and switching it changes colour and nothing else: same layout,
same controls, same positions. 7-09 wrote that rule from first principles; here is a working CAD that has
obeyed it for a decade.

**The warning, measured with this console's own APCA implementation** (`ui/theme.test.ts`'s formula, run in
the page against every text-on-background pair actually rendered):

| Night, on the screens a dispatcher works | Measured |
| --- | --- |
| the Call Board's `Show` control | `#000` on the `#121212` ground — **Lc 0. Invisible, not merely poor** |
| every unit row's data (callsign, status, "as of") | 10 px `#000` on `#9e9e9e` — **Lc 52** |
| the board's column-group headers (Incident / Units / Dispatch) | white on `#99b2cc` — **Lc 48** |
| the status chip | `#000` on `#ff3c4a` — **Lc 43** |

Against our thresholds (Lc 90 primary, Lc 60 secondary) the whole Night skin fails, and one live control is
at zero. **This is the exact failure 7-09's guard exists for**, found for the second time in the field after
SonoranCAD's `trevor`: a second palette is a second surface on which contrast breaks silently, and nobody
who ships one by hand measures it. Two hand-written skins, two failures, both invisible to the people who
shipped them — the guard is not paranoia.

**Density**: 14 px rows, 10 px data text, Verdana 12 px base; Day is `#efefef` ground with `#ffffff` and
`#dee3e7` surfaces. At 360 CSS px the tables fit, and every control in them is far under the 44 px
criterion — which is what a desk product looks like on a phone, and why the density lever above is clamped
by the pointer rather than by the preset.

**One thing they do that we deliberately do not**: status colour is **agency-editable data** —
`un_status.bg_color` / `text_color` per status row, `in_types.color` / `opacity` / `radius` per incident
type, all edited in Config by the customer. It is the right answer for a product whose map is a Google
basemap with pins drawn over it. It is the wrong answer here, and the reason is the one 7-09 already gives:
our chips must equal the pillars the ENGINE draws from `SET_COLORS`, so a per-agency colour table would have
to move the engine's debug-line sets with it. Filed as the shape a colour-vision-safe palette would take
(201/5), not as a theme.

#### And then the CURRENT one: v4.2.26 NewUI (2026-08-29)

**Where it actually lives**, because finding it cost two wrong turns: SourceForge ships only the legacy line
(`tickets-3.44.1.zip`, 2026-03-23 — behind Cloudflare, though its mirror hosts `<name>.dl.sourceforge.net`
serve the file directly). The legacy 3.44 code checks GitHub for its own releases, and that string is the
signpost: **`github.com/openises/tickets` is the legacy line, `github.com/openises/TicketsCAD` is v4**.
Stood up with the project's own procedure — `composer install`, `tools/install_fresh.php`,
`tools/create_admin.php`, on PHP 8.4 + MariaDB — and it installs clean: **55 migrations applied, 0 failed**,
no patching of any kind. A decade of distance from the 2.41 build, in one command.

| What | Measured |
| --- | --- |
| palette | **Bootstrap 5.** Day ground `#e9ecef`, text `#212529`; Night `#1a1d21`, text `#dee2e6` |
| type | `system-ui` at **16 px** base (the legacy line was Verdana 12) |
| density | **28 px** table rows — twice the legacy 14 |
| contrast, Night | **52 of 184** rendered text pairs under Lc 60; the floor is Bootstrap's `text-muted` `#6c757d` at 9.6 px on the dark panels, **Lc 20–26** |
| targets | the top bar's icon buttons are **23–27 px**, against 44 |
| the map | **Leaflet on OSM in Day, a CARTO dark basemap in Night** |

**Three findings, and only one of them is about colour.**

**1. The theme toggles in the CHROME, not only at sign-in.** A sun/moon pair sits in the top bar beside the
clock, and the login form keeps its `Day / Night` choice as a hidden field. Ours is sign-in-equivalent — a
`<select>` in the top bar — so the mechanism matches, but it settles a question the switchability section
leaves open: **an operator changes skin mid-shift**, which is the argument for reading `prefers-color-scheme`
at first run and for keeping the switch one attribute rather than a reload.

**2. Their map follows the skin, and ours structurally cannot.** Swapping OSM for a CARTO dark basemap is a
tile-style change — the map is a picture served by somebody else, so a theme reaches it. Our map is a
rendered world on a clock: the same request is an ENGINE question (the environment driver,
[6](../6-display-modes/readme.md)), never a token. That is the sharpest available statement of why layer 5
below is not a theme's, and it is the answer to keep for the day someone asks for "a dark map to match the
dark UI".

**3. A GridStack widget dashboard — the fourth sighting.** Resgrid's BigBoard, CrowdCAD's panes, their own
v3 situation panels, and now v4's draggable widget grid. [7-08](#08--the-workspace) rejected the pattern
because a grid whose tiles reflow takes back the space the map-first decision won; four products later the
argument is unchanged, and the field's agreement is not evidence against it — every one of those four also
puts the map in a card.

**What it does NOT change: still no preset.** Bootstrap 5's defaults are not an identity to borrow, and its
own dark theme leaves a quarter of its rendered text under our secondary threshold — the `text-muted` grey
that ships with the framework, at 9.6 px, on panels it was never measured against. Which is the lesson the
legacy skin taught at Lc 0, one framework and thirteen years later: **a guard is what makes a second palette
cheap, and nobody who ships one by hand has one.**

#### The three, side by side — and this console (2026-08-29)

All four columns are MEASURED, three of them in a browser against a running install, the fourth read from
this repo's own tokens. SnailyCAD v1.80.2 was built and run the same day (pnpm + Postgres; its client
refuses `localhost` in production mode, so it runs on the host's IP, and `next/font` cannot fetch Google
Fonts behind this egress — one import was pointed at a local face to build).

| | **Mark43** (real CAD) | **Tickets CAD 4.2.26** | **SnailyCAD 1.80.2** | **this console (Night)** |
| --- | --- | --- | --- | --- |
| ground | `#1e1f21`, achromatic | `#1a1d21` dark / `#e9ecef` light | `#16151a` | `#070a0f` |
| surfaces | `#28292b` | Bootstrap 5 panels | cards `#1f1e26`, radius **6 px** | `#0b111a`, radius **0** |
| type | not quotable from the capture | `system-ui` 16 px | **`Assistant`, a self-hosted webfont**, 16 px | system stack, 12 px |
| rows | ~20 px (read off the screen) | 28 px | card-per-item, no table rows | 22–24 px (`5px 9px` + 12 px) |
| contrast | not measurable from a JPEG | **52 of 184** pairs under Lc 60 | **0 of 35** under Lc 60 (an empty board — a small sample) | **guaranteed** by `theme.test.ts` at Lc 90 / 60 |
| smallest target | — | 23–27 px | 25 px | **44 px**, guarded by `styles.test.ts` |
| the map | a corner panel, **27 %** | Leaflet, and the basemap follows the skin | **not on the dispatch page at all** — a separate page that will not open until you name a separate **map server** | the map IS the desk |
| skin switch | one skin | login form **and** a top-bar toggle | `darkMode: ["class", '[data-theme="dark"]']` — ours exactly | one attribute on the app root |
| where the skin lives | — | session | **the ACCOUNT** (`user.isDarkTheme`) | the browser (`localStorage`) |
| status colour | ≥ 11 saturated hues | agency-editable data | per-status config | `SET_COLORS`, shared with the engine |
| the phone | — | a separate **mobile view** (`mobile.php`), offered by a link in the navbar | **responsive, not touch-sized**: no overflow at 360 and a hamburger under its own `nav: 900px` breakpoint, but **22 of 25** targets on `/dispatch` are under 44 px (the hamburger itself is 28 × 18), no `matchMedia`/pointer test anywhere in the client, and no PWA manifest | ONE component that takes a size; 44 px in both axes where the pointer is coarse, guarded by `styles.test.ts` |

**A fourth thing, measured on a phone profile after the fact:** *responsive* and *usable with a thumb* are
different claims, and only the second one is a rule. SnailyCAD is genuinely responsive — nothing overflows
360 CSS px on `/dispatch`, `/officer` or `/citizen`, the nav collapses, the columns stack — and it is still
not a phone product: the client contains no pointer test at all, so every control keeps its desk size (22 of
25 under 44 px, the menu button 28 × 18). Tickets CAD answers the same question by shipping a **separate
mobile view** rather than sizing the one it has. Both are the shape
[cross-platform-surface](../../../restrictions/cross-platform-surface.md) exists to refuse: a second surface
drifts, and a responsive-but-desk-sized one looks finished in a screenshot and fails in a hand.

**A fifth product, run the same day: CrowdCAD 1.4.0** (AGPL-3.0, Next.js + HeroUI/Radix), stood up on its
**PocketBase** backend rather than Firebase — a single Go binary, no cloud account, which is the most
self-hostable thing in this survey. Measured on its Lite dispatch board: `#0c0c0d` ground, `ui-sans-serif`
16 px, heavy rounding, **1 of 20 text pairs under Lc 60** (a 14 px `0%` label) — and **13 of 13 targets under
44 px**, the icon buttons 32 × 32. **Its dispatch board has no map either** (teams with a status tally and a
surge meter on the left, calls in a table on the right; the venue map is elsewhere), which makes five
products and five times the map is somewhere other than the desk.

**Two more from the roleplay end, run 2026-08-29, and both are worth one line each.**
**[free-the-cad](https://github.com/CardosoDev04/free-the-cad)** is the only other project that names
**SA-MP** — and it is a skeleton, which is stated here from a probe of every route its own router declares
rather than from a glance:

| route | what renders | interactive controls |
| --- | --- | --- |
| `/` | the footer, nothing else | 0 |
| `/dashboard` | the footer, nothing else | 0 |
| `/dashboard/civ` | the literal string `CivDashboardLayout` | 0 |
| `/auth` | redirects to `/auth/login` | 3 |
| `/auth/login` | a real sign-in card | 3 |
| `/auth/signup` | a real sign-up card | 4 |
| `/nope` (unrouted) | blank — there is no 404 | 0 |

Two screens exist; everything behind the login is a placeholder. No backend in the repository, no SA-MP code
anywhere outside the README title, and no commit since **2024-12-26**.
**[StoicCAD](https://github.com/TheStoicBear/StoicCAD)** (PHP/MySQL, last commit 2024-05-06) runs, and its
schema depends on a table the dump does not contain (`nd_characters`, from the FiveM framework ND_Core) —
the CAD is an attachment to a game server's own database rather than a system with its own model. Its whole
chrome comes from **CDN Tailwind 2.0.3 + FontAwesome**, so with no CDN it renders as unstyled HTML; and its
**Map page is an `<iframe>` to a hardcoded third-party URL** (`shawn1-wxg9gm.users.cfx.re/webmap/` — one
person's own server), which every install embeds.

**The paid half, read from public pages 2026-08-29 — and the finding is about the SOURCES, not the
products.** Eight vendor pages were captured (Motorola PremierOne, Hexagon HxGN OnCall, CentralSquare,
RapidDeploy, and the roleplay sellers CDE CAD, Blue Horizon, PulseCAD, CADvanced). **The enterprise vendors
do not publish their interface**: their product pages are photography of dispatch rooms — blurred consoles,
a telecommunicator in a headset — with no screen a reader can measure. `rapiddeploy.com` now redirects into
Motorola's site, which is the acquisition showing up as a 301 rather than as a page. Of the roleplay
sellers, CDE CAD is pre-launch (a waitlist and a hero), Blue Horizon shows one small window of a dense dark
CAD with a module rail and a table, and the rest are JS-gated.

**So the method that worked for Mark43 is the method to repeat: the vendor's own PDF.** A datasheet embeds a
real screen at real resolution, and `pdfimages` gets it out — that is where every measured number in the
Mark43 row came from. A marketing page is staged, composited and unmeasurable, and quoting one as if it
were a screen would put invented numbers next to measured ones. None of these eight is quoted here.

#### The one paid product that opened — and it opened by its other half

**CDE CAD, 2026-08-29: the site is a waitlist, the game client is public, and the client is the interesting
half.** [`JonathaF0/cdecad`](https://github.com/JonathaF0/cdecad) is the FiveM resource a customer installs on
their own server; the CAD it talks to is the paid product and stays closed. The resource ships against
**`CDE-CAD SYSTEM v2.4.1`**, so *pre-launch* above is the marketing site's state rather than the product's.
What it exposes is not screens — it is **the seam**, which is the half this project is actually building
against:

| What the public half shows | Read from |
| --- | --- |
| **The in-game tablet is a browser window.** Its whole body is one sandboxed `<iframe>` pointed at the hosted CAD — `Config.TabletURL = "https://cdecad.com/login2"` | `config.lua`, `html/index.html` |
| Chrome around it: a dark header reading `CDECAD`, a close x, rounded corners, a drag surface and a resize grip | `html/` |
| **1344 x 918 at a 1920 x 1080 viewport — 70 % of the width, 85 % of the height** | measured by rendering the shipped `html/` locally |
| It did **not** frame: `cdecad.com` refused to render inside the iframe in this capture. Standalone the same URL is a real screen — "Tablet Login / Emergency Response Management System", a Discord username and password, a *Use Desktop Login* link, a Connected indicator and a clock | rendered directly |
| The other NUI surfaces are one small page each: a driver-licence card, a biometric result with a MATCH percentage, an ALPR reader, a radar, duty, panic, 911 | `civ/`, `fingerprint/`, `reader/`, `wraith/`, `duty/`, `panic/`, `911/` |
| **No map anywhere in the client.** It only *publishes* — `Config.LocationTracking`, off by default, `Interval = 10000`, `MinDistance = 50.0` — and polls calls every 10 s | `config.lua` |

**Two things this settles, and neither of them changes a decision in this step.** First, **the tablet is our
shape, built by somebody selling it**: a web CAD rendered inside a game client at ~70 % of the screen is
exactly the embedding [7-08](#08--the-workspace) assumes, and it is the argument for the console being a page
a host hands a SIZE to rather than an application that owns a window. Second, **a product that iframes its own
hosted CAD inherits that host's framing headers** — the one thing that stopped this capture — so an embeddable
console has to be explicit about being framed instead of leaving it to a default, and the day a deployment
puts the console and its CAD on different origins that same wall is there. **CDE CAD is not an eighth line in
the count below**, because the half that would hold a map is the hosted CAD nobody outside its customers can
see; what its public half shows is where the map is *not* — not in the game client, which knows only how to
send a position.

**Seven products now, and seven times the map is not the desk**: a corner panel (Mark43), a widget
(Tickets), a separate page and server (SnailyCAD), a card (Resgrid), absent from the board (CrowdCAD), an
iframe to someone else's site (StoicCAD), and non-existent (free-the-cad).

**The two that could not be run, and why that is stated rather than skipped:** **Resgrid** is .NET with a
SQL Server / Redis / RabbitMQ stack and a Docker-compose deployment, and this session has no Docker daemon —
its numbers stay as the 2026-08-26 screenshot measurement (the map at 9.1 % of the screen). **SonoranCAD**
is closed SaaS: there is nothing to install, and its four skins and 3D live map remain readable only from
its own public pages. Both rows in [DESIGN.md](../../../../apps/dispatch/DESIGN.md) say which evidence they
rest on, and neither is quoted as if it had been measured here.

**What the comparison actually settles, beyond confirming what we already do:**

**1. Nobody's map is the desk — and the strongest case is SnailyCAD's**, whose dispatch screen has no map on
it at all and whose live map is a different server you must configure before the page will render. Four
products, four times the map is somewhere else. [7-08](#08--the-workspace)'s decision is now the only one of
its kind in the field, which is either the product's edge or its risk, and it should be stated as the former
only while the phone measurement holds.

**2. A skin can live in three places, and we picked the weakest one.** Tickets CAD keeps it in the session,
SnailyCAD on the **account**, ours in `localStorage`. Account-stored follows the operator to a second
machine and to a borrowed phone; browser-stored does not, and it is also the path that carries a desk-chosen
density onto a phone (the [restriction](../../../restrictions/cross-platform-surface.md) this step added).
The console has no account of its own — it is embeddable and the CAD owns identity — so the honest design is:
**the host may supply the preset id with the board, and `localStorage` is the fallback when it does not.**
That is one more line in the switchability list above, and it is the one a real deployment will ask for
first.

**3. The one product that passes our thresholds is the one built on a component library.** SnailyCAD's
sampled dark screen has no pair under Lc 60 — on React Aria primitives with Tailwind's own scale, chosen
rather than hand-mixed. It is also the product whose shape (rounded cards, a webfont, 16 px type) this
console deliberately rejects. Both can be true: **borrow the discipline, not the look** — which is exactly
what our own guard does, and why 7-09's APCA test is the part of this chain worth defending hardest.

#### What a screen holds, and which layer a theme can carry

This is the architecture answer, and it is why "a screenshot becomes a theme" is only two-thirds true. A
console screen is five separable layers:

| Layer | Example, from the two screens | Carried by a theme today? |
| --- | --- | --- |
| **1. Palette** — ramp, accent, semantic surfaces, shadows | Mark43's achromatic `#1e1f21` ground | **yes**, wholly. `ConsoleTheme` + `themeVariables` |
| **2. Typeface** — the sans and mono stacks | Amber already switches the chrome to mono | **yes** (`font.sans` / `font.mono`); the SIZE steps are not — `TEXT` is a module constant in `styles.ts` |
| **3. Density** — row padding, control height, type step | Mark43's grid is far tighter than our desk rows | **one lever only** (`rowPadding`). Everything else is fixed |
| **4. Shape and edge** — radius, border-vs-shadow, opacity | Mark43 separates by a `#333` line and casts no shadow | **no.** `RADIUS` is a constant, and *whether* an edge is drawn is written into the style objects |
| **5. Layout and information architecture** — where the map is, where the dock is, whether there is a command line | Mark43's map at 27 %; Tickets CAD's widget grid | **no, and deliberately never** (09, 7-08) |

So the honest shape of the work: **layers 1-3 are a preset, layer 4 is a bounded extension to the token
contract, and layer 5 is a different product.** A skin that lands 1-4 will read unmistakably as Mark43 and
still be this console — which is the correct outcome and worth saying out loud, because the naive read of
"implement their screen" is layer 5, and layer 5 is where a skin stops being a skin.

#### The token contract, extended — two additions and nothing else

Both additions keep 09's shape: **data, emitted as custom properties, guarded by a test.**

**1. `shape` — the edge strategy.** Mark43 cannot be expressed by colours alone: its surfaces are separated
by a visible line and cast nothing, ours are separated by a value step and a shadow. Add to `ConsoleTheme`:

```ts
readonly shape: {
  /** How a surface is told apart from what is under it. */
  readonly edge: 'line' | 'shadow';
  readonly radius: { readonly control: number; readonly pill: number; readonly surface: number };
};
```

emitted as `--os-radius-control` / `--os-radius-pill` / `--os-radius-surface` and `--os-edge-width`
(`edge: 'line'` sets 1 px and drops `--os-shadow-float` to `none`; `edge: 'shadow'` does the reverse). The
style objects then read both from variables instead of from `RADIUS`, and the existing raw-value guard in
`theme.test.ts` grows a second half: **a component that writes its own radius or its own shadow has opted
out of the theme**, exactly as a component writing its own hex does.

**As built, that second half lives in `styles.test.ts` rather than in `theme.test.ts`, and the reason is
where the defect actually was.** `theme.test.ts` reads the `.tsx` files, and they were already clean; what
kept its own corner was the token TABLE — `keyHelpRow` at 4 px, both `mapToolsHit` variants at 3 px, off the
radius scale as well as out of the theme, so under Mark43's `radius: 0` three controls stayed rounded while
every neighbour went square. The guard therefore sits beside the table it polices and refuses any
`borderRadius` in `styles.ts` that is neither a `--os-radius-*` variable nor **`50%`**, the one deliberate
exception: the compass, the minimap ([04](#04--the-minimap), round on the user's call) and the tally dot are
MARKS whose roundness carries an argument rather than a preference. The shadow half needs no rule of its own
— the three elevations already read `SHADOW.float` / `SHADOW.modal`, and the fourth `boxShadow` in the table
is an INSET ring coloured from the accent, which is not elevation and is reachable by a skin.

**2. `density` — a bounded enum, clamped by the pointer.** `rowPadding` alone cannot reach a Mark43 grid,
because the row's height is padding **plus** its type step. So:

```ts
readonly density: 'comfortable' | 'compact' | 'dense';
```

which scales `rowPadding` and the two row-level type steps (`caption`, `body`) and nothing else — never
`TOUCH_TARGET`, never `input` (15 px is the iOS-zoom floor), never the title.

**And the clamp is the point, not a nicety:** `dense` is refused where `useCoarsePointer()` is true, in the
resolver rather than in a review. A dense preset chosen on a desk and carried onto a phone is a silent
[cross-platform-surface](../../../restrictions/cross-platform-surface.md) violation of exactly the kind that
file exists for — it typechecks, it lints, every test stays green, and it looks perfect on the machine that
chose it. Clamping it in the resolver makes the violation unrepresentable instead of reviewable, and the
guard is a unit test asserting that every preset, resolved at a coarse pointer, still yields a row that
clears the criterion.

**What is refused, and why each one is not a preference:**

| Refused | Where it actually lives | Why not a theme |
| --- | --- | --- |
| Mark43's 11 status hues | `map/beacons.ts` -> `SET_COLORS` | the engine builds a debug-line set per key at boot; the lists, radar, labels and tallies read the same table. A theme that repainted statuses would break the one agreement that table exists to keep — and 11 hues fails the "readable by more than colour alone" rule the queue already meets in three channels |
| the map's own look (their flat grey basemap) | the environment driver and [6](../6-display-modes/readme.md) | a CSS variable cannot reach the world. Our map is rendered, weathered and on a clock; a grey basemap is a DISPLAY MODE, not a skin, and asking a theme for it is asking the chrome to repaint the subject |
| the corner map, the widget grid, a moved dock | 7-08, and 09's own rule | muscle memory. SonoranCAD moves its dock between skins; we do not copy it |
| target sizes | `TOUCH_TARGET` | WCAG 2.5.5 / HIG / Material, not taste |
| the command line | a step of its own, beside [7-06](#06--keyboard) | it is an input grammar; painting it would be cosplay |

#### Switchability, as it stands and as it needs to be

**What it costs today, from the code rather than from memory:** every preset's variables are emitted once
into the single scoped stylesheet (`ui/global-css.ts`), one `[data-opensa-dispatch][data-theme='<id>']`
block each, plus the default block unqualified so an unset attribute still paints the shipping theme.
`app.tsx` holds the id in state only so the switcher can read it back, writes it as `data-theme` on the app
root, and persists it under `STORAGE_KEYS.theme`. **Switching is one attribute write**: no re-render, no new
style objects, no reconciliation, and the cost of an extra preset is bundle bytes, not frame time.

Three gaps, and each is a product requirement rather than polish:

1. **The first run ignores the operator's own machine.** Night is the default whatever the OS says. A
   console that opens dark on a phone in daylight has a Day preset it never offered. First run should read
   `prefers-color-scheme` and `prefers-contrast` (which maps to **Contrast**, the preset that already exists
   for exactly that person) and pick from them; an explicit choice, once made, still wins forever.
2. **A view link cannot carry a skin.** `map/view-link.ts` owns the parameter names and round-trips pose,
   projection, moment and district — a shared link reproduces the view but not the look. A `theme=` parameter
   belongs in that table, read on open, and (like every other parameter there) never written to an address
   bar the console does not own.
3. **An embedding host has no way in.** `?embed=1` is the whole console with its chrome off, inside a CAD
   shell that will have its own brand — and the library entry (`embed.ts`) mounts the map alone, where a
   skin has nothing to paint at all. The host needs to pin a preset, and the honest design is that it names
   an **id**, or passes a **full preset object that is validated at runtime against the same APCA
   thresholds** and falls back to Night, loudly, when it fails. What must not happen is a host overriding
   `--os-*` from its own root: the cascade would allow it, and it is an unmeasured skin that renders, lints
   and screenshots fine — the exact failure 09's guard exists to catch, re-entering through the back door.

#### How a screenshot becomes a preset

The procedure, so the next one is not a taste exercise:

1. **Capture at a known scale**, and record what the source was (a live page, a vendor PDF, a video frame)
   and how much it was resampled — a downscaled JPEG cannot answer type size or line width, and a preset
   that quotes them from one is quoting an artefact.
2. **Sample the flat regions**: a colour histogram over the whole frame gives the ground (it is the mode),
   the bar and the row fills; point probes confirm each in a region known to be flat.
3. **Order by luminance and assign to the role steps** — Radix's roles are the target, not the source's own
   naming: ground -> step 1, docked surface -> 2, rows and floats -> 3, hover -> 4, selected -> 5,
   separators -> 6, component edge -> 7, ring -> 8.
4. **Do not sample the text.** Text in a resampled capture is blended with its background, and the source's
   own contrast is not evidence that it passes. Fit steps 11 and 12 by walking lightness until
   `theme.test.ts` clears **Lc 60 / Lc 90** on every surface each is set on. This is the step where a
   borrowed palette becomes ours.
5. **Sample the saturated hues separately** to learn what the source encodes with colour — and then leave
   them where they are. Ours come from `SET_COLORS` in every preset.
6. **Run the suite, then look at it.** The guard proves the text is readable; only the screen says whether
   the skin reads as the instrument it was taken from.

#### Verification

- `theme.test.ts` passes for the new preset on every pair, at both thresholds, with no exception added.
- The shape and density additions carry their own guards: no component writes a raw radius or shadow, and
  every preset resolved at a coarse pointer still clears the 44-px criterion in both axes.
- A skin change remains one attribute write — asserted by the existing test that the emitted blocks contain
  every declared token, and confirmed on the phone (no reflow of the board, no dropped frame on the map).
- The switcher, the view-link parameter and the embedded default all resolve to the same preset for the same
  input.

#### BUILT 2026-08-30 — and three things came out different from the plan above

**1. There is no `--os-edge-width`.** It would read 1 px in every preset we ship: our floating surfaces have
always carried a hairline BESIDE their shadow, so the symmetric reading of `edge: 'shadow'` — a 0-px border
— would restyle four shipped skins to make a token look like a lever. `edge` therefore governs the shadows
alone, and `shape` is `{ edge, radius }`. A constant that never varies is a token that lies about being one.

**2. The density guard specified above would have passed on every possible input.** *"Every preset, resolved
at a coarse pointer, still yields a row that clears the criterion"* cannot fail: the phone's row
(`styles.rowTouch`) carries `minHeight: TOUCH_TARGET` and its own hardcoded padding, so `--os-row-padding`
never reaches it and 44 px is true by construction. **What actually travels from a desk to a phone is the
TYPE** — a chosen `dense` lands 10-px text inside a row that stays 44 px tall, which is invisible to every
other guard in this app. Both halves are asserted now, and the clamp is emitted as a `@media (pointer:
coarse)` block rather than resolved at mount, so it survives a skin change React never sees.

**3. Building the host validator found a hole in the guard itself, open since 7-09 wrote it.** APCA moved
into `src/ui/apca.ts` so the runtime validator and the test measure with one formula — and doing that
exposed the defect: `luminance` parses hex digits, so a colour it cannot read yields `NaN`, and `NaN < 60`
is **false**. A malformed palette did not fail the threshold, it **skipped** it. An unmeasurable pair is a
failure that names the colour now. Only the measured pairs are held to `#rrggbb`; a theme may still carry
`rgba()` where nothing is written on it, as Night's `warnBg` does.

**What shipped.** `shape` and `density` on every preset, emitted as `--os-radius-*`, `--os-text-caption`,
`--os-text-body` and `--os-row-padding`; the raw-value guard grown to radius and shadow (it found one — the
tally's 6-px dot, which moved into the token table as a deliberate exception, because a symbology MARK
answers to the map rather than to the skin); the **Mark43 preset**; and the three switchability gaps closed
against one stated ordering — a link's or host's `theme=`, then the stored choice, then `prefers-contrast` /
`prefers-color-scheme`, then Night. A link's theme is never persisted and an unknown id falls through to the
operator's own choice, so a typo in a shared link costs the recipient the sender's skin rather than theirs.

**Mark43, and what is measured versus fitted.** The ground (`#1e1f21`), the panel (`#28292b`) and the
separator (`#333`) are the source's own sampled values. The steps between them are **fitted**, because a
literal luminance sort of their swatches is not monotone — their grid rows measure BELOW their ground — and
our layering rule is. The text is fitted and not sampled at all, and that is not a formality: **Night's own
danger pink measures Lc 58 on this preset's lighter surface**, under a floor it clears comfortably on Night.
Every pair clears with margin — text Lc 92-96 against 90, muted 63-66, accent and danger 63-73 against 60.

**The bundle number, which this step owed**
([the row](../../../benchmarks/opensa-engine/2026-08-30-dispatch-bundle-theme-contract.json)): **one preset
costs 689 B raw / 197 B gzipped**, measured across three builds rather than two so the palette is separated
from the contract around it. The whole step is +4.5 kB raw / +1.56 kB gzip — so **87 % of it is the
contract and the validator, not the skin.** The claim that a preset costs bytes and not frame time is now
measured rather than asserted.

Verified: `tsc --noEmit` clean, `eslint` 0 errors (18 warnings, the unchanged baseline), 406 dispatch tests.

**Still owes:** the phone verdict on Mark43 in daylight — it is a lighter ground than Night and that cuts
both ways, and it is the one thing a desk cannot answer. Also unconfirmed on a device: that a skin change is
still one attribute write with no reflow of the board and no dropped frame on the map. Both need the same
field run everything else in chains 1 and 2 is waiting on.

## The design rule for all of it

Layout, colour, density and state tiles go through the design skills — `artifact-design` and `dataviz` —
before code, exactly as [3](../3-the-operator-surface-on-a-phone/readme.md) requires, and the tokens land in
`apps/dispatch/src/ui/styles.ts`. Six new controls added by feel is how a dispatcher's screen becomes
unreadable.

## Verification

- Every capability here works in all three [display modes](../6-display-modes/readme.md) or states plainly
  which it does not and why.
- Orthographic and perspective show the same world at the same pose — no cell present in one and missing in
  the other.
- The shared view link, opened cold on another machine, reproduces pose, mode and moment.
