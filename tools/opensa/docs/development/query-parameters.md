# URL query parameters — the canonical reference

Every query parameter the browser apps read, where it is read, and what it does. Written during
[074/13 phase 2](../plans/074-opensa-engine/13-cleanup.md) after the three-WebGL renderer was deleted:
the 073 debug-flag zoo grew to ~60 undocumented inline `URLSearchParams` reads, and **this file exists so
it cannot regrow unnoticed**. Add a parameter, add a row — a knob that is not here is not supported.

Verified against the code 2026-07-18; `loader`/`src` updated 2026-07-21 (plan 079). The browser apps read
parameters in `engine-canvas-host.tsx`, the engine-lab `main.ts`, the viewers, and `use-asset-boot.ts`/the
boot machine (`loader`).

## Game host — `apps/web` (`/`, the shipping app)

Read in `src/ui/engine-canvas-host.tsx` unless noted.

| Param       | Default                | Values                         | What it does                                                                                                                                                    |
| ----------- | ---------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loader`    | per-game               | `http-dir`                     | Dev override (079): run the full game against a served build (with `src`); read in `use-asset-boot.ts`                                                          |
| `src`       | `pak-map`              | pak base URL / served game dir | The world pak base — the loading MODE selects it (079): folder mode reads `opensa/` from the picked folder; `?loader=http-dir&src=<url>` reads the served build |
| `spawn`     | the game's spawn point | `x,y,z` (GTA coords)           | Player spawn override                                                                                                                                           |
| `look`      | the fixed spawn facing | `x,y,z` (GTA coords)           | Aim the boot camera at a world point and turn the ped with it — the headless harness has no mouse, so without it every probe stares SOUTH (plan 100 field check) |
| `hour`      | `22` (night)           | `0`–`24`; **`0` is honoured**  | Time of day                                                                                                                                                     |
| `weather`   | `0`                    | timecyc weather row            | Starting weather (remapped regionally at spawn)                                                                                                                 |
| `draw`      | `1200`                 | number, floored at `400`       | LOD ring radius; the fog cap follows it (074/21)                                                                                                                |
| `scale`     | config `renderScale`   | e.g. `0.75`                    | Render scale — **the one perf tier knob**                                                                                                                       |
| `aces`      | on                     | `0` = off                      | ACES tonemapping A/B                                                                                                                                            |
| `bloom`     | config                 | `0` = off, `>0` = intensity    | Bloom A/B                                                                                                                                                       |
| `procobj` | `1` | multiplier ≥ 0, **`0` is honoured** | Scales the runtime clutter density of every category; `0` turns the layer off. Saturates at `3` — that is `PROC_OBJ_MAX_DENSITY`, ours, not the data's |
| `procobjLimit` | `150` | number | Per-cell clutter budget (the lottery cap). Saturates at 300: a cell has no 300th placement at cutoff 1 |
| `procobjRange` | per category | units > 0 | OVERRIDES every category's clutter draw distance with one number — the A/B knob for the per-category ranges. `150` reproduces the pre-2026-08-10 ring, `100` is SA's own flat `PLANTS_MAX_DISTANCE` |
| `procobjFloor` | `1`; **`0` is honoured** | number ≥ 0 | Species floor: while `procobjLimit` binds, every clutter MODEL eligible in the cell keeps at least this many placements instead of possibly none. Paid for at the top of the lottery order, so the budget is unchanged — and measured to cost no frame time. **On since 2026-08-11**; `0` is the A/B and restores the old picture (17.7 % of clutter cells losing a species) — [plan 012](../../tools/sa-procobj-placement/docs/plans/012-species-representation-floor.md) |
| `procobjSlope` | unset | `<steep>,<flat>` | Slope gate (plan 011): the ROCK categories' candidate multiplier on STEEP vs FLAT collision faces — scree collects on slopes, not on the plain beside them. Slope is the one terrain signal not already carried by the surface (`p_mountain` is 48.8 % steep and holds all six rubble species; every other surface is under 20 %). **It re-rolls the scatter**, so two settings compare statistically and never placement by placement. `2,0.5` nets +14 % rocks map-wide |
| `procobjSampler` | `area` | `corner` | Where inside a collision triangle a clutter placement lands. `corner` is the ORIGINAL's recovered routine (`o1 = rand()`, `o2 = o1 × rand()`), which pulls toward whichever vertex the COL lists first — mean barycentric weight 0.5 against area-uniform's 1/3. The whole difference is one `sqrt`. Same placement COUNT either way; map-wide the close tail tightens (same-species p05 3.5 → 3.2 m) and the median does not move |
| `probe`     | on                     | `0` = off                      | Env-probe reflections off → analytic fallback                                                                                                                   |
| `probeview` | off                    | `1` = on                       | Draw the probe cube as a panorama instead of the frame                                                                                                          |
| `sky`       | analytic               | `preetham`                     | Sky model switch                                                                                                                                                |
| `clouds`    | config                 | number                         | Cloud opacity                                                                                                                                                   |
| `bench`     | off                    | `all` or one scene key         | Bench sweep; emits the `[bench]` JSON protocol                                                                                                                  |
| `soak`      | off                    | minutes                        | Soak stability run; emits `[soak]`                                                                                                                              |
| `benchcar`  | mixed models           | vehicle model name             | Pin every bench road car to one model                                                                                                                           |
| `parked`    | on                     | `0` = off                      | Registers `parked.json` at all; read in `src/ui/engine-vehicles.ts`. The boot census says `(DISABLED by ?parked=0)` so a run cannot silently be the wrong one |
| `cargen`    | on                     | `0` = off                      | Registers the map car generators (binary IPL CARS) at all. **The two knobs are HALVES of one bisection and `parked=0` alone proves nothing**: `parked.json` is ~212 placements against the generators' ~962, and both stream themselves in and out through the same `VehicleLodSystem`. A field run with `?parked=0` still found cars parked at the pirate ship and still churned (2026-08-03) — use `?parked=0&cargen=0` for a genuinely still world |
| `phys`      | off                    | `all` or one scene key         | Scripted physics lap (081/01); emits the `[phys]` JSON protocol                                                                                                 |
| `car`       | `infernus` / `admiral` | vehicle model name             | Which car the `phys` laps drive — and, for `video`, PINS one car for every scene instead of letting each pick its own (a mod car whenever the build ships any, else the stock road-car roster)   |
| `video`     | off                    | `1` = on, `0` = off            | Video mode (096): a seeded SEQUENCE of showcase scenes — a drive per region, plus flythroughs and a walk (096/07); emits the `[video]` JSON protocol and stops on an end card. Hides ALL chrome for the whole run and never hands it back |
| `seed`      | derived from the clock | integer                        | Determinises a `video` run's routes, car, hour and weather (D9). The ACTIVE seed is always printed as `[video] seed=…`, so a derived one is still replayable    |
| `at`        | off                    | `x,y` (GTA)                    | Pins every `video` scene to the graph node nearest this point — how a HARD street is looked at deliberately (`scripts/debug/video-routes.ts --worst` prints the coordinates) |
| `scenes`    | `100`                  | 1…100                          | How many scenes the sequence plays before it stops (096/05a) — a COUNT, not an end index. 100 is the CEILING, not just the default; an unreadable value takes the full run |
| `scene`     | `1`                    | 1…100                          | Where the sequence STARTS (096/05a follow-up), so `?seed=47&scene=57&scenes=1` is exactly scene 57 of seed 47 — the only way to reach a scene a field note named without playing the hour in front of it. It is the same scene the full run would have played: identity is `(seed, index)` |
| `diag`      | off                    | `1` = on                       | Adds a full-rate `[diag]` line per `video` scene (one row per RENDERED frame) for camera-motion diagnosis; read with `scripts/debug/video-shiver.ts`            |
| `gripVd`    | `12`                   | m/s                            | 081/09 lateral speed-grip assist: boost reference speed (`boost = min(1 + (v/gripVd)², gripCap)`)                                                               |
| `gripCap`   | `3`                    | ×                              | 081/09 assist ceiling; both dials are session overrides, shown in F2 and recorded by every `[phys]` capture                                                     |
| `airCtl`    | `1`                    | ×                              | 081/06 §1 in-air attitude control at the original's strength (`0.0007 × min(1, 3000/turnMass)` per frame = 1.75 rad/s² per unit of stick). `0` turns it off — the A/B for a jump; every `[phys]` capture records the active value |
| `surfGrip`  | on                     | `0` = off                      | 081/10: grip (and the steering limiter) read the SURFACE under each wheel — `surface.dat`'s rubber row: tarmac 4.5, grass 3.2, sand 3.0, wet 2.8. `0` puts every wheel back on tarmac; every `[phys]` capture records which it ran |

`bench` / `soak` / `benchcar` are read in `src/ui/engine-perf-runs.ts`. Scene keys live in
`src/bench-scenes.ts`: `ls-noon` · `sf-fog-dawn` · `lv-night` · `country-dusk` · `ocean-horizon` ·
`ls-rain-night`.

`phys` / `car` are read in `src/ui/engine-phys-runs.ts` (full guide: [physics-laps.md](physics-laps.md));
the scenes live in `src/phys-scenes.ts`:
`brake-strip` · `step-steer` · `slalom` · `u-turn` · `kerb-strike` · `crest-jump` · `handbrake-turn` ·
`pull-away-reverse`. A lap teleports next to a real road spot, spawns the car, seats the player, then plays
a keyframe timeline through the SAME `InputState` the player uses.

`video` / `seed` / `at` / `scenes` / `scene` / `car` / `diag` are read in `src/ui/engine-video-runs.ts`. A scene picks a route out of the
game's own `NODES*.DAT` graph, stages a car on it behind a black overlay the module owns, and hands the wheel
to the autopilot (`packages/game/src/vehicle/path-follow.ts`), and a director (`src/ui/video/`) cuts between
car-anchored shots and surveyed roadside tripods. A game with no `data/paths/nodes*.dat` (the total
conversions) says so and does nothing.

> **These are HARNESS CONTRACTS.** `tools-debug/bench-harness/drive.js` scrapes the console
> protocol (`[bench]` / `[soak]` / `[phys]` / `[video]` with `TAG=`, plus `sweep complete`) and the URLs in
> [benchmarks.md](benchmarks.md) use these names. Renaming one silently breaks the perf ritual.

## Engine lab — `apps/engine-lab`

The proving ground ([engine-lab.md](engine-lab.md)); read in `src/main.ts`. Renderer knobs mirror the
game host (`scale`, `aces`, `bloom`, `probe`, `probeview`, `sky`, `clouds`, `hour`, `weather`, `draw`,
`src`) with the scene-setup additions below.

| Param       | Default          | Values                            | What it does                                                                                         |
| ----------- | ---------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pak`       | off              | `1`                               | Stream the converted district (worker pak + LOD rings) instead of synthetic — the one pak path (079) |
| `cells`     | `8`              | number                            | Synthetic grid side                                                                                  |
| `boxes`     | `12`             | number                            | Boxes per synthetic grid side                                                                        |
| `at`        | pak centre       | `x,y,z`                           | Orbit focus override                                                                                 |
| `orbit`     | fitted           | number                            | Starting camera distance                                                                             |
| `az` / `el` | `0` / `0.9`      | number                            | Starting orbit azimuth (deg) / height factor                                                         |
| `ped`       | off              | `1`                               | Spawn a ped                                                                                          |
| `pedy`      | focus Y          | number                            | Ped/vehicle Y placement                                                                              |
| `vehicle`   | `0`              | count                             | How many vehicles to spawn                                                                           |
| `vmodel`    | `vehicle`        | model base name                   | Which vehicle model                                                                                  |
| `drive`     | off              | `1`                               | Drivable vehicle mode                                                                                |
| `freeze`    | off              | `1`                               | Freeze animation                                                                                     |
| `daycycle`  | off              | `1`                               | Animate the day cycle                                                                                |
| `fogscale`  | `2.5`            | number                            | Fog timecyc scale                                                                                    |
| `ao`        | config           | number                            | Baked AO strength                                                                                    |
| `sunvis`    | config           | number                            | Baked sun-visibility strength                                                                        |
| `wind`      | config           | number                            | Wind strength                                                                                        |
| `stoch`     | config (**off**) | number                            | Stochastic de-tiling — default-OFF, unstable (074/12)                                                |
| `bench`     | off              | `city`\|`close`\|`orbit`\|`drive` | Lab camera bench script (`src/bench.ts`)                                                             |
| `test`      | off              | `leak`                            | Leak test mode (requires streaming)                                                                  |

