# 201/3 — The operator surface on a phone

"It loads" is not "an operator can work it". The compact layout flips at ≤860 CSS px
(`apps/dispatch/src/ui/use-compact.ts` — a media query, because a phone in landscape, a narrow window and a
split screen all need the same treatment and none is reliably identifiable any other way) and it was verified
on an **emulated** Pixel 7 at 412×839 DPR 3. The only real phone in the record is 360×800, and
[200/4-04](../../200-platform-reach/4-mobile-runtime/readme.md)'s "360 CSS px" target has never been verified
for any surface.

## UI here is designed, not eyeballed

Before writing layout, choosing colour, or laying out state tiles, load the design skills — `artifact-design`
for composition, type, density and both themes, and `dataviz` for palette, stat tiles, legends and
readability. The shapes are exactly the ones those cover: the status bar is literally a KPI row (fps, cells
visible/total, draws, resident MB, pak build stamp, view position) and the call queue is a dense list carrying
priority and state.

What that has to produce:

- **one token set** — colour, type scale, spacing, priority states — in the app's existing
  `apps/dispatch/src/ui/styles.ts` (`styles`, `COLORS`), per the app's convention, not scattered per
  component;
- a palette that **passes contrast in both themes**, with call priority readable by more than colour alone;
- a **360 CSS px layout fixed before the code**, so 01 below checks against a specification rather than
  against a feeling.

## What already landed against this chain's rules, and what it changes here

**2026-08-22.** Chain 7 put an operator cluster, a nav cluster and a key sheet on the map before this chain's
360-px spec existed, and three of its controls were desk-shaped: 24-px map controls, 19-px list rows, and
zoom levels that lived only on keys `1`/`2`/`3` — which on a phone is a capability that does not exist. All
three are fixed, and the rule they broke is now
[a restriction](../../../restrictions/cross-platform-surface.md) plus a standing rule in `CLAUDE.md`: a
feature ships on a phone and on a desk in the SAME change.

What that leaves for **01** below is narrower and sharper than it was: the controls now take a
finger-sized target where the pointer is coarse (`useCoarsePointer()`, ≥ 44 CSS px) and the clusters cap
their width on a compact layout, but **nothing has been checked at 360 CSS px on the real phone** — the
clusters sit top-left and top-right of the same map, the sheet under it, and whether all of that leaves a
usable picture is exactly what this chain measures rather than assumes.

## Steps

### 01 — 360 CSS px

**DONE 2026-08-25.** The step's own premise held: the surface loaded on the phone for weeks and the user's
verdict was *"impossible to control"*.

**What the render at 360x800 found, and none of it was visible on a desk.**

| | Before | After |
| --- | --- | --- |
| Layout width in a 360-px screen | **403 px** | 360 |
| Elements past the right edge | 33 (the map, both bars, the sheet, 4 nav keys) | 0 |
| Controls under 44 in either axis | 9 | 0 |
| Map height at 360x800 | ~350 px | ~500 px |
| Map height at 740x360 (landscape) | **98 px** | ~210 px |

**The width was one root cause, and it is the reason the controls were unreachable rather than merely
small.** A `1fr` grid track keeps `min-width: auto`, so it cannot shrink below the widest row in its column
— the top bar's content came to 403 px, the single column took that width, and the map cell took it too.
Everything anchored to the map's RIGHT edge then sat past the screen: `⟳`, `▼`, `BLK` and `−`, with no
scroll to reach them, plus the `Auto` switch and the `ASSIGNED` state on every call row. `minmax(0, 1fr)` on
every flexible track fixes it; the three full-width bars take `minWidth: 0` + `overflow: hidden` so they
give way instead of pushing.

**The target sizes failed in the axis nobody checks.** The `Touch` tokens carried `minHeight` and no
`minWidth`, so `Fit` was 40 wide and the rate keys 33 — passing every review that measures height. The
compass was 42x42 (its padding fit a mouse), the two sliders **16 px tall**, and `Auto-dispatch` was a
native `<input type="checkbox">` at **13x13** — which no inline style can reach, so it is a button with
`aria-pressed` now.

