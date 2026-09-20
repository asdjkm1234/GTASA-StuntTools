# Benchmarks, soak & the perf ritual

How the own-engine game is performance-tested: the in-game **bench sweep** (speed), the **soak mode**
(stability over time), and the **headless harness** that runs both without a human at the screen.
Chain context: [074/11 performance testing](../plans/074-opensa-engine/11-performance-testing.md) ·
[074/10 flip criteria](../plans/074-opensa-engine/10-integration-flip.md) · results ledger:
[the series](../benchmarks/opensa-engine/2026-07-18-series.md).

## The standing ritual

**The 6-scene sweep runs after EVERY engine change; deltas drive accept/reject** (user rule,
2026-07-15). Every run becomes a row in
[`docs/benchmarks/opensa-engine/2026-07-18-series.md`](../benchmarks/opensa-engine/2026-07-18-series.md) — date,
label, protocol, numbers, verdict. Regression gate: **>10 % on a comparable column fails silently
nothing — it gets investigated or explicitly accepted in the row's note.** Only compare rows taken the
same way (see the DPR caveat below).

## In-game bench (`?bench=`)

The game host runs deterministic scene flights and prints one JSON report per scene. (Until 074/13
phase 5 a `?engine=three` override booted the old WebGL renderer for side-by-side baselines; that
renderer is deleted, so pre-2026-07-18 prod columns in the series can no longer be reproduced.)

```
http://localhost:5173/?bench=all          # the full 9-scene sweep
http://localhost:5173/?bench=country-dusk # one scene
```

Scenes live in `apps/web/src/bench-scenes.ts` (plan 063 protocol — the camera paths are unchanged from the
WebGL era, which is what makes the historical rows comparable): `ls-noon` · `sf-fog-dawn` · `lv-night` ·
`country-dusk` · `ocean-horizon` · `ls-rain-night` · `ganton-noon` · `strip-noon` · `ganton-night`.

Each scene: teleport to the anchor → **1 s teleport notice** → the streaming ring drains → **ground is found
under the anchor** → **the player is warped onto THAT GROUND** (not the anchor) → **wait until he is at rest**
(capped at 3 s) → 1.5 s warmup → 15 s camera flight with per-frame sampling. Everything after the ring is
plan 102: the first polls after a teleport still describe the ring the player LEFT (drained, so they answer
0), the ring says nothing about COLLISION (built in a promise continuation behind it), and **a scene anchor
is authored for the CAMERA** — six of the nine sit 3.65–26.29 m above their ground and `ocean-horizon`'s is
43.75 m up, so warping to it means a fall.

**A scene anchor may not stand more than 60 m above its ground** (`GROUND_PROBE_DROP`). Further than that
the floor is not found, and the settle falls back to the authored anchor — silently, and the row then reports
whatever the fall left. The probe catches the consequence; nothing catches the cause.