## Standalone engine page — `apps/web/src/standalone/opensa-engine.ts`

The minimal boot kept as a repro harness (074/13 phase 3.4): `src` (default `pak-ls`), `hour`
(default `12`), `scale`, `aces`, `bloom`.

## Asset viewers — `apps/viewer`

| Param | Default  | Values                                            | What it does         |
| ----- | -------- | ------------------------------------------------- | -------------------- |
| `tab` | `object` | `object` \| `vehicle` \| `character` \| `compare` | Which viewer to show |

> `tab` is an **e2e contract** — `e2e/viewer-tabs.spec.ts` navigates by it.

## Map viewer — `apps/sa-map-viewer` (`/sa-map-viewer.html`, plan 094)

| Param   | Default             | Values                | What it does                                                     |
| ------- | ------------------- | --------------------- | ---------------------------------------------------------------- |
| `src`   | —                   | served game-dir URL   | Load that dir (no picker). Absent ⇒ the folder picker screen      |
| `at`    | the map's centre    | GTA `x,y`             | Ground point under the view; names the cell that renders          |
| `h`     | `400`               | engine units          | Eye height above that point                                      |
| `pitch` | `-89.4`             | degrees, negative     | Down-tilt; clamped to `[-89.4, -3.4]`                            |
| `yaw`   | `180`               | degrees               | `180` is the map's usual orientation (north up); `0` flips it     |
| `panel` | shown               | `0`                   | Capture mode: hide the panel, keep the source caption            |
| `cells` | `1` (capture mode)  | `1` \| `all`          | What `panel=0` pins: the cell under `at`, or the whole map        |
| `lod`   | HD                  | `1`                   | Capture mode: pin the LOD layer instead of HD                     |
| `wind`  | `0` (frozen)        | number                | Vegetation sway. OFF by default — it is the only thing that moves |
| `fog`   | off (far plane)     | `1`                   | Restore the game's noon fog (its cut CULLS distant cells)         |
| `water` | on (`0` in capture) | `0` \| `1`            | Draw the sea. `map-viewer-shot.ts` sets `0` — the waves animate   |

