# Audit

Phase-conclusion audits: when a large arc closes, its outcome is written up here **once**, with the measured
numbers and links to the raw records — so the result survives the session and a later reader sees the verdict
without re-deriving it. Runtime numbers live in [`../benchmarks/`](../benchmarks/); these docs summarise and
interpret them.

- [`session-32-the-defect-our-own-decoder-could-not-see.md`](./session-32-the-defect-our-own-decoder-could-not-see.md)
  — the 2026-08-20 session after it: two named tasks closed, built, delivered and field-accepted
  (`mod-installer` 015, `cars-server` 003). Its subject is that the defect it fixed — a mod's PNG folder
  encoded DXT over rasters the game READS BACK, which turned every number plate into green blocks — was
  **invisible to every instrument we own**: our decoder decompresses DXT before composing, so the suite, the
  viewer and the plate renderer all showed a readable plate. Plus the census that priced the rule (18
  replacements of an uncompressed raster, 2 673 → 18 264 KB, +15.2 MB taken deliberately over a name list),
  and two measurements of mine that lied quietly — a timed-out `curl -o` serving the previous run's HTML, and
  a count done by eye that four documents repeated.

- [`session-31-the-day-the-field-corrected-three-of-my-rules.md`](./session-31-the-day-the-field-corrected-three-of-my-rules.md)
  — the 2026-08-20 session: two plan chains built end to end (`vehicle-installer` 014, `img-splitter` 002),
  **9 part-name clashes → 0** and **39 archive duplicates of ours → 0**, five `sa` builds and five field
  rounds. Its subject is the three rules of mine the field disproved: a car's parts are NOT the parts on its
  `carmods.dat` line (wrong in 22 places), `0x200000` does NOT excuse a missing collision model (both ids
  carrying it crashed, and the bit's real meaning was in our own plan 039), and one ModelVariations section
  per model keyed by NAME is wrong twice over. Plus two defects I introduced and caught the same day — the
  added fleet moving 35 ids, and the hack retired the day it was taken.

- [`session-29-a-hundred-and-fifteen-cars-that-were-never-there.md`](./session-29-a-hundred-and-fifteen-cars-that-were-never-there.md)
  — the 2026-08-19 session after it: **the whole of central plan 102 in one run** (`vehicle-installer`
  012–013, `tools/add-vehicles` 001–007, `asi/perfect-vehicle` 001–002). 115 added cars + 46 re-modelled
  tuning parts install into a built `sa` tree in 6.6 s, byte-identical on a second run; every value derived
  from the built data rather than a per-car table. Budgets: 161 ids of 999, TXD 5 338 of 6 000, the vehicles
  family 3.10 → 4.47 GB over 3 members, 31 `link` pairs against a ceiling this session lifted from 30 to 256
  with our own plugin (two functions of the exe replaced, complete by census). **Four silent defects fell out
  of it**, three pre-existing: `handling.cfg` refusing a digit-leading id (the car would have run STOCK
  physics), the palette merge appending the same colours every run against a 128-row table the build had
  already passed, `petro`/`towtruck` losing their trailers to a rewritten `Global`, and a failed run
  renumbering the fleet on retry. All four were found by one question — does running it twice change
  anything? **Then the evening**: the delivery would not start, and seven launches later the design had
  changed — an added car's ide and handling rows may not be baked into `data/` (they go beside the models for
  Mod Loader to merge), a mod file named after a stock data file is a REPLACEMENT, and four of my own
  hypotheses died on the way. The cars load; their tuning still crashes at the end of loading and is an open
  issue
- [`session-28-the-dummy-half-of-int16.md`](./session-28-the-dummy-half-of-int16.md) — the 2026-08-19
  session: perfect-map 011 from gate to field in one session — the int16 wrap WATCHED (`lastDummy` negative
  from slot 35 on the first entry), the fix (int32 dummy sidecar + two detours overlaid on FLA's), the ladder
  (8 entries at 100 000, 5 at 50 000, pool high-water frozen after entry 1) and the thing the 40 000 rung
  measured by crashing: the first entry alone occupies 41–49k slots against 33 043 map rows, so `Dummys`
  stays 100 000 and the pmb guard's blind spot is recorded. Second half: the 212-folder vehicles census
  (two unread file kinds), FLA's monthly window parked as an improvement, and **central plan 102 — added
  vehicles** written from the recon of his old tool: `tools/add-vehicles` 001–007, `vehicle-installer`
  012–013, `asi/perfect-vehicle` 001–002, the two `carmods.dat` ceilings his old build sat on
- [`session-27-three-crashes-two-of-them-ours.md`](./session-27-three-crashes-two-of-them-ours.md) — the
  2026-08-19 session: the suite's four-session red was an **O(n³)** in the translucent agglomeration (the
  ferris ring is 1 440 separate bulbs in one material group; 3 745 → 412 ms, output proved identical across
  all 4 605 tests); the LOAD GAME crash is **ours** — `CPool<CDummy>` is never released between world
  entries because `IplDef.firstDummy/lastDummy` are int16 and our asi lifts only the building pair, so the
  pool buys `floor(pool / 17 644)` loads per boot (field: 3rd at 50 000, 6th at 100 000) and `32767` does
  not boot, which makes perfect-map **011** the only exit; the tuning-part crash, older than the project,
  was one DFF in 2 096 whose frame list declares a parent after its child — fixed, guarded and
  field-accepted. Plus the entity-pool build guard, and the census error that hid it: `object.dat` writes
  `lamppost3,` with a trailing comma