**Road cars** (1219 across the nine scenes as of 2026-08-09, from vehicles.ide on the NODES.DAT road graph)
register automatically — the realistic vehicle load every row must share; `?benchcar=` pins one model. The
count is a function of the scene ANCHORS, so moving one changes it (`strip-noon`'s move added 23).

Report line (the deliverable IS this console line):

```
[bench] {"key":"country-dusk","avgMs":8.33,"p95Ms":9.2,"fps":120,"frames":1801,"avgDrawCalls":443,
         "gpuMs":{"pass":2.36,"post":1.07,"probe":0.32,"submit":0.40},"lateCreates":0,
         "residency":"cellIndex 3 · cellVertex 20 · target 345 · texture 758 · uniform 0"}
```

- `gpuMs.pass` — the world pass; the main per-scene comparison column.
- `gpuMs.post` — the post chain, measured as `postEnd − worldEnd` (the raw span is a Metal TBDR
  overlap artifact — begin timestamps fire at vertex start; the plan-09 fix).
- `gpuMs.probe` — **contaminated by the same Metal begin-overlap; judge the env probe ONLY by on/off
  A/B (`?probe=0`), never by this column** (plan-16 lesson).
- `hitch` — `{blobMaxMs, maxMs, p99Ms, pendingMax, slowFrames, uploadMaxMs}`: the leg's WORST frames, and
  the only cost columns a frame cap cannot pin. **Read these, not `avgMs`, on a vsync-capped lane** — the
  2026-08-09 A/A floor measured `avgMs` at 8.333 on seven of nine scenes and `p95Ms` at 9.1 on all nine, in
  both arms, so neither carries signal there. A cap bounds how FAST a frame may be and says nothing about
  how slow one gets. `maxMs`/`slowFrames` (the same 20 ms threshold the `[slow]` line prints at) catch the
  seen-once stall; `p99Ms` needs the degradation to reach 1 % of the leg, so it answers about a budget being
  exceeded rather than about one hitch. `blobMaxMs`/`uploadMaxMs`/`pendingMax` say whether a stall was
  STREAMING — blob-handler work lands between frames, where no in-frame block timer can see it.
  **A clutter lever again, and a small one:** `?procobj` / `?procobjLimit` reach only the rules the BUILD did
  not bake, which since plan 014 is all 95 on `opensa` (the bake moved into the `sa` branch). They move
  content — `?procobj=0` is −2.72 % triangles on `country-dusk` against a 0.007 % A/A drift — but **both
  saturate against the authored MINDIST spacing**: the cap at 300, the multiplier at ×4, and the whole layer
  is +10.1 % of that scene, below the noise on every cost column
  ([the ladder](../benchmarks/opensa-engine/2026-08-10-headless-procobj-runtime-knob-ladder.json)).
  **And pick your lane:** the `hitch` block is only readable CAPPED — every `UNCAPPED=1` arm reads `maxMs`
  148–196 ms and `slowFrames` 16–19 regardless of content, because the loop runs flat out. Uncapped answers
  cost (`avgMs` unpins 8.33 → 5.4–5.6, `p95Ms` 9.1 → 6.7–7.2); capped answers hitching. Never both, never mixed.
- `lateCreates` — streaming honesty (074/21): creates inside the fog cut during the measure window;
  0 in a healthy run.
- `legStart` — `{dz, grounded, ok, pendingCells, targetZ, worstDrop}` (plan 102). `targetZ` is where the
  settle PUT him (found ground + 1 m), `dz` is how far he had moved from it when the capture began, and
  `worstDrop` is the worst single-frame descent over the leg. **`ok: false` means the row measured a moving
  camera** — read nothing else in it; the run also prints a `[fall]` warning so the fallwatch
  (`TAG='[fall]'`) catches it. `ok` judges **grounded**, `worstDrop ≤ 2 m` and no pending cells — *not* `dz`,
  because where he stands is the scene's business while a player still MOVING is what invalidates a row.
  The falls were invisible for a month because no instrument could print non-zero; this is it.
- `residency` — GPU ledger by category, MB; `texture` is the plan-21 accumulation watch.
- `vehicles` — `{live, meanMs, maxMs}`: the vehicle slice of ONE fixed step (081/07 §3) — the raycast
  controllers plus the vehicle system's own fixed update, apart from the solver (`physicsMs`) and from the
  per-frame visual tick (`vehiclesMs` in the `[slow]` line). `live` is the busiest raycast-vehicle count the
  leg saw, because a cost without its car count says nothing. Frames that ran no fixed step are excluded, or
  a catch-up frame would read as a step that cost double.

## The `[slow]` line (frames over 20 ms)

A frame longer than `SLOW_FRAME_MS` prints its CPU breakdown — the stall arrives as a NUMBER, not a theory.
Every block the loop runs is timed (`fixed` · `collision` · `vehicles` · `ped` · `anim` · `props` · `world` ·
`pose` · `paused` · `stream` · `camera` · `render`), and what `dt` still holds after all of them is `other`.

`other` is **not** untimed loop work — since plan 091 the loop times all of it. It is the time BETWEEN
frames: `dt` runs rAF-start to rAF-start, so a frame's length includes every promise continuation, worker
handler and GC pause since the last loop returned. That half reports itself through named spans, drained at
the top of the frame that paid for it, and the line prints the breakdown in brackets:

```
other 223.6 (vehicle-model:tampa 4.9 · vehicle-osm:tampa 1.2 · cell-collision-bodies 8.4 · unattributed 163.8)
```

That capture predates [200/3-02](../plans/200-platform-reach/3-off-main-thread/readme.md): `cell-collision-bodies`
no longer exists. The Rapier build is now drained inside `collision.update()` under a per-frame allowance, so
it is counted in the loop's own `collision` block and has no span of its own.

Spans today: `vehicle-osm:<model>` (the `.osm` section read + parse) · `vehicle-model:<model>` (the GPU
upload) · `vehicle-spawn:<model>` (the physics body, rig and plate) · `cell-collision-decode` (a BAKED cell's `.oscol` → colliders, plan
200/3-01 — it exists only on a pak built with `--bake-collision`, and only there does the collider build run
in a continuation at all; the COL path is synchronous inside the loop's `collision` block and must stay
unwrapped). **`unattributed` is always printed** — a run that hides it is reporting only
the half it can see. To add a span, read the two rules in
[`restrictions/architecture.md`](../restrictions/architecture.md) first; `cell-collision-read` was deleted on
2026-08-02 for breaking one of them.

**`unattributed` is not one thing, and `gpu` on the same line is what tells them apart.** On a teleport bench
— dozens of car models and a city of cells allocated and freed in one frame — it is the GC tail. On a drive it
is usually the CPU waiting on the GPU: a frame whose `gpu` pass is 15 ms against a `render` block of 0.3 ms
was not collecting garbage, it was idle. Name it before you act on it.

Full knob reference: [query-parameters.md](query-parameters.md). Useful A/B knobs while measuring: `?scale=0.75` (the ONE perf tier knob), `?aces=0`, `?bloom=0|N`,
`?probe=0`, `?sky=preetham`, `?clouds=N`, `?draw=800..1600` (LOD ring; fog cap follows), `?hour=N`,
`?soak=` (below). The prod host honours the same `?bench=` protocol for side-by-side baselines.

## Field drive (a human at the wheel, censused afterwards)

The `[slow]` line needs no flag in a dev run (`perfLogs = IS_DEV`), so a drive measures itself. This is how
the two 2026-08-02 runs were taken, and it is the only lane that can answer a question a scripted sweep cannot
— whether a thing is FELT.

```bash
npm run serve:static     # :3001
npm run dev              # READ the Vite line for the port; it is not always 5173
```

```
http://localhost:5173/?loader=http-dir&src=http://localhost:3001/build/original/opensa&hour=12&weather=0
```

- **Open DevTools → Console BEFORE clicking "CLICK TO PLAY".** Both drives so far missed the boot lines by
  opening it late, and so recorded neither the pak `buildTime` nor the world's car census — the numbers were
  usable, the record was not.
- `hour=12&weather=0` keeps night lighting and weather out of the frame cost. **No `?video=1`** — that is the
  autopilot, a different load shape, and a live keypress adds to it.
- One continuous session. Restarting resets every "already loaded" set and smears the picture.
- Ignore the first ~30 s: that is the boot shape.
- Export the whole console (right-click → *Save as…*), then:

```bash
npx tsx scripts/debug/slow-frame-census.ts <console-export.log> [--worst 8]
```

The census reports the frame-ms spread, which block owned each frame, the named spans that appeared, the GPU
pass beside the CPU render (the pair that separates a GC tail from a GPU wait), and a NEGATIVE `unattributed`
— which means a span is being double-subtracted and nothing else in the repo can see it.

**A drive's raw slow-frame COUNT is not comparable between runs** unless both recorded their duration, and the
console export has no timestamps. Compare the distribution.

## Soak mode (`?soak=`)

The stability half (074/10 pre-flip ③; criteria from 074/05): does a LONG session stay flat?

```
http://localhost:5173/?soak=30   # minutes; cycles all 6 bench scenes until the deadline
```

Each scene leg (settle + warmup outside the window, 15 s steady flight inside) prints a `[soak]` JSON
line: frames/avg/p95/slow, heap MB (Chromium only), residency + texture MB, cells, late creates, long
tasks (>50 ms, Chromium only). At the deadline a final line carries the **self-judged verdict** — all
checks are relative to the run itself (first vs last quarter), so the verdict is display- and
browser-independent:

| Check              | Fails when                                                           |
| ------------------ | -------------------------------------------------------------------- |
| `coverage`         | fewer than 8 legs (run too short to judge)                           |
| `heapFlat`         | last-quarter heap mean grows past max(200 MB, +25 %)                 |
| `residencyFlat`    | the run's residency peak sits in the last quarter (monotonic growth) |
| `textureFlat`      | same signature on the texture bucket (the LRU must plateau)          |
| `lateBounded`      | late creates exceed ~minutes/5                                       |
| `longTasksBounded` | steady-leg long tasks exceed ~minutes/5                              |
| `frameStable`      | last-quarter p95 median drifts >1.5× the first quarter's             |
| `slowBounded`      | slow frames (>20 ms) exceed 0.5 % of all measured frames             |

The verdict also lands on the debug HUD (`SOAK VERDICT: PASS — …`), which is the **Safari flow**: open
the tab with `?soak=30`, come back in half an hour, read the line (heap/longtask checks report
"skipped" there — the probes are Chromium-only). Judge logic is pure and unit-tested:
`apps/web/src/ui/soak.ts`; the bench/soak leg mechanics are shared in
`apps/web/src/ui/engine-perf-runs.ts`.

## Headless harness (`tools-debug/bench-harness/`)

Runs all of the above in headless Chromium — no human, no screenshots from the user. Two pieces:

The served dir must be an **opensa-pack `--out`**, not a raw game: since opensa-pack plan 003 the engine
host loads the player by name and refuses to boot without it (`player model male01.osm not found — run
opensa-pack over the game dir`).

```bash
# 1. serve the canonical build (an opensa-pack --out under ./build) with Range + CORS + a /__index listing
npm run serve:static      # port 3001, mounts /build → build/

# 2. vite dev server at the repo root
npm run dev

# 3. drive a sweep (DPR=2 = retina-equivalent render targets). ?loader=http-dir reads the served build —
#    the REAL load path (no fake picker); the app loads straight from ?src, no folder step.
SRC="http://localhost:3001/build/original/opensa"
DPR=2 NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&bench=all" sweep 600000 8

# UNCAPPED=1 drops the presentation clock (--disable-frame-rate-limit --disable-gpu-vsync) when the
# question is COST rather than hitching — the capped lane's avgMs/p95Ms sit on the vsync period. The run
# prints frameClock=uncapped|vsync; an uncapped arm may never be compared against a capped record.
UNCAPPED=1 DPR=2 NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&bench=all" sweep-uncapped 600000 8

# a soak run: TAG switches the captured protocol, expect count is bypassed by the verdict line
DPR=2 TAG='[soak]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&soak=30" soak30 2700000 999

# boot-gate checks (074/10): canvas→WebGPU context present, no-WebGPU→sorry screen
node tools-debug/bench-harness/gate-check.js canvas "http://localhost:5173/?loader=http-dir&src=$SRC" gate
node tools-debug/bench-harness/gate-check.js sorry  "http://localhost:5173/" sorry
```

How it works (plan 079 phase 3): `?loader=http-dir&src=<served build>` runs the game through the REAL
load path — `fetchInstallSource` reads the served dir's `/__index` + files over HTTP Range, exactly as
`serve-static` exposes them, so the harness exercises the shipping loader instead of a fake
`showDirectoryPicker` (the surrogate that once shadowed a whole class of load bug). WebGPU needs
`--enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal` (already in the scripts).

**Gotchas** (learned the hard way, keep them):

- **A per-game-loader boot (no `?loader=http-dir`) shows a BEFORE-YOU-PLAY disclaimer** whose OK
  button must be clicked, and **a fetch-loader boot needs a Cache Storage quota override** — the
  ephemeral headless profile's default quota is smaller than the ~1.2 GB chunk set, and over-quota
  downloads die as silent `net::ERR_ABORTED` with zero console errors. `drive.js` handles both
  since 097/06 (an OK-click that no-ops on http-dir; CDP `Storage.overrideQuotaForOrigin` to 8 GB).
- **`TAG` re-targets what counts as a report** — `TAG='[cleo]'` turns `drive.js` into a boot-census
  checker (the 097/06 field checkpoint ran exactly that way); the run exits after `expectReports`
  matching lines instead of a bench sweep.
- **`VITE_STATIC_URL` in the local `.env` may point at the machine's LAN IP** (for phone tests) —
  when a fetch boot hangs with no errors, verify that IP against `ifconfig` before blaming the
  loader.

- **Headless 1× is NOT pass-comparable to the user's 2× retina display rows** — and a 1× A/B once
  missed a 30–40 % display-only night cost (the plan-16 SSR lesson — that feature was rolled back). `DPR=2` closes the render-target
  gap (verify: screenshot is 2880×1800, HUD `target` ~345 MB vs 92 at 1×), but **user-display rows
  remain the sign-off standard** for per-pixel features.
- The engine honours `?hour=`; prod ignores it (F2 menu there). The in-game clock keeps running — read
  the corner clock on screenshots.
- Scene-teleport frames (physics catch-up giants in `[slow]` logs) sit OUTSIDE the measured windows —
  the known settle pattern, not a regression.
- Screenshot metering: no PIL/numpy on the Mac python — use ImageMagick (`magick` in /opt/homebrew/bin)
  crop + `-resize 1x1!` grid averages; compare channels, not just luma.
- **A two-arm ENGINE A/B (old commit vs new) has two traps, and the first one is silent.** The setup is a
  `git worktree` at each commit, served by its own `vite --port 5174`, driven against the same
  `serve:static` build:
  - **Never symlink the repo's `node_modules` into the worktree.** The workspace links inside it
    (`node_modules/@opensa/engine → ../../packages/engine`) then resolve back into the MAIN checkout, so the
    "old" arm quietly runs today's engine and the A/B measures nothing. It announced itself only as a Vite
    `outside of Vite serving allow list` warning naming a main-repo path. Build the worktree a real
    `node_modules` of per-entry symlinks instead, and recreate `@opensa/*` with the SAME relative targets so
    they land inside the worktree — then verify one of them resolves there before running anything.
  - **An engine arm can only read a pak of its own era.** The 2026-08-07 pair in plan 099 boots, runs
    scripts and prints the bench protocol against the 2026-08-11 pak — and renders ZERO frames, both sides
    dying on `texture array 5 not loaded (cells must load after their arrays)` plus a LOD render-bundle
    index overflow. A zero-frame arm still emits complete-looking `[bench]` rows (`avgMs: 0`, `frames: 0`),
    so **check `frames` before reading any column**. Road-car counts drifting between arms (1 196 vs 1 219)
    is the second tell that the arms are not comparable.
- **Do not edit anything in the Vite module graph while a run is in flight.** Saving a file under
  `apps/` (a `.test.ts` counts) reloads the page, and the harness ends the run wherever it got to — with
  exit code 0 and no `run complete` line, so the log looks like a short run rather than a broken one. Cost
  a 12-scene 096/08 measurement that stopped at 4. Edit between runs, or read the log for `run complete`
  before trusting a count.
- **A run that straddles a machine SLEEP is void.** Every frame time across the gap is wall clock, not
  work, and the run continues afterwards as if nothing happened. Kill it (`pkill -f bench-harness/drive.js`)
  and start again — there is no way to repair the numbers, and the served/dev servers do survive, so only
  the run has to be restarted.
- **`expectReports` must equal the number of protocol lines the run will actually emit.** Set it higher
  and the harness waits out its whole timeout after the run has finished; a `[video]` run emits one line
  per scene AND repeats them all in the end-of-run dump, so dedupe by scene when reading.
- **macOS has no `timeout(1)`.** Wrapping a run in it — `timeout 900 node …/drive.js …` — does not cap
  anything: the shell fails with `command not found` and exit 127 before the harness ever starts, which
  reads exactly like the harness dying at launch. Use `drive.js`'s own budget argument (the millisecond
  value after the tag) instead; there is nothing to wrap.