**The map had no room left.** The tool cluster was ~380x390 permanently open over a ~350-px-tall map:
nothing in it is used every few seconds, so it opens from one `TOOLS` handle. The nav cluster keeps north
and zoom out and folds turn, tilt and the three levels behind one key — folded, never removed, since a
capability that lives only on a desk is what this chain exists to prevent. The sheet is capped
(`maxHeight: 44vh`) on an `auto` track rather than given a fixed 44 % of the screen, which had left ~200 px
of black under two calls.

**Landscape needed a third question.** Width said 740 px is roomy; the viewport was 360 px TALL, and the
sheet at its cap left the map 98 px. `useShortViewport()` sits beside `useCompactLayout()` and
`useCoarsePointer()` for exactly the reason the restriction gives for the other two — they vary
independently — and the sheet opens collapsed there, both counts still on screen.

**How it was measured, and what it does not prove.** A headless Chromium in the agent container at 360x800
DPR 2 with `(pointer: coarse)`, probing every element for a box past the viewport and every control for a
box under 44. That is a real 360-px render rather than a feeling, and the user's own screenshot shows the
same clipping — but it is not the phone, and **feel, thumb reach and safe-area insets are still owed to a
device**. Safe-area insets and one-handed reach for the repeated actions (dispatch, clear, centre) are what
remains of this step.

**Guard:** `apps/dispatch/src/ui/styles.test.ts` — the bare-`1fr` rule and the 44-in-both-axes rule over the
style table. The restriction closed by saying nothing here was caught by a test and that a lint over these
literals could be written "when this bites a second time"; this was the second time.

### 02 — Gestures on real touch hardware

Touch has no wheel, no second button and no hover, so three of the five desk gestures were re-cast rather than
mapped (`apps/dispatch/src/map/gestures.ts`): one finger pans, two fingers pinch to zoom and drag to orbit, a
long press opens a call. The canvas carries `touch-action: none`, without which the browser claims the drag
before a single `pointermove` arrives.

Verify on real hardware, and specifically the failures a mouse never produces: the browser claiming the drag,
a long press racing a pan, a two-finger orbit read as a pinch.

**Owes:** a scripted check in the shape of `scripts/debug/touch-controls-check.ts` — which drives real pixels
and is the only check that covers wiring rather than the overlay alone — or a stated reason it cannot be
scripted for this surface. **Expect the second answer**: that script drives Playwright, which is
effectively unavailable on the development machine ([development/termux.md](../../../development/termux.md)),
so the realistic form here is the real phone's own browser against `npm run dev` and a human reading the
result. Add its row to [`docs/debug/`](../../../debug/README.md) if something scriptable does land.

### 03 — Legibility at city zoom

Chips clamp to the canvas today and calls drop their title below 620 px, but **nothing declutters**: at a
city-wide view the symbology collides with itself. This is a density and label-conflict problem, so it is
solved by the `dataviz` rules, not by adjustment until it looks acceptable.

**Owes:** a labels-per-frame budget and a stated rule for which label wins a collision — plus what happens to
the loser (dropped, deferred, collapsed into a count).

**DONE 2026-08-22 — and the budget turned out not to be a number.** All three answers, in the order the step
asks for them:

- **The budget is the screen.** A viewport holds `floor(area / chipArea)` labels and the collision index
  cannot place past it however many are asked for — **1371 on a 1920×1080 desk, 152 on a 360×640 phone**. So
  there is no constant to choose and none to retune when the chip font changes, which is the same shape of
  answer [8/04](../8-the-time-axis/readme.md) reached for trails.
- **Which label wins:** the operator's own priority, derived from the job. The selection first (they asked
  for it), then open calls **worst priority first**, then units **committed to a call** before free ones,
  and distance from the eye breaking every remaining tie. Colour carries none of it — the rank decides an
  ORDER and the colour already means a status.