- [`uv-repair-retired-and-one-report-per-target.md`](./uv-repair-retired-and-one-report-per-target.md) — the
  2026-08-11 session-3 close of the 025 arc: the field reversed the UV repair in one look (a partial repair
  of a continuous defect is patchwork by construction, and the mapping it writes is invented — no authored
  frame exists, fit residual ~1.8 UV), so the pass was retired the same hour and the problem shelved as an
  open issue (127 models). Then the branch merged (ff) and pmb plan 005 shipped the same afternoon:
  `report-<target>.json` per target with typed fragments, `.work-<target>`, the root `report.json` deleted
  after measuring it was a byte-identical 852 KB copy nobody read. Carries the lesson that should have been
  cheaper: the pass shipped in a build BEFORE its field round, against a restriction that already named the
  field as the gate.
- [`dispatch-engine-api-usage.md`](./dispatch-engine-api-usage.md) — the dispatch console against the ENGINE's
  own public surface, 2026-08-09. Written after a field capture asked a question the console's instrument
  could not answer and the answer turned out to be a number the engine had computed since 074/01 and the app
  was discarding. Two capabilities taken (the streamer's `StreamStats`, the residency `ledger()`), ten found
  and left with the step that will want each. The method is the point: read the PROVIDER's surface, because
  neither gap was visible in a review of the consumer
- [`procobj-budget-answered-and-a-knob-nobody-had-connected.md`](./procobj-budget-answered-and-a-knob-nobody-had-connected.md)
  — the 2026-08-10 close: backlog bands **P1 and P2**. P1 asked for the clutter perf budget and found there is
  none to give — at 3× vanilla the layer costs less than one sweep's A/A drift and never hitches, so the caps
  are limited by data and by our own `PROC_OBJ_MAX_DENSITY`, not by frame time. P2 asked for seven VALUES and
  found seven **dead constants**: `procobj[*].drawDistance` had a slider, a setter and a test, and no reader —
  clutter really drew at whatever its 256-unit cell reached. Now applied per instance in the clutter shader,
  100 (SA's own flat `PLANTS_MAX_DISTANCE`) as the floor and 300 for trees/cacti, measured monotone against a
  0.020 % control and free in frame terms. **Also carries a mistake of mine that reached a commit**: I named
  the wrong limiter for the density ladder (the data's spacing, when it was our own constant) by reading the
  curve instead of the function.
- [`procobj-permanent-rows-and-the-shape-that-could-not-fit.md`](./procobj-permanent-rows-and-the-shape-that-could-not-fit.md)
  — the 2026-08-10 late arc: the clutter layer's HD+LOD twin turned out not to fit SA **at all** at the shipped
  density (25 560 linked pairs need 13 inst-bearing areas; 12 exist), and binary streams could never have carried
  its range — `CIplStore` keeps a stream's slot resident only within **190 units**, so the layer drew to ~190 m
  while declared at 290. Replaced by ProperFixes' shape: one permanent row per object at `lod = -1`, range from
  the stock `procobj.ide` raised **59 → 299**. Entities 182 184 → **91 092**, binary IPLs 522 → **191**, and
  OpenSA's runtime scatter gets **95** rules back where a strip had left it 9. **Both field crashes on the way
  were caused by changes made in that session**, one of them by reading a number measured on one path as a budget
  for another — the same mistake as `EntityIpl`, twice in a day.
- [`sa-build-verified-and-the-guards-that-lied.md`](./sa-build-verified-and-the-guards-that-lied.md) — the
  2026-08-10 arc: the `sa` target builds end to end at 91 092 objects (10 m 9 s), and the int16 throw was not
  the only blocker — FLA's IPL pool fired at **522 of 280**, correctly. Raising it surfaced the opposite
  defect: the TXD guard had read 6000 against an install configured at 5000, so **the pool with one slot of
  headroom was the one reporting comfort**. Also: the two targets proven to be the same world on both halves
  (byte-identical input, 182 184 / 182 184 placements through the convert), the runtime clutter layer shown
  to draw nothing on a built map, and a mod's partial `.col` found deleting stock collision in silence.
- [`procobj-density-and-the-guards-that-guarded-nothing.md`](./procobj-density-and-the-guards-that-guarded-nothing.md)
  — the 2026-08-09 evening arc: build-time density became a per-category/per-surface profile with a raisable
  candidate ceiling, and three guards were deleted for guarding a ceiling the target lifted. **Four separate
  documents described a state the code was not in** — including "P1 is blocked", which had been fixed and
  merged days' worth of commits earlier. Also the instrument's floor per COLUMN: content 0.094 %, but `avgMs`
  saturated at the frame cap and `gpuMs.pass` at 13.37 %.
- [`vehicle-physics-081.md`](./vehicle-physics-081.md) — the plan-081 driving chain: `handling.cfg` went from
  5 fields consumed to 21, six global constants died, and the five bugs seven field rounds found were all the
  same mistake — a number guessed where the game ships the answer.
- [`vehicle-physics-081-instruments.md`](./vehicle-physics-081-instruments.md) — the 2026-07-27 instruments
  day: the regression pack, the vehicle slice priced at ~8 µs per car per step, surface types shipped — and
  four findings where the new instruments falsified the questions they were built for (the kerb scene never
  met a kerb; the flip that justified the work had stopped reproducing; `collisionDamageMult` scales
  nothing; the gate's own rule was wrong).
- [`vehicle-physics-081-closeout.md`](./vehicle-physics-081-closeout.md) — the same chain's close-out: air
  control ported from the original, wheels leaning the way their axle is authored, and a five-class sweep
  that found the tuning generalises with **no class factor needed** — while three more scenes turned out to
  measure something other than what they are named after. Also the number a tuning round needs: the vehicle
  slice repeats to ±5 %.
- [`ped-locomotion-feel.md`](./ped-locomotion-feel.md) — the plan-088 ped locomotion chain (both
  2026-07-24 rounds): a full modern locomotion + vehicle ingress/egress stack for ~zero runtime cost
  (blended sample 8.2 µs vs 6.0 µs; no render-side change) and +~100 unit tests.
- [`three-to-own-engine.md`](./three-to-own-engine.md) — the three.js → own WebGPU engine migration:
  runtime (~7× fps, same machine/content) and bundle (−12.8 % gzip despite adding a whole engine).
- [`cleo-basic-097.md`](./cleo-basic-097.md) — the plan-097 CLEO chain: six real mod scripts run
  unmodified on our own SCM VM for 465 µs/tick, gaps are declared DATA enforced by CI joins — and the
  close-out benchmark itself caught a ~3 ms/tick field tax (the `findNext` walk that never exhausted)
  plus a reporting lane that bypassed coverage.
- [`cleo-scripts-001-rhino-tracks.md`](./cleo-scripts-001-rhino-tracks.md) — the authored rhino track
  script (one day, three field rounds): 5.4× cheaper at peak and **114× cheaper in the frame with no
  tank in it**, artifact 2 628 B vs 34 114 B, two defects of the original fixed rather than copied —
  and the honest headline is that **the script was the small half**: three defects underneath it
  (reversed native-call arguments, a wheel roll the engine never published to scripts, a MARKER wheel
  inflated 23.5×) had to be fixed first, and none was findable from the script side.
- [`cleo-scripts-chain.md`](./cleo-scripts-chain.md) — the CHAIN's conclusion: **one script shipped, one
  WITHDRAWN**, and the withdrawal is the more useful result. Authoring against our own VM asked the engine
  questions nothing else asked and found FOUR live defects, the last of which — lamp anchors invented from
  the half-extents for any model with no lamp dummy — was the whole reason 002 had anything to smash. The
  pattern, having recurred three times in two days: **ask what the engine is doing wrong before authoring
  content that compensates for it.**
- [`vehicle-effects-089.md`](./vehicle-effects-089.md) — the plan-089 vehicle-effects chain (one day,
  five steps, six field rounds): two new engine capabilities (the dynamic one-shot particle lane and the
  first decal lane), four effects on SA's own assets, one new physics read born of a dead channel
  (Rapier's wheel rotation is cosmetic) — at zero measurable sweep cost, with every look number a
  documented eye-fit.
- [`sa-map-viewer-094.md`](./sa-map-viewer-094.md) — the plan-094 chain (eight phases, two days): the
  blue-strip hunt's A/B loop went from a **repack** to a **60 ms** browser weld with pixel-identical
  reruns, the whole map welds in 15.3 s, and the tool's first field use found both a defect in itself
  (`?panel=0` drew an empty world) and the strip itself — one placement, `roads32_law2`, whose every byte
  matches vanilla.
- [`modloader-removal.md`](./modloader-removal.md) — deleting the runtime `modloader/` overlay and the
  vehicle DFF fallback it fed: one package and a whole second vehicle pipeline gone (−1816 lines, the
  `vehicle-model.worker` chunk with them), coverage up on every metric, and roadmap item 2 closed by deletion
  instead of by measurement. Reasoning: [`postmortem/runtime-modloader-overlay.md`](../postmortem/runtime-modloader-overlay.md).
- [`video-mode-096.md`](./video-mode-096.md) — the plan-096 chain (eight phases, two days, three field
  rounds): `?video=1&seed=N` as a bounded, seeded, self-directed showcase, built on a road-route capability
  the game's own `NODES*.DAT` always carried and nothing read. **9 036 lines added, `packages/engine`
  untouched, and the host's whole footprint is 185 lines** — the shipped attach pattern holding for a third
  subsystem. Its per-frame cost is **under the timer's resolution** (mean 0.0172 ms over 22 817 frames). The
  lesson worth carrying: three of the four defects that mattered were found by a HUMAN watching footage after
  headless numbers had accepted the build, and each became a rule about what a metric cannot see.
- [`asi-sdk-extraction.md`](./asi-sdk-extraction.md) — the `asi/sdk` chain (five plans, one day): the ASI
  framework moved out of `asi/perfect-map` into a shared SDK, making `asi/` an sdk-plus-consumers category
  like `cleo/`. **perfect-map 1 499 → 705 lines** (497 of them its own subject matter; 179 the seam a second
  plugin must write), the roadmap's copy-verbatim list for `asi/city-life` is dead, and seven hand-copied byte
  arrays went to zero — the "a hand-edited address is structurally impossible" rule is now true rather than
  claimed. Field-confirmed on the real install (dry run + APPLY, both fixes installed with FLA/OLA present);
  the behavioural oracle is the one verdict still open. The method lesson: **the measurement rig failed more
  often than the thing measured** — two of three surprises were harness bugs, caught only by giving each row a
  verdict from a different channel than the number.
- [`plan-07-review-and-100-field-close.md`](./plan-07-review-and-100-field-close.md) — the 2026-08-08 review
  session: plan 07's density chain was costed against a number that counted STREAM RECORDS, not objects (24 552
  vs the real 15 286), and correcting it inverts the chain's conclusion — the int16 lift is back on the
  critical path, and a stock target has 1.18× of headroom in total. Three of its steps' premises were falsified
  by the code. Plan 100's owed field check then ran and passed three rows; the fourth, "is a plate readable at
  LOD range", turned out to be unanswerable by screenshot at ~8 px, so it got an instrument instead
  (`.oscell` minor 8 + HUD `signs N`). Also what the session got wrong: a census scoped by model id, a
  no-op mutation offered as proof, and a grep that hid `.tsx`.
- [`2dfx-at-lod-range-100.md`](./2dfx-at-lod-range-100.md) — plan 100 (five steps, one day): lamps, chimney
  plumes and street-name plates now survive past the HD ring instead of leaving a 560-unit dark, smokeless,
  blank-signed band, and every fx system draws for the `cullDist` it authors rather than one flat 300 (836 of
  878 anchors got 3–12× tighter). **The frame win the plan predicted is not there and cannot be claimed
  either way** — a positive control proved the bench cannot see the particle system at all. Three things the
  plan did not know were found by measuring: a plate's world position lands outside its instance's own cell
  131 times in 489 (now a restriction), steps 01 and 02 could not ship apart, and step 05 fixed nothing that
  was broken. The field check is owed to the chain's single rebuild. The audit itself found a debugger slider
  wired to nothing.
- [`plan-07-per-target-and-effect-distance.md`](./plan-07-per-target-and-effect-distance.md) — the session
  after: plan 100's last row closed (the `insects` floor is field-judged and **inert** — a 2 cm sprite is
  under half a pixel at its cull distance), the dead slider wired as a SCALE over the authored table rather
  than a replacement, `?fx=N` added as the positive control a distance capture needs, and the `prt_*` lane
  floored back at 300 u. Then plan 07 from three open decisions to none: `01` sized (both build-time caps
  zero nothing — MINDIST provably cannot — while the runtime cell cap zeroes species in 19.8 % of scattering
  cells, latent in the shipping build only because our own generator strips them), and 02/04 rewritten per
  target, then narrowed to TWO when stock SA was ruled out of scope — which retired the slot economy 04 is
  named after and left int16, ours, as the only ceiling. Two new instruments, and **both self-checks fired on
  their first run**: pak particle positions are cell-LOCAL, and "the cap is finite" is not "the cap binds".
- [`plan-07-target-selector-and-density-lever.md`](./plan-07-target-selector-and-density-lever.md) — 07/04's
  first two tasks shipped (the target selector, DERIVED from `--exclude` so no operator can forget it; the
  guard move onto the built `sa/` tree, which also fixed a false PASS nobody was looking for), and then the
  perf budget could not be taken. The knob built for the measurement **falsified the plan's density
  premise**: 3× the cutoff yields **+3.6 %** objects, because `cullByMinDistance` culls with the
  `procobj.dat` MINDIST column — four values map-wide, clustered by surface family, and documented by our own
  parser as the *draw* distance. The A/B also found the harness drifting further than the content (control
  scene +107 % triangles → a filed collision defect). The audit itself caught a NaN hole in the new guard
  that would have emptied the clutter layer in silence.
- [`bench-settle-fall-102.md`](./bench-settle-fall-102.md) — plan 102, the day the sweep learned to measure
  itself: A/A `avgTriangles` spread **10.19 % → 0.14 %**, `[cam]` jump lines **89 255 → 1**, and the density
  A/B re-taken to say **d1 ≡ d3** under the noise floor. The audit is mostly about what did NOT hold: two of
  the three red tests pinned less than they claimed (the suite chose a world where the distinction under test
  did not exist — a floor exactly under the capsule's feet), the replacement test written here **passed twice
  with the fix reverted** before the third form discriminated, and the ground-warp turns out to buy less than
  the plan said (the rest gate decides the leg-start state; the warp only halves the descent). Plus a ceiling
  nobody had noticed (`GROUND_PROBE_DROP` 60 m against an anchor 43.75 m up, silent when exceeded), a wrong
  diagnosis assembled from two correct systems, and one regression report that was a background process —
  caught by a scene that could not possibly have been affected moving with the rest.

- [`procobj-chain-closed-and-three-plans-that-were-wrong.md`](./procobj-chain-closed-and-three-plans-that-were-wrong.md)
  — 2026-08-11, thirteen commits: all seven procobj backlog bands closed plus plan 010's last task and
  `asi/perfect-map` 006. **Three plans' premises were destroyed by measurement and a fourth returned the null
  it had allowed for**, all in the same direction — `procobj.dat` is a finished design we were re-deriving,
  not raw material we had to correct. The species roster is guaranteed on both targets (through DIFFERENT
  gates, and that is forced), the shipped density profile is `base: 1` as a RESULT, the biome axis turned out
  to be a second name for the surface, and the `sa` build now both states the install it needs and ships the
  asi into it. Also two A/Bs invalidated by their own instrument — a dead site, and a player who slides
  downhill so no two arms share a viewpoint (the tell: three DIFFERENT comparisons returning 86.81/86.82/86.83 %).

- [`session-4-plan-hygiene-and-the-field-reports.md`](./session-4-plan-hygiene-and-the-field-reports.md)
  — 2026-08-11, fifteen commits, **84 docs and zero source files** (suite unchanged at 4 106, which is the
  point). Plan 013 closed on his procobj run (91 419 objects / 43 species / 110 382 rows, +327 on both — the
  check that the roster floor ADDS rather than swaps). Then: **178 phantom tasks removed from the plan
  record** — ten rendering chains closed since 2026-07-21 still carried 118 unticked boxes, and 074/080/081
  plus `opensa-pack/000` carried 60 more for work already shipped. **The sweep's value is what it did NOT
  touch**: 074/15 never happened (no `bakeNightLights` anywhere), vehicle lamp state and the near-shadow pass
  are verified absent, and two closures are STRUCK because nothing shipped is there to judge. Also: every
  deferred optimization now states its IMPACT, and most of that list cannot fix a frame. **The lesson is
  mine — twice I answered from the cheap signal instead of the authoritative one** (checkboxes instead of
  banners; one end of a lod link from each tree), and both cost a published wrong root cause.

- [`session-7-cutscene-override-twelve-rounds-four-traps.md`](./session-7-cutscene-override-twelve-rounds-four-traps.md)
  — 2026-08-13, 21 commits, one plan opened/rewritten/CLOSED the same day: the `cutscene-override`
  field instrument (cleo/scripts plan 003) — an ini-named cutscene plays at session start, warped to
  its `.cut` site with the world preloaded. Twelve field rounds, one variable each; **four SILENT
  traps became permanent records** (edge-cases/cleo-vm.md): the new-game boot race, the missionless
  intro, global operands as BYTE offsets (a slot number compiled fine and crashed the game), and
  failed CLEO ini reads CORRUPTING the target var — four rounds of "empty world" that looked exactly
  like streaming. SDK grew the `sa-only` target (the mirror of opensa-only) + string8 locals. Suite
  4 165 → 4 175.
- [`session-6-vehicle-cutscene-two-gates-nine-causes.md`](./session-6-vehicle-cutscene-two-gates-nine-causes.md)
  — 2026-08-12, ~21 commits (row added retroactively in session 7 — the file existed, the index row
  didn't): `tools/vehicle-cutscene` built from zero, plan 002 steps 1–7, BOTH field gates passed,
  nine emit root causes recorded. Suite 4 110 → 4 165.
- [`session-5-five-chains-closed-and-one-delta-that-cannot-exist.md`](./session-5-five-chains-closed-and-one-delta-that-cannot-exist.md)
  — 2026-08-12, nine commits, 33 files (three source, two test). Session 4's audit finished: the seven
  unverified chains resolved, six closed. **Nineteen of twenty-one open boxes were record, not work** — 097's
  six were a duplicate of a chain that had shipped beside its code (moved out, five references repointed),
  085's four were answered elsewhere in the same file, 079's one was already satisfied. The two real ones
  shipped: an F2 plate field that rides the placement, and the damage/detach lifetime pinned from both ends.
  **099 closed on numbers plus a delta that cannot exist** — cadence 0.225 s exactly and ~130 ns/advance off
  the built fixture, but the before/after arm renders zero frames (engine era vs pak era, proven from both
  sides of the commit pair), so a stated bound replaces it. **The lesson: a cross-reference is a claim about
  a file you have not opened** — two of them were false here, one calling dropped work "deferred" (082 → 098,
  which had never heard of it) and one calling done work "NOT CLOSED" (100's insects row, judged the same day
  in its hack file). Suite 4 106 → 4 110.

- [`session-8-vehicle-cutscene-chain-closed.md`](./session-8-vehicle-cutscene-chain-closed.md)
  — 2026-08-13, 11 commits: the chain the override was built FOR, closed in one day — 002 steps 8–11
  (bike FIELD-PASSED first round via STRP4B2; boat structurally verified with the field gap NAMED —
  no stock scene plays csdinghy; fleet numbers into the NEW `docs/benchmarks/tools/` family, 23/23
  in 3.55 s; pmb `cutscene` stage right after `vehicles`, dropping out loudly with it) + plan 003
  plates FIELD-PASSED first round (the engine's recovered formula REUSED; readable plates where
  vanilla shows blanks — the demonstrated improvement). Two first-round field passes, each an ini
  edit instead of story progression. Also fixed: `tools/vehicle-cutscene` missing from root
  `workspaces` (the enumerate-everything trap in package.json). Suite 4 175 → 4 203. Remaining:
  the step-11 full-pipeline field acceptance (needs a build without `--exclude vehicles`).

- [`session-13-img-archive-split.md`](./session-13-img-archive-split.md)
  — 2026-08-15, the day `models/*.img` stopped being one file content could grow into. The `sa` build
  was asked to include mod vehicles for the first time and died mid-stage at 2 168 825 856 B:
  `vehicle-installer` rebuilt the whole archive PER CAR through `writeFileSync`, which caps at 2 GiB.
  Fixing that produced a 4.27 GB archive **no reader in the repo can open** — `readFileSync` throws
  `ERR_FS_FILE_TOO_LARGE` — so the answer became a typed, size-bounded layout: `tools/img-splitter`
  classifies by the IDE section a model's row sits in (plus `carmods.dat` for the 190 mod-shop parts,
  the user's correction, which dropped contested entries 12 → 1), the writer caps at 1.75 GiB and
  spills into siblings, and a shared INDEX answers where a file lives instead of every tool opening
  `gta3.img` by name. Three guards where there were none, and **three of my own guards were wrong until
  the output was read** (a dead duplicate check, a merge an eslint reformat had silently unhooked, a
  double close) — the suite was green through all of them. The ASI lift researched for the archive table
  turned out unnecessary: the shipped shape registers 8 of 8, so the ceiling was never reached rather
  than lifted, and it is deferred as an `in-reserve` card whose trigger the build's own guard names.
  Suite 4242 → 4290; `sa` end to end 655.9 s with vehicles, the fleet and both asis.

- [`session-12-cutscene-fleet-closed.md`](./session-12-cutscene-fleet-closed.md)
  — 2026-08-15, the day the whole cutscene chain closed: the sweep finished **35 of 35** and plans
  002, 004 and 005 were APPROVED and CLOSED. Two fixes came out of the last rows, and neither was
  what it looked like. Round 23 put lamp lenses back on the vehicle pipe — round 9 had moved every
  translucent atomic off it after measuring OUR DFF stamp rather than the runtime `CustomCarPipe`,
  and for two days the whole fleet's lamps rendered without their shine while **the sweep accepted
  it**, for want of a reference. Plan 005 gave the tool a lever for a class of defect no model data
  can reach: R\* seats every cutscene actor at their OWN car's `ped_frontseat` (within 0.02 m in x,
  0.03 in z, measured on two cars), so a taller donor sat them 0.281 m low — patched in the scene
  values, ramped across the frames an actor spends getting in or out. Three of my hypotheses died in
  the field first, each supported by a real measurement of the wrong quantity. Suite 4242/4242, one
  hack recorded, build 3.55 → 4.26 s.

- [`session-11-cutscene-glass-two-defects.md`](./session-11-cutscene-glass-two-defects.md)
  — 2026-08-14, the day the cutscene-glass arc closed and the symptom turned out to have TWO causes.
  `asi/perfect-cutscene` shipped its fix (one repointed call sends cutscene cars down the sorted
  entity pass gameplay vehicles already use; the classifier is the engine's own skinned-clump actor
  test, because every cutscene model reports the same model TYPE), the pane-suppression hack was
  RETIRED, and a converter bug was found underneath it: a mod shipping window geometry without
  `rpGEOMETRYMODULATEMATERIALCOLOR` renders solid on RW's default pipe while gameplay's vehicle pipe
  hides the mistake — one model of 23, and exactly the panes the field called matte. Four hypotheses
  died first; both decisive controls (pull the plugin, look at the same car in gameplay) were the
  user's. Two ASI payloads were built and deleted after field rejection. Suite 4222/4222, merged ff.

- [`session-10-cutscene-sweep-rounds-13-19.md`](./session-10-cutscene-sweep-rounds-13-19.md)
  — 2026-08-14, the sweep's runtime-law day: seven rows closed (17/35 ✅) through rounds 13–17,
  recovering TWO runtime laws from gta-reversed + field (the rotation law — un-animated frame
  rotations are rewritten to identity every tick, so shims/adopted frames carry translation only and
  rotation residuals bake into vertices; the entity-order roulette — a rendered window pane z-writes
  over scene actors drawn after the car, which gameplay solves only for CVehicle entities). Wheel
  container precedence, the mixed-translucency split, anim-pose wheel corners, and the per-slot
  window-pane suppression hack (the user's option C) landed on the way; rounds 18–19 (washington
  eraser, the wheel stash) were measured to root cause and routed into the NEW
  `asi/perfect-cutscene` project, whose plan 001 ends by retiring the hack and re-sweeping all 35
  rows. Suite 88/88; the ledger's tail (rows 20–35) deferred to that post-ASI final acceptance.

- [`session-9-cutscene-sweep-rounds-3-12.md`](./session-9-cutscene-sweep-rounds-3-12.md)
  — 2026-08-13, the plan-004 sweep's heavy day: six ledger rows closed (10/35 ✅) through ten field
  rounds that recovered THREE render laws of the SA cutscene path (atomics draw in file order with
  z-write on → panes emit last, vanilla's own windscreen_ok-last layout; the vehicle PipelineSet is
  the gameplay shine AND drops translucents outside a CVehicle → stamped on fully-opaque atomics
  only; lamp ID markers render raw → baked white like vanilla) plus the VehFuncs selector semantics
  (`<name>:K` chosen path, `no*` = authored off, year options vs year alternatives via
  `reoffersCarried`, the whole multi-mesh f_wheel). One wrong-mechanism fix (glass-alpha clamp)
  taken and retired the same day, recorded as such. The field method is now
  `docs/development/cutscene-field-testing.md`. Suite 79 → 81 tool tests; no per-model hardcode
  (grep-checked at the user's ask).

- [`session-24-the-app-meets-windows.md`](./session-24-the-app-meets-windows.md)
  — 2026-08-18: the exe session 23 built was finally RUN, and both defects it found were invisible from
  here. A STALE artifact (the asar carried the step 1–2 build, packed half an hour before the wizard) read
  as a broken app, because nothing named the commit it came from — every build now stamps its own short sha
  into the footer. Then the BLACK WINDOW at the end of a correct run: a concise-body `useEffect` returning
  `scrollIntoView`'s value, which React called as the cleanup and unmounted the tree over finished work
  (`docs/restrictions/architecture.md` records it, with both candidate lint rules measured and refused).
  The renderer got its first lane, `scripts/debug/cutscene-converter-drive.ts`, which reproduced the crash
  in seconds. Plan 002 is DONE, all eight steps: status line + Exit, the tutorial (`docs/tutorial/`, no
  per-version folder), release 0.4.0 recorded — distribution is the user's own hosting, deliberately not a
  GitHub release. Windows: cold start ~5 s, conversion ~2 s.

- [`session-23-validation-package-and-the-cutscene-converter-app.md`](./session-23-validation-package-and-the-cutscene-converter-app.md)
  — 2026-08-17: the standalone-app chain, the first thing this repo builds for people who will never clone it.
  `@opensa/validation` (the verdict SHAPE — `fix` is required on an error at the type level — plus generic
  path/file checks; the 9 ms game+exe gate) and `apps/cutscene-converter` (Electron, plan 002 steps 1–5): an
  84.8 MB portable exe cross-built from macOS with no wine, the plugin embedded at build time with a build
  that REFUSES without it, and a facade proved byte-identical to a CLI run of the same inputs. Three findings
  to remember: electron-builder packs the workspace ROOT's runtime deps (18 MB of asar this app never loads),
  npm 11 blocks install scripts by default, and a package's LAYER follows its `nx.tags`, never its folder.
- [`session-22-anim-frames-in-the-cell-lod-and-translucent-clusters.md`](./session-22-anim-frames-in-the-cell-lod-and-translucent-clusters.md)
  — 2026-08-17: the OpenSA cell LOD placed an `anim` def's atomics without their DFF frames (the Burger Shot's
  sign in the middle of the roof at LOD range; now composed like the engine's weld and the `sa` clone LOD);
  the comet's speakers back through the rear glass from one angle = a SCATTERED translucent submesh no sort
  key can serve (dash gauges + shelf speakers, one material) — the builder now emits translucent groups per
  spatial cluster. Both through the one-model instruments, both field-accepted the same afternoon; `build/`
  wiped and rebuilt fresh after.
- [`session-21-wheels-vehfuncs-extras-and-the-fixture-cache.md`](./session-21-wheels-vehfuncs-extras-and-the-fixture-cache.md)
  — 2026-08-17: two field cars with no rims = a `f_wheel` container wheel instanced by its first atomic (now
  its whole chosen path); VehFuncs recursive extras become a per-spawn runtime pick from a tree the `.osm`
  ships (59 of 213 cars drew every variant at once); IDE/IPL rows split like `LoadLine` (three mods'
  comma-less rows had doubled ids in the built `vehicles.ide`); the fixture folder renamed `fixtures/`, fully
  uncommitted, custom fixtures cached in the local `fixtures-src/`, regeneration proved byte-identical and
  found four fixtures no manifest line produced. Field-accepted the same day.
- [`session-20-cars-server-layers-and-the-first-real-resume.md`](./session-20-cars-server-layers-and-the-first-real-resume.md)
  — 2026-08-17: cars-server follows the vehicle layers (a car's screenshot from its OWN layer only,
  `cars:sa`/`cars:opensa`, missing pictures as a warning naming the file to save); the pmb leftovers closed by
  the first REAL killed-and-resumed build, which found two bugs the e2e had not (a resume refused over a
  consumed chain dir; a TC without `cutscene.img` dying on the raw ENOENT) — fixed, resumed pak byte-identical
  to an unbroken run; per-class pack checkpoints put in reserve with a named trigger.
- [`session-19-instruments-resume-and-the-frame-regression.md`](./session-19-instruments-resume-and-the-frame-regression.md)
  — 2026-08-17, the tool round: the "new/ car not installed" was a stale bottle; `--rebake --kind sa` (a car
  in 4 s), `tuning_new_parts.txt` + the carmods guard (the boot crash `0x4C4576`), layered vehicles/peds through
  the one planner, the mod-installer DXT warning, the OpenSA one-model lab with its LOD half, `rewriteModelArchives`
  per family (the build that died at its last step) and pmb `--resume` with per-chunk weld checkpoints
  (byte-identical resume); closed on `bench=all` of the full high-poly fleet build — GPU pass ×2.5–3.3, four
  arms, not the cars, open issue.
- [`session-18-burger-joint-and-dxt-dimensions.md`](./session-18-burger-joint-and-dxt-dimensions.md) — the
  2026-08-17 close of the LOD issue's last two vectors, zero rebuilds: the "burger joint" was a multi-atomic
  `anim` HD byte-copied into an `objs` LOD (SA keeps ONE atomic, at the origin — merged now), and the "mods"
  hospital group was five clone dictionaries + one mod TXD carrying a DXT texture with a side not divisible by
  4, which the real game refuses WITH its whole dictionary (pow2 everywhere we encode; the optimizer resizes
  any such texture in the tree). Both field-confirmed by one-entry swaps; whole-tree acceptance pending.
- [`session-17-binmesh-split-order-not-normals.md`](./session-17-binmesh-split-order-not-normals.md) — the
  2026-08-17 close of the "normals × repeat textures × SkyGfx" vector: seven single-variable field probes,
  each a one-model in-place swap (seconds, no rebuild), landed on the rebuilt BinMesh's SPLIT ORDER — a
  blended split moved out of last place, which the install's SkyGfx dual pass turned into a smear. Fixed at
  the root in `rebuildGeometry`, normals kept; the fork's building pipe recorded down to its compiled
  shaders; the same class in merge writers named and left open.
- [`session-15-models-new-and-the-slot-that-was-a-bodykit.md`](./session-15-models-new-and-the-slot-that-was-a-bodykit.md)
  — 2026-08-15, 15 commits: **`models/` + `new/`** (vehicle-installer plan 007 — a candidate replaces the
  `models/` car holding the same SLOT, resolved by ONE shared function because the installer and the
  cutscene census read the same folder) and **`cars-server`** (`npm run cars` — a local page of what the
  fleet replaced). The restructure had already broken the toolchain silently: every reader saw three cars
  called `models`, `new` and `screenshots`, found no `.dff`, and did nothing — `--inspect` reported **0 of
  23 slots ready and exited 0**, now 23/23, with the flat path byte-identical across the change. The
  serious find: the slot the install RECORDED was the first `.dff` in the folder, which for **10 of 212**
  cars is a bodykit part (`flash` → `exh_a_f`; `voodoo` and `slamvan` both → `bbb_lr_slv1`), so video mode
  never saw those slots as modded and `--rebake --only flash` matched nothing. The audit itself found three
  more: a test that only just fit its 5 s timeout (failed 4 runs in 5 under load), a `packages.svg` stale
  since two tools were added, and a fixture manifest resolving 104/120 because mods move and get
  renumbered — now found by NAME. Suite 4 313 → 4 358.

- [`session-14-layered-mods-and-the-delivery-shape.md`](./session-14-layered-mods-and-the-delivery-shape.md)
  — 2026-08-15, 14 commits: `vehicle-cutscene --no-base-copy` (plan 006 — 1.72 GiB of game tree down to
  579 MiB and three files, byte-identical to the copy run, which is what lets pmb and the standalone app
  share one converter) and **layered mod folders** (mod-installer plan 011 — `common/` + `sa/` + `opensa/`,
  applied common-then-target; a flat folder proved byte-identical across the change). The structural
  finding: the `mods` stage sits in the chain both targets SHARE, so a layered folder in a both-target run
  is refused at config time. The migration of `original` then exposed two collisions no listing can show —
  a train mod's baked IDE holding two ids Map Fixes Pack had already placed (int16 literals in its
  compiled CLEO, so unrenumberable; the mod was dropped) and seven `gta3.img` entries from an interiors
  mod — both closed, and a whole-set id scan cleared the remaining 131 mods. Two debug scripts kept
  (`mod-layer-conflicts`, `mod-id-collisions`) and two real bugs fixed in the `renumber-mods` skill. Both
  of my own instruments lied first (a 64 MB short-circuit; `2dfx` floats read as model names), and the
  wall-clock A/B was abandoned rather than published — the mod set changed under the measurement.
  Suite 4 290 → 4 313.

- [`session-25-two-lanes-and-the-price-of-the-fleet.md`](./session-25-two-lanes-and-the-price-of-the-fleet.md)
  — 2026-08-18: the GPU-pass "×2.5–3.3" closed on its first step — one UNCAPPED headless sweep showed the
  same-lane pak delta is ×1.1 on the scene that "tripled"; the issue had read the user's display lane against
  Claude's headless one, and his own lane already carried the number on 08-09. Two A/B builds of his design
  then priced the fleet whole: the high-poly cars are +1.0..2.6 ms of pass in the city and ~700 draws, the
  whole map's growth since 08-09 is +0.0..0.5 ms, `country-dusk` moves in no arm, and the `cellVertex`
  counter turns out to hold the cars. The draw-batching lever got its price and a four-step build-time route
  (−36 % opaque draws by a same-state weld, per census) — parked. Vehicle-installer plan 011 was written:
  `features.txt` reaches the real game through fastman92's `model_special_features.dat`, the 15-token
  vocabulary becomes shared data, and 098/02+06 gain a module and an oracle.

- [`session-26-features-reach-the-real-game-and-a-delivery-that-reverted-the-install.md`](./session-26-features-reach-the-real-game-and-a-delivery-that-reverted-the-install.md)
  — 2026-08-18: vehicle-installer plan 011 BUILT and field-accepted in one session — a mod's `features.txt`
  now reaches the real game as `<model> <stock carrier>` in fastman92's `model_special_features.dat`, and the
  field answered the question the desk could not: FLA remaps a STOCK model id, read per boot. Then the same
  delivery stopped the game booting, and the cause was not the plan: copying the whole tree ROOT put
  `mods-src`' adjuster ini in the install, reverting the FLA ID pools to `5000 / 280 / 256` against 5 177 TXD
  archives — heap fault at boot in an unrelated `free()`. Six hypotheses were falsified first, while the two
  facts that named it (the build report's own `requirements` table and FLA's `Number of memory changes made`)
  sat unread on disk. Closed with the ini raised, the delivery trap written down, and the CLASS closed too:
  the id-pool guard now reads the pools off the ini the build ships instead of carrying constants. A full
  rebuild proved the pipeline byte-deterministic; a modloader-off arm found a second, real defect (a folded
  mod `inst` row read before the mod IDE that defines it) and left it as an open issue. **Part 2** of the same
  day: two new map mods scanned, stripped of their 21 conflicting DFFs and numbered into `common`; a mod's full
  stock IDE converted to one `.ide.merge` with a chunk-spliced superset TXD; and three rounds on
  `vehicle-optimizer` that ended in the install's SkyGfx source — its car pipe multiplies the reflection
  intensity by 8 (so ≥ 0.125 saturates) and the SPECULAR level by 3, and the specular was the term the field had
  been looking at all along. Two of the three rounds were my own wrong turns, reverted by measurement.
- [session-30-four-defects-and-only-one-where-we-were-looking.md](session-30-four-defects-and-only-one-where-we-were-looking.md) — the plan-102 field round: the loading crash was our own `Vehicle colors = 256` (four launches lost to a revert that was written down but never performed), every `.fxt` was landing in a folder CLEO does not read, unresolvable `{{name}}` placeholders now drop, and two open defects that share one shape — a name or a slot belonging to one car handed to another
- [lod-trees-013-impostor-parity.md](./lod-trees-013-impostor-parity.md) — the tree-LOD impostor chain (plan 013, closed and field-accepted 2026-08-22): what each of the four named causes turned out to be (the dominant one was the alpha CLASS, not the card count), the per-target cage rule the field forced, the card alpha solved per tree rather than fitted, and the price — the `trees` stage ×8.5 for a runtime that got CHEAPER (sa impostors 16 → 6 triangles, sweep mean −1.9 %). Also the direction it deleted: phase B and its ASI, measured away rather than built
- [session-39-two-plugins-one-format.md](./session-39-two-plugins-one-format.md) — 2026-08-22: plan 104 closed end to end with NO build run. The plan was written to "support a second 24h timecyc format" and there is none — two 24h plugins exist, each hardcodes ONE file name (the only such string in its binary), and their `.dat` files are the same 23 × 24 × 52 schema; swapping them fails because the plugin never finds its name. What the work actually bought: one resolver behind three names, a boot line naming the winner, and — recovered from the reversed source rather than fitted — that SA hands `FogSt`/`FarClp` straight to D3D9 LINEAR fog with no clamp, so **our `max(0, …)` had been discarding STOCK's own near haze on 112 of its 504 rows**. The field kept Dante's table and rejected only his fog, so the opensa target now ships his columns with stock's fog pair, the recipe pinned as a test. Cost: +0.17 % mean frame on an engine-only A/B over the same pak, +1.53 % of the world pass on a fog scene in six alternated runs. Also: three measurements nearly recorded wrong, and a golden test that named an external reference while comparing a function with its own output
- [session-38-a-crash-the-data-was-asking-for.md](./session-38-a-crash-the-data-was-asking-for.md) — 2026-08-22: lod-trees 013 CLOSED and field-accepted on both targets (sweep −1.9 % mean frame), and a reproducible `0x007F0BF7` traced from the stack dump's upgrade id (1012/1005 — hood scoops) to the rule behind it: a replaced car inherits the stock `carmods` line and is offered a kit its model was never adapted to. Stock SA breaks that rule 0 times in 77; our tree did 30 of 154. Also the `gta.dat` definition-order fix verified on the build (137 → 0), the merge writer's blended-last rule, and a failed pmb run that stops leaving the previous run's numbers on disk