- **The boot camera faces SOUTH** unless `?look` says otherwise. Anything `?spawncar` places north of
  `?spawn` is behind the camera — a car 8 m north "spawns" but never appears on a screenshot (and one
  placed 4–6 m north puts the FOLLOW camera inside it). Place field-check targets at `y − 10` or lower.
  `?spawncar`'s heading is RADIANS: 0 faces north (front toward the boot camera), `4.712` (3π/2) shows
  the DRIVER side.
- **`?look=x,y,z` aims the boot camera at a GTA point** (and turns the ped with it, so auto-centre holds
  the aim). The harness has no mouse and look is pointer-only, so before this knob a subject had to sit
  SOUTH of a standable spawn to be seen at all — which is unsatisfiable near the map's north edge
  (`y ≈ 3000`): a spawn past it falls through the void, HUD `grounded 0` and `draws 12`.
- **Aim is not sight.** Two spawns 600 u from a subject with a clean bearing still showed a fence and a
  rooftop wall — LS geometry blocks nearly every ground-level sight line. Pick the approach over open
  terrain (desert, water's edge), and confirm from the shot, not from the coordinates.
- **Angular size decides what a screenshot can answer.** A 2.4 m roadsign plate at 440 u is ~8 px in a
  1440-wide capture: "is it readable" has no answer there at any build quality. Judge distance checks on
  something big (a smoke plume) or add a counter to the engine; do not spend runs on a smudge. The roadsign
  case took the second road: the HUD's `signs N` (`EngineStats.roadsignQuadsRecorded`, `.oscell` minor 8)
  counts roadsign glyph quads in the cells drawn this frame. **`signs 0` on a pre-minor-8 pak means UNKNOWN,
  not none** — check the pak's `buildTime` before reading it as a verdict. The canonical `build/original`
  pak carries it from `13:19 08-08-2026` on.
- **A diagnostic that needs new pak bytes does NOT need a full rebuild.** For ONE model, `scripts/debug/
  model-repack.ts <model> [--dff f.dff [--txd f.txd]]` re-optimizes it, re-bakes its rect's cell LODs from the
  swapped HD and re-welds the rect into `build/<game>/opensa-lab` (serve it, `?src=/build/<game>/opensa-lab`) —
  17 s for an 88-model rect on `original` (opensa-lod-generator plan 007). For a bigger area with
  `.work-opensa` kept (`--keep-work`), re-pack a RECT (`opensa-pack --game build/<game>/.work-opensa/opensa-lod
  --out build/<probe> --rect x0,y0,x1,y1 --no-ao`): 80 cells in a minute instead of 1137 in an hour. Both are
  diagnostic paks, not shipping ones — say so wherever their numbers land, and do not benchmark against them.
- **A pmb run that dies is resumed** (`--resume`, pmb plan 006) — never re-run from stage 1 to get the same
  tree back; the resumed tree is byte-identical to an unbroken run's, and the pack re-enters at its last
  finished weld chunk.

### `warnings.js` — the warning catcher (bug rounds)

`drive.js` waits for a report protocol; `warnings.js` (same boot: http-dir, quota override, OK click)
instead just lives in the world for `<durationMs>` and collects every console warning/error, pageerror
and WebGPU validation message — deduped with counts — into `<out>.json` with the HUD text and a
screenshot. `TAGS='[spawncar],[cleo]'` also records matching info lines (a failed spawn says so at info
level); `KEYS='Wait:6000;KeyW:4000;Enter:700'` holds keys in sequence (`Wait` = idle — let the
`?spawncar` retry land before pressing keys at the car); `FAIL_ON=error` makes it exit 1 on any error.

```bash
SRC="http://localhost:3001/build/original/opensa"
NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/warnings.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&cleo=1&spawn=383,-2035,8" wheel-check 45000
```

The 2026-08-05 bug round ran on exactly this: the ferris-wheel destroyed-texture crash, the coach/bus
missing driver-side wheel and the coach Enter-range fix were each verified by a `warnings.js` run
(spawn at the reported spot → walk/press → read the JSON + screenshot), no human at the screen.

## Unit / e2e lanes

- `npm test` — Vitest units (node, headless, no assets). Perf-relevant suites: `soak.test.ts` (the
  judge), `bench.test.ts`, `perf-monitor.test.ts`, `webgpu-gate.test.ts`. Cost rule: run only the
  affected test file for small changes.
- `npm run test:fixtures` — regenerates real-asset fixtures from a GTA copy (see
  [test-coverage.md](test-coverage.md)); a real asset becomes a one-line manifest entry — never
  hand-build fake DFF/TXD.
- `npm run e2e` — the Playwright browser lane, separate from `npm test` (see [e2e.md](e2e.md)).