> `at`/`h`/`pitch`/`yaw` fully specify the pose and **the camera never moves on its own**: the same URL is
> the same pixels (verified byte-identical across runs). `wind` defaults to 0 for exactly that reason, and
> `map-viewer-shot.ts` adds `water=0` for the same one — interactively the sea is ON, a scripted shot leaves
> it out unless you pass `water=1`.
>
> `cells`/`lod` exist because the panel's inspector OWNS the cell set: with `panel=0` there is no inspector,
> so the host seeds the set itself.

## Dispatch console — `apps/dispatch` (`/dispatch.html`)

Read by `dispatchParams()` (`src/world/boot.ts`), which falls back to `window.__opensaDispatch` when the page
has an opaque origin and cannot own its URL — a `content://` or `file://` host on a phone.

| Parameter | Does |
| --- | --- |
| `demo=1` | synthetic block city, no pak needed |
| `src=` | pak base to stream (default `build/original`) |
| `hour=` | opening hour for the environment driver |
| `at=x,y` · `h=` · `pitch=` · `yaw=` | opening camera pose (GTA ground point, height, degrees). **These names, `proj`, `hour`, `district`, `src` and `back` are one table read by one module** (`apps/dispatch/src/map/view-link.ts`, 201/7-07) — the console's `Copy link` writes exactly them, so a generated link and a hand-written one are the same thing |
| **`embed=1`** | **201/7-07**: the embedded shell — the map and its own controls, without the queue, roster, timeline or status bar. What an embedded console may and may not do is stated in [features/dispatch-console.md](../features/dispatch-console.md) |
| **`back=`** | **201/7-07**: seconds BEHIND live to open the shift clock at, so a shared link restores the moment as well as the view. Absent or `0` opens live |
| **the whole key map** | **201/7-06**: pan `WASD`/arrows · turn `Q`/`E` · tilt `Shift`+`↑`/`↓` · zoom `+`/`-` · levels `1`/`2`/`3` · north `N` · fit `F` · follow `C` · calls `[`/`]` · stop following `Escape` · the sheet `?`. All of it is rebindable in the sheet and stored per operator; the table lives in `apps/dispatch/src/map/keymap.ts`, and nothing here is a query parameter |
| **keys `f` · `c` · `Escape`** | **201/7-03**: fit every active unit and call in frame · ride the selected unit (again to stop) · stop riding. `Escape` acts only while a follow is running — it belongs to the selection everywhere else. Keys are ignored while a field has focus |
| **keys `1` / `2` / `3`** | **201/7-02**: not parameters — the three zoom levels (city / district / block), which fly rather than jump. `at`/`h`/`pitch` are still the opening pose, but **`h` and `pitch` are bounded by how much world there is around the focus**: a tilt whose top edge would land outside the streamed ring is tilted down, and a height that would frame past it is capped. The height asked for is kept; the tilt is what moves |
| **`proj=ortho`** | **201/7-01**: open in the plan view — an orthographic projection instead of the default perspective one. The `PLAN` button in the top bar is the same switch, and the pose in the readout says which is live. The box is sized to frame exactly what perspective frames at the focus plane, so switching is a change of projection and not a jump |
| **`mode=flat`** | **201/6-02**: open the FLAT 2D map — no WebGPU, no pak, no streaming. The tiles come from one `tiles.pmtiles` beside the built game (`?src=`), read by HTTP range requests; with no archive the mode keeps its projected grid and the status bar carries the reason. The tile layer is exact under the plan projection and under no other, so opening a pyramid takes the view there |
| **`tiles=`** | **201/6-02**: an archive anywhere, overriding `<src>/tiles.pmtiles` |
| **`bake=tiles`** | **201/6-02**: bake the pyramid from the streamed world with the console's own orthographic pass and download `tiles.pmtiles`. `zmin=`/`zmax=` (default `0`/`4`) and `tilesize=` (default 256) bound the run; past 4096 tiles it is refused with the count. It runs in the browser because the development machine has no headless Chromium, and it pauses the console's frame loop while it works. Progress and the closing report are `[tilebake]` console lines |
| `hd=` · `lod=` | streaming ring radii |
| `fog=1` · `fogscale=` | restore the game's own fog instead of pushing the cut to the far plane |
| `weather=` | weather id for the environment driver |
| `scale=` | render scale, clamped to `0.5..1` — the same manual knob `apps/web` has. It shrinks the scene and bloom targets (never the swapchain), which is the only lever that moves the `target` residency category: 34.66 MB of it at 1, 19.50 at 0.75, 8.66 at 0.5 on a 720×728 surface. Manual by decision — [the automatic ladder was measured and refused](../performance/deferred-optimizations/render-scale-tier.md) |
| **`overlay=0`** | **201/2**: draw the WORLD and nothing over it — the symbol pass, the chips, the sketches and the radar stop, and so does the per-frame update that feeds them. For measuring the ENGINE: the field round of 2026-08-30 put `overlay-2d` at 2.37 ms of CPU against `engine-frame`'s 0.57 at 150 units, so a streaming or texture number taken with the overlay on is mostly the symbology's. Subtracting the segment afterwards would not do — the GPU still did the work — so the pass is skipped instead. **The render gate stops watching the board with it**, or a window meant to price the engine would be paced by a roster nobody can see. The layers are still CONSTRUCTED, so this is the draw cost and never the allocation, and the capture carries `overlay: false` so a reader cannot mistake which run they have. `?embed=1&overlay=0` is the engine with nothing above it at all |
| **`inventory=1`** | **201/1-01**: collect the frame before-table and show a panel with a copy button. Its `cpu.worstFrame` carries the CONDITIONS that frame happened under — when in the window, the drawing-buffer size (a phone resizes itself when the browser's chrome collapses, and that rebuilds every render target), the cells created and evicted in that frame alone, what was still pending, and the draws — because the 2026-08-23 field capture had a 600 ms frame and nothing to attribute it to |
| **`district=`** | the measurement district: names the capture AND, with no `at=`, opens the camera over it (`apps/dispatch/src/world/districts.ts`) |
| **`units=` · `calls=`** | **201/5-02**: how many units and calls the board opens with (default 9 and 2). `units=150` is the worst case 201's budget table declares, and without this the board could not be loaded past the demo shift on any device — so the symbology numbers that step owes could not be taken at all. The generated roster is a hash of its index, never `Math.random`, so the same size is the same board twice |

### Taking an inventory capture

The measurement district for the whole of 201 is **the centre of Los Santos**, pinned in
[201/1-01](../plans/201-dispatch-console/1-the-map-profile/readme.md); every before/after in that chain uses
it, or the comparison is not an A/B.

```sh
npm run dev            # in Termux; add -- --host to reach it from another device
```

Then, in the phone's own browser (there is no headless capture on this machine —
[development/termux.md](./termux.md)):