- **What happens to the loser:** its **symbol still draws** — an icon is the datum and is never dropped —
  and only its name goes. The count reaches the operator (`namesHidden` in the readout, *"104 names hidden"*
  in the status bar), because a crowded map with no count is one an operator reads as complete.

The mechanism is [MapLibre's](../../../links.md), including **variable placement**: a chip that cannot go
above its symbol tries below, then either side, before it is dropped. The index is grid-bucketed for the
reason theirs is — at 150 units an all-pairs test is ~11 000 comparisons a frame.

**The measurement** ([the census](../../../benchmarks/opensa-engine/2026-08-22-dispatch-overlay-census.json),
150 units + 40 calls spread over the viewport):

| Viewport | Labels placed | Dropped | Ceiling |
| --- | --- | --- | --- |
| 1920×1080 desk | **179** of 190 | 11 | 1371 |
| 360×640 phone | **86** of 190 | 104 | 152 |

One rule, and the screen decides — which is what makes it work at both ends without a phone branch. Whether
86 of 150 names reads as *enough* in an operator's hand is a field verdict, and the lever if it does not is
collapsing a cluster into a count rather than dropping its members.

### 04 — The floor, measured

`apps/dispatch/src/world/plan-mode.ts` already runs the same camera, gestures, symbology and board on a 2D
canvas with a projected ground grid when WebGPU is missing entirely, with a banner saying what is gone. Verify
it **on the same real phone**, so "the world is gone; the dispatcher's job is not" is a measurement rather
than a claim.

**Owes:** the plan-mode run recorded beside the 2/03 row.

### 05 — The chrome tells the truth, and gets out of the way

**Opened and built 2026-08-30, on the operator's report**, and taken out of turn for the same reason 7/01
and 7/02 were: it needs no field run to start, and it is what every field run after it is read through.

The console's own chrome had three defects, and they are one defect: **a surface that states things it is no
longer measuring.** The person holding the phone is the instrument here — there is no headless browser and no
devtools — so a readout that is stale, a status that is a claim rather than a reading, and a panel that
covers the map are not cosmetics. They are the measuring equipment.

- **The frame rate was counted over the LOOP, not over the frames.** Since [4/01](../4-a-console-is-not-a-game/readme.md)
  the loop wakes every 100 ms when nothing has changed and draws nothing, and the readout was
  `1000 / mean(dt)` over the last sixty loop passes whether they drew or not. So a console at rest for six
  seconds reported **10 fps**, and then climbed back over the next sixty frames as the idle samples were
  pushed out of the window — every number real, none of them describing the frame on screen. And the
  interval that spans a rest was reported as a frame time.
- **The link status was a claim made once and never withdrawn.** `AGENT ATTACHED — keep this tab in front`
  was only ever entered on a poll that SUCCEEDED, and a failed poll reported nothing at all. A panel that
  died — the server restarted, ngrok dropped, Termux killed — left that sentence on screen in front of
  somebody holding their phone still because of it.
- **The metrics panel was most of the screen.** Fourteen rows of monospace over 360 CSS px, on the one
  surface whose whole subject is the map underneath it.

**What landed:**

| | Before | After |
| --- | --- | --- |
| `fps` | `1000 / mean(dt)` over 60 loop passes, drawn or not | a COUNT of frames drawn in the last second (`world/frame-clock.ts`) |
| frame time | not on screen | the median interval between two CONSECUTIVE drawn frames; `—` when the window holds no pair, never an invented `0.0` |
| cpu | only in the `?inventory=1` capture | `cpu N ms` on the desk bar — the number that survives a second with one frame in it |
| at rest | `idle` | `idle · 16.7 ms last`, because what the last frames cost is what a touch gets back |
| link state | `busy` / `held` / `released`, entered only on success | plus **`offline`**, and every reading stamped with when the panel last answered — the band counts that age up on screen |
| a command | `AGENT READING…`, whatever it was | one line per command saying what it does to this page, settling into `done` / `failed` (`ui/agent-notices.tsx`) |
| metrics panel | 14 rows, always | folds to its header; opens folded where the pointer is coarse, and the operator's choice is kept |

Two rules the fold had to satisfy, and they are why it is a header rather than a corner glyph. It may not
**hide a warning** — folded it still carries the frames, the frame time and a `⚠ n` count over the warnings,
errors and unavailable timings — and the whole header is the target, at the full 44 px where the pointer is a
finger ([cross-platform-surface](../../../restrictions/cross-platform-surface.md)).

The notices exist because of a report this repository has had more than once: *"the map jumped"*. An agent
flying the camera, an agent switching the whole surface from 3D to the flat plan, and an agent taking a
picture were the same sentence on screen, and a view that moves with no hand on it is indistinguishable from
a defect. The wording lives in `describeCommand()` beside the switch that runs the commands, so a new command
cannot be added without a sentence for the person whose phone it runs on.

**DONE on the device 2026-08-31**, through the panel's MCP channel with no number relayed by a person:
[the capture](../../../benchmarks/opensa-engine/2026-08-31-mobile-honest-frame-counter-150u.json), 150 units
on `los-santos-centre`, app `016c1e7+` — the `+` being the proof it ran this chrome rather than `main`'s
archive. **Three readings of one run, and the spread between them is the whole finding:**

| Read by | fps | frame |
| --- | --- | --- |
| the collector's own field (`1000 / mean dt`) | **10** | `dtP50` 100.6 ms |
| the new on-screen counter, mid-flight | **17** | 60.9 ms · cpu 10.3 ms |
| derived by hand over the 129 moving frames | **21** | p50 48 ms (p95 68) |

The old readout used the collector's formula, so it would have shown 9–10 here, and the heartbeat this page
sent while the map stood still read 8–9. **The fix is worth about 7 fps of truth on this device: the console
was under-reporting itself by nearly half while it worked.** The still-map reading came out
`idle · last cpu 8.5 ms` — no two consecutive drawn frames in the last second, so the bar named the body,
which is the fallback behaving as designed rather than a gap in it. `cpuMs` reads a real drawn body (10.3 ms)
rather than a wake's ~0.1, so the `drawnBodyMs` split holds on the device too.

**And the second owed item is now measured, and it is much bigger than this step first wrote it.** The
understatement is corrected here rather than quietly: it said the collector's `frames` and histogram were of
drawn frames only and that just `dtMaxMs`/`dtP95Ms` were affected. They are all of them affected, because of
the SCHEDULER. The collector genuinely never samples a skipped pass — the call sits behind the gate — but a
skipped pass arms the next loop entry with `setTimeout(IDLE_WAKE_MS)`, so the frame drawn after it carries a
100 ms `dt` that is 99 % sleep. On a live 150-unit board the console alternates draw/skip continuously, and
**706 of this window's 835 samples are that interval — 85 %.** So `dtP50` reads the idle poll, `dtMean`,
`outsideMeanMs` and `shareOfFrame` (2.3 %) describe a resting loop rather than a busy frame, and the segment
means are ~6.5× low in absolute terms while keeping their SHAPE (`overlay-2d` 1.33 ms against
`engine-frame` 0.33 still reproduces 1/01's finding).

This is not a new discovery and that matters: **the 2026-08-30 driven row already says it in its own note**
and derives its moving half from the histogram by hand, as do 08-23, the three 08-25 rows and the four
08-26 ones — every capture since render-on-demand landed on 2026-08-22 carries a large `framesSkipped` and
has had this done in prose. What it does NOT change: the 1/01 baseline of 2026-08-09 predates 4/01
(2026-08-22), so its `p50` 30.3 ms and its *"the frame is WAITING, not working — 21.2 % in the loop"* are
clean and stand.

**CLOSED the same day, in code, with the 08-31 row as its before.** The rule now has ONE owner:
`FrameClock.drew()` returns which kind of interval it was, and the collector is TOLD rather than deciding —
the status bar and a filed capture cannot disagree about which gaps were frames. `frame.*` is the frame
intervals alone, a new `rest` block carries the other population (`frames`, `meanMs`, `maxMs`, `totalMs`, so
`rest.totalMs` against `windowMs` says how much of a capture was rest on purpose), and `outsideMeanMs` /
`shareOfFrame` divide by the paced population — computed over every drawn frame they counted the idle wait
as time the frame spent outside the CPU, which reads as *"GPU-bound"* and was the loop sleeping.
`bodyMeanMs` is deliberately NOT restricted: a body is measured on the frame itself, so a frame drawn after
a rest ran a real one and only the gap around it belongs to no frame. The panel says the split on screen
(`rest 706 of 835 frames · 65% of the window`), so a window that is mostly rest can no longer read as one
that was mostly work.

**And the storage went with it, which is the second half of the same defect.** The collector kept every
`dt` and copied-and-SORTED the whole array on every `report()` — a report the panel asks for every 500 ms.
[Measured](../../../benchmarks/opensa-engine/2026-08-31-inventory-collector-storage.json): at 216 000
frames (two hours at 30 drawn fps, which is exactly [4/02](../4-a-console-is-not-a-game/readme.md)'s long
session) **one report cost 58.2 ms, so at 2 Hz the instrument was taking ~12 % of the main thread it was
reporting on** — and no capture ever said so, because the collector does not measure itself. It is a bounded
histogram now (2 ms bins to 100, 20 ms to a second, one tail; at most 96 entries however long the run) with
the count, sum and maximum kept exact as running scalars: **0.002 ms a report, and 1.65 MB of held samples
→ 0.** The price is a percentile that is a bin's floor — up to one bin low, never high — which is the
precision the analysis already had, since every row since 08-22 was read off these bins by hand. The bin
range is two resolutions **because a test caught it**: a single tail at 100 ms would have saturated `dtP95`,
and the 08-31 row's was 108.4.

**The AFTER was taken the same day** ([the row](../../../benchmarks/opensa-engine/2026-08-31-mobile-split-collector-after.json)),
and it did two jobs. It settled the before/after **on one window, arithmetically**: over all 527 drawn
frames the median lands at index 263 and only 46 of them fall below 100 ms, so the old collector's median
was a rest interval and its `fps` would read **10** — over the 47 intervals that are frame times it reads
**36** (p50 28 ms, p95 76), and `shareOfFrame` goes 1.5 % → **41 %**. The rest population is named rather
than derived for the first time: **480 frames, mean 103.74 ms** — `IDLE_WAKE_MS` plus the loop prologue —
which is **82 % of the 60.7 s window**. It is a STILL-MAP window (the `map_goto` answered but the pose never
left the opening one, and Android throttled the tab throughout), so it is not a device comparison against
the flown before-row, and the row says so.

**And it found the next layer down, which is why a field run is not a formality.** `cpu.bodyMs` is paired
one pass late on purpose — the body that ran inside the interval being reported is the previous pass's — so
when that pass was SKIPPED it carries the render gate's own ~0.2 ms. `bodyMeanMs` read **1.48 ms against a
real 13.84** (recoverable as `shareOfFrame` × `dtMeanMs`), with every segment ~11× low beside it.
`shareOfFrame` and `outsideMeanMs` were already right, because restricting them to the paced population had
incidentally fixed their pairing too — a paced frame's previous pass drew. The whole CPU block is restricted
now, `segmentsMs` divides by the paced count, and the test carries the field numbers. Everything else —
the streamer, the engine timings, the spans, the world — stays over every drawn frame, because those are
measured on the frame rather than paired to the pass before it.

**Owes:** a flown window on the phone, to give the device numbers a partner the before-row can be read
against. The collector question is closed.

## Verification

- Every check in this chain runs on the device from [2/03](../2-real-device-truth/readme.md), not on an
  emulator. The emulated Pixel 7 run stays in the record as what it is.
- The layout spec and the shipped layout agree.
- Contrast checked in both themes; priority never carried by colour alone.