```
http://localhost:5173/dispatch.html?inventory=1&district=los-santos-centre
```

`npm run phone` prints exactly this URL for whatever `DISTRICT=` it converted, and the district's name is
enough: the opening point comes from the same table the pak rect came from, so the capture cannot be filed
under one district while looking at another. `at=` still overrides it for ground the table does not name.

For a symbology capture (201/5-02) add the load: `&units=150&calls=40`. The report's `symbology` block then
states what reached the screen — symbols, chips, chips dropped for depth, `measureText` calls and the beacon
buffers' capacity — so `cpu.segmentsMs`' `overlay-2d` can be read against a count rather than against a
guess. `measures` above 0 in steady state means the label width cache is not holding and the frame time
should not be cited.

The report's `tracks` block (201/8-01) is the time axis: how many units it is holding history for, how many
samples that is, the **host** bytes it costs, and the window a scrub could ask for. It is deliberately not
part of `world.residencyMb` — that ledger counts GPU bytes and this is JS heap, so adding them charges a
track against a texture budget.

Let it settle, pan and zoom the way an operator would, then press **copy JSON**. On a LAN address the
clipboard API is unavailable (not a secure context) and the panel drops a selected textarea instead — long
press, copy. The JSON goes to `docs/benchmarks/` **before** it is analysed, per the standing rule.

**What it cannot tell you on a phone:** `gpuPassMs`, `gpuPostMs` and `gpuProbeMs` need `timestamp-query`,
which mobile adapters do not have. The report says so in `unavailable` rather than printing them as zero —
the numbers that remain (`dt` percentiles, `submitMs`, draws, triangles, cells, residency, and the
between-frame spans) are all real.

**What replaces them.** The 2026-08-07 mobile row came back with no GPU timer, empty spans and `submitMs` at
5.6 % of the frame — 94 % of it with no owner. So the report also carries a **CPU-side split**, which every
device can produce:

| Field | Reads as |
| --- | --- |
| `cpu.bodyMeanMs` | mean ms inside the rAF callback — the main thread actually working |
| `cpu.outsideMeanMs` | mean dt minus that: present, GPU backpressure, vsync wait, other tasks, GC |
| `cpu.shareOfFrame` | the first of those over the frame. Low = the frame is WAITING; high = it is working |
| `cpu.segmentsMs` | where the body went (`engine-frame`, `overlay-2d`, `board`, `stream`, `readout`, `other`) |
| `frame.dtHistogramMs` | dt counts per 2 ms bin. Piled at 16.7/33.3 = locked to vsync; spread = simply slow |
| `surface` | CSS size, DPR, drawing buffer and `renderScale` — **the whole of `world.byCategoryMb.target` is a function of these four numbers and of nothing else**, so a capture without them cannot be read for its largest category. It was three sentences written by hand until 2026-08-12 |

The last two rows answer the open question the mobile row could not: a frame missing a 60 Hz deadline and a
frame that is genuinely 32 ms of work look identical in a p50 and are fixed in opposite directions.

**And the bytes column.** The report carries `bytes` — what the surface actually READ out of the pak since
boot, by entry kind (`texture-array`, `cell-hd`, `cell-lod`, `collision`, plus any loose file such as
`water.bin` by name), with wire bytes and request counts. The build's own `report.json` says what the pak
CONTAINS; **the gap between the two is what the map profile is for**, and a kind absent from this list is one
no frame of this surface ever asked for. Wire bytes are what the network carried — before the worker inflates
a `deflate-raw` entry — so they are comparable with a `Range:` server's log and not with the decoded size the
manifest already states.

**And what the STREAMER did.** `streaming` carries the engine's own per-update numbers, which the console
used to throw away: `blobMeanMs` (the worker's message handler — decode and `createTexture` — which runs
between frames where no in-loop timer can see it), `uploadMeanMs` (the budgeted drain inside `update`),
`worstBlobMs` / `worstCreateMs` as MAXIMA rather than averages, and the create/evict/late counts. The game
shell has read these since a 2026-07-27 field report of 20-250 ms frames turned out to be whole-array uploads
at 15-85 ms a call. Beside it, `cpu.worstFrame` keeps the worst body of the window **with its own segment
breakdown**, because two captures in a row made the worst frame the interesting one and a mean cannot say
which part of it grew.

The report also states its own ground and its own arm — `district`, `camera.at`, `camera.height`,
`camera.projection` (perspective or the plan view, 201/7-01) — and **warns when the
district is not the one 201/1-01 pinned**, because a capture on other ground is a valid measurement of
somewhere else and not part of the chain's before/after series.

## Two known inconsistencies

Documented rather than silently fixed; both are load-bearing for existing bookmarks and bench URLs:

- **`src` defaults differ per host** — `pak-map` (game), `pak-ls` (standalone), `pak` (lab); since 079 the lab
  points `src` at a served game dir (e.g. `http://localhost:3001/build/original/opensa`), and `?loader=http-dir`
  makes the game do the same.
- **`hour=0` means midnight only in the game host.** The standalone page and the lab read it as
  `Number(...) || 12`, so `0` falls back to noon.

## Retired parameters

Deleted with the three-WebGL renderer in [074/13](../plans/074-opensa-engine/13-cleanup.md) and read
**nowhere** as of 2026-07-18. Listed so an old bookmark or plan doc can be recognised, not revived:

- **The 073 debug zoo** (phase 5, with the render path): `webgpu`, `engine`, `aa`, `dpr`, `bundle`,
  `bundledebug`, `texfree`, `mesh1`, `warm`, `appear`, `cellcull`, `fog`, `nocull`, `shadowdebug`,
  `mat04`, `matcache`, `pool`. This is the disposition the
  [073 chain](../plans/073-webgpu-migration-threejs/readme.md) deferred to "when the own-framework work
  starts" — the answer was **delete**.
- **Spike params** (phase 3, with the spike pages): `count`, `mode`, `swap`, `dn`, `pipeline`,
  `snapshot`, `rot`, `fix`, `precompile`, `ctx`, `variant`.
- **Never implemented or field-removed** — these were documented but never read: `msaa` and `bloomq`
  (field-tested and removed: WebGPU allows `sampleCount` 1 or 4 only, and A2C needs 4), `ssr` and
  `carshadow` (the plan-16 features were built and rolled back), `panorama` and `cloudcover` (the
  painted panorama was retired by the sky v2 arc), `lighting`, `path`, `speed`.

## Why there is still no `flags.ts`

Phase 2.4 asked whether the survivors should move behind one typed reader. They should not — yet. The
count fell from ~60 to **28 distinct names** (096 added six — `video`, `seed` in 02, `at` in 04, `diag` and
`scenes` in the 05 round, `scene` right after it; `from`/`to` were removed when a scene stopped having a chosen
length), most of them read exactly once, and the two hosts read
overlapping-but-differently-defaulted sets (see the inconsistencies above), so a shared reader would
have to model the difference rather than remove it. The zoo grew because nothing was written down, not
because reads were inline. **This document is the fix; revisit a reader if the count climbs again.**
