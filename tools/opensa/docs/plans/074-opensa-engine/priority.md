# 074 — Priority order: from here to "real OpenSA drives on the new engine"

The single ordered list of what remains, in the order I would execute it (2026-07-12, end of the Fable
session). Each step names its plan doc, why it sits where it sits, and what "done" looks like. Three
milestones structure it: **A — the whole map is deliverable · B — the player lives in the world ·
C — the flip and the endgame.**

Current state (end of 2026-07-13): milestones A and B1–B4 are DONE/PARKED — the FULL map converts in one
command (~30 s bakeless incl. clouds+water; 202.6 s with shadow bakes) and streams everywhere; the PLAYER
walks/runs/jumps in the real app with prod HUD/zones/pointer-lock and in-game benches (all 6 scenes
vsync-120); Safari smoke ✅; the config-API parity module ships prod tunables to the engine; water v3
PARKED as leftover (0.6.0 plan).

**NEXT — the ladder (updated 2026-07-16; 09 SHIPPED, the look round is running):**
① ~~map-optimizer normals batch~~ ✅ (2026-07-15) → ② ~~09 COMPLETION: ACES + bloom + tiers~~ ✅
**FULLY SHIPPED + benched 2026-07-16** (ACES ≈ free; post chain 1.05–1.25 ms ≤ 3 ms budget; renderScale =
the ONE tier knob — msaa/bloomq field-tested and removed; series rows 09·ACES/bloom/post-fix/tiers) →
**③ the LOOK ROUND** — sky rounds 1–3 shipped (dawn/dusk accepted) → **SKY v2 CLOSED, field-ACCEPTED
2026-07-17** (Hosek-Wilkie LUT · painted panorama retired, then fully REMOVED same day on user command
(row 15 dome path deleted engine+converter, docs/licenses gone — see the 06 ledger row-15 banner) ·
procedural cirrus/cumulus with per-weather identities · cloud-field bake · softened horizon projection ·
prod WeatherTransition wired — see the readme handoff + 06 ledger row 4). **FOG = plan [21](21-fog-draw-distance.md) — ARC CLOSED, all phases FIELD-ACCEPTED 2026-07-17** (fog ⊂
LOD-ring invariant + drawDistance knob + distance cull + fog-into-clouds + 2-create/velocity-prefetch
with `lateCreates 0` field-verified; bonus: the vehicle-model build worker killed the new-car-type
freezes; ritual sweep row + `?draw=` sweep owed as formalities) → then the
deferred verdicts (16 paint / 17 lighting / hd-realtime concept) → ~~the WebGL-prod `?bench=all`
baseline~~ ✅ **CAPTURED 2026-07-17** (road cars wired into canvas-host, same 841-car population; prod
13.5–26.8 fps on land vs engine 120 Hz everywhere — series.md § C1 WebGL-prod baseline) → C1.
B5 vehicles ✅ → **B5r VEHICLE REFLECTIONS — v1 SHIPPED but REJECTED in the field; the deep rework is now
its own plan, [16](16-vehicle-paint.md)** (the gap is structural: no tonemapper, no environment probe — both
of which the three path HAS, which is why prod looked better. Not a tuning problem) → B6 2dfx particles +
textured coronas →
**B6.5 MAP-LIGHTING BUGS — see [17](17-map-lighting.md). Round 1 attempted 2026-07-14 and FULLY REVERTED**
(per-pixel 2dfx lamps fixed the polygon-shaped light patches but cost 120 fps → 25; prod affords per-pixel
only because its pool is 12 and ours is 64). The plan carries the measurements (12 004 of 12 964 map models
ship NO normals; SA's authored light ranges; the 14 % of lights that illuminate nothing) and the two open
blocker: **why prod renders the same map clean on identical data**. (The feared 120 → 90 fps regression was
CLOSED — it was the experiment's PAK left on disk, not any commit; B5/B6 cost nothing.) Original scope: (user, 2026-07-14: the world-lighting oddities that surfaced while field-testing
the headlights — the per-vertex pool artefacts were only the first; collect and fix the rest) → B7
destruction objects → B7 animation objects → then the WebGL-prod `?bench=all` baseline and the C1 criteria
run → flip. C2 cleanup stays GATED on an explicit command. B6/B7 are prod-PARITY gaps (prod renders all
three classes), so they land BEFORE the C1 parity sign-off, not after it.

---

## Milestone A — the whole map is deliverable

**A1. meshopt + brotli wire compression** — ✅ DONE 2026-07-13 (14 ledger: geometry 4.23×, full-LS
497.5 → 311.2 MB ≤ the 400 MB gate; worker-side decode NET faster than deflate-only; brotli deliberately
skipped — serve-time `Content-Encoding: br` remains) · size M
Geometry is the measured 82 % of the 1.15 GB full-LS pak; this is the top lever and it touches the format
boundary (encode in `opensa-pack`, decode in the pak worker), so it lands BEFORE more paks get produced.
**Done:** full-LS pak ≤ ~400 MB on the wire; decode adds < 1 ms to worst cell create; bench unchanged.

**A2. Bake worker pool + chunked welding** — ✅ DONE 2026-07-13 (14 ledger: full-LS --bakes 939 → 532 s,
peak RSS 16 → 5.2 GB; serial ≡ pooled SHA-identical; chunk ring = 2 cells ≥ the 400 u sun ray; bakes are
OPT-IN since the same day — `--bakes`, quarter-of-cores default) · size M
Bakes are 91 % of convert time (parallel per cell); welding the whole map cannot hold in one 16 GB heap
(one city already held it). Chunk = region-sized weld scratch with an overlap margin for the bake BVH.
**Done:** the FULL original map converts on the M3 in one command, wall-time recorded (~target ≤ 15 min).

**A3. Full-map pak in the standalone page** — ✅ CORE DONE 2026-07-13 (first FULL-MAP pak: 71.4 s
bakeless, 1121 entries, 769.7 MB wire, `?src=pak-map` in the lab/standalone/game; whole-map `?bench=map`
tour committed to the series — max 14 ms. REMAINING here: the `--bakes` full-map convert and the 30-min
soak) · size S
Convert the full map (A2), serve via range-reads (already landed), fly SF→LV→LS in `opensa-engine.html`.
This is the "whole world on the new engine" demo and the long-haul streaming soak in one.
**Done:** cross-map flight, no leaks (ledger returns to baseline after unload-all), `city`-style bench rows
recorded per region; the M1 stress tails (whip/teleport/30-min soak) close here too.

## Milestone B — the player lives in the world

**B1. Skinning probe — own IFP sampler** — ✅ DONE 2026-07-13 (08 probe note: own sampler + storage
palettes + dynamics vertex-layout family; FIELD ✅ animated ped; the riskiest unknown of the chain is
retired) · size L
Own skinned-mesh path: DFF skin data → engine skinned pipeline (bone matrices in a storage buffer), own IFP
keyframe sampler (three's AnimationMixer is not portable). Probe = CJ idle/walk cycle rendering in the LAB.
**Done:** one animated ped at 120 Hz; the pipeline count stays enumerated; sampler unit-tested against
known IFP curves.

**B2. Dynamic entity API + vehicles** — ✅ v1 DONE 2026-07-13 (rigid-entity layer + vehicle fixture:
parts/wheels/4-colour carcols/lamp day-night texture twins/26 verbatim dummies; light pool 06 row 7 with
headlight producers, bench row accepted. REMAINING in 08: lamp state on braking, headlight cones v2,
chassis_vlo LOD, ok/dam) · size L
The engine grows a small dynamic-object layer next to the static cells: per-frame transforms (storage
buffer), rigid part hierarchies for vehicles (doors/wheels), the entity HANDLES that plan 10's audit said
will replace three mesh refs in gameplay code. Local light pool (06 row 7) lands here — its producers
(headlights/brake lights) finally exist.
**Done:** a drivable-looking vehicle + walking ped rendered by the engine in the lab, moved by game-style
transform updates; light pool lit at night.

**B3. Game boots on the engine (integration phase 2)** — ✅ v1 DONE 2026-07-13 (FIELD ✅: walk/run/jump
around Grove Street with `?engine=opensa`; physics/collision/input REUSED, shared runtime Config, ped-probe
player, data-driven feet. Timecyc driver ✅ 2026-07-13 — the SHARED config→Environment driver
(engine-environment-driver adapter, litFade-dynamic arcs, prod tunables preserved; plan 10 config-API task
closed same day). Zones/HUD + pointer lock ✅ 2026-07-13 (reuse-not-duplicate: prod's DOM <Hud> narrowed to
a HudGame surface — the three Game satisfies it structurally; ZoneNameSystem + info.zon/gxt loaders shared
via ui/zone-data.ts; click = mouse capture, Esc frees, pause exits the lock). In-game benches ✅ 2026-07-13
(`?engine=opensa&bench=<key|all>`: prod's BENCH_SCENES + samplePath reused, host-specific harness —
physics.teleport anchor, per-scene weather via the shared driver + dome crossfade, settle→warmup→timed
capture of engine stats, SAME `[bench] {json}` console protocol → C1 compares own-engine vs WebGL rows
directly). **B3 is now FULLY closed** — next: vehicles-in-game (entity handles), water v1, C1 criteria run) ·
size L
`Game.create` grows the capability branch: own engine renderer behind a flag, three-WebGL still default.
Physics/zones/time/logic reuse as-is (audited renderer-agnostic); streaming follows the PLAYER; picking
goes through an engine-side ray query against the 07 cell BVHs; HUD/UI unchanged (DOM).
**Done:** walk and drive around Los Santos in the real app with `?engine=opensa` — gameplay parity with
the WebGL path for movement/camera/streaming; benches from inside the GAME, not the lab.

**B4. Water v1 + remaining world effects** — [06](06-world-effects-parity.md) rows 12/13 tails · size M
✅/PARKED 2026-07-13: water went v1→v2→v3 in one day (runtime flat → shore-field bake → TRUE-depth bake
with surf/foam/swash; 12 field rounds logged in plan 06) and is PARKED as a leftover at v3 — the look
ceiling is the 2005 sprite textures; resume = docs/roadmap/0.6.0/plans/02-water-realism (authored textures
first). Coronas textured + 2dfx particles (row 13 tails) LEFT B4 UNFINISHED — they are now **B6** below
(the tails were nearly lost when B4 closed; that is why they get their own step).
The game needs a sea surface; v1 = flat animated surface with the sky-shared fog (the "real waves" rework
stays the 0.5.0 idea).
**Done:** coastline looks intentional (water v3 accepted as a leftover).

**B5. Vehicles in the game** — ✅ DONE 2026-07-14, FIELD ✅ (5 steps, all in the 08 ledger) · size M
1 engine capability (model↔instance split — ONE upload per car TYPE, instances share it; per-submesh
visibility; pivot/scale/world-override on the rigid entity) · 2 shared browser BUILDER in renderware (all
four wheel conventions, `_ok`/`_dam`, `_vlo`, `extraN`, door hinges, lamp tags; **paint is a per-vertex SLOT,
not a bake** — one model, many colours) · 3 `VehicleHandle`: three is OUT of vehicle gameplay (a grep for
`from 'three'` in `game/src/vehicle/` returns only Vector3/Quaternion MATH) · 4 cars drive in
`?engine=opensa` (systems REUSED verbatim; new seam found and narrowed: `VehicleAnimator`) · 5 lamps
(per-vehicle state, cones, coronas on the EXISTING corona pass).
**Done:** drive around Los Santos with `?engine=opensa`; no three types left in the vehicle logic path.

**B6. 2dfx particles + textured coronas** — ✅ DONE 2026-07-14, FIELD ✅ (ledger: 06 row 13) · size M
Shipped: `.oscell` minor 2 carries a particle table (converter `weld.ts#collectParticles`, HD cells only);
the FX baking is shared at `renderware/src/fx/bake-fx.ts` (the three path still keeps its own copy — that
collapse is C2 work); the engine loops the particle lifecycle entirely in the vertex shader; coronas and the
MOON are textured from `particle.txd` (sprite sizes read from the DATA — swapping in a higher-res moon just
works) with a real terminator for the phase. FIVE field rounds, every one a convention I assumed instead of
checked (GTA Z-up force/direction, SA sprites with no alpha channel, heat-haze prims, the UV range on a ±1
quad, size-is-a-diameter) — all five are written up in the 06 row 13 ledger.
Tests: `renderware/fx/{bake-fx,sprites}.test.ts`, `apps/web/.../engine-particles.test.ts` (the axis swap),
and the converter on the real SF fountain (`weld.test.ts`, new `dff/particles/fountain_sfw.*` fixture).
OLD SCOPE (kept for the record):
A REAL flip-parity gap, not a nice-to-have: prod renders these (plan [044](../044-world-effects/readme.md),
`renderware/src/three/build-particles.ts`, `graphics.effects` config with a master toggle) and the map
carries **113 type-1 entries** — 20 `WS_factorysmoke` columns, 8 fires, 6 fountains, vents, insects,
waterfall mist. Our side is empty from the CONVERTER up: `weld.ts#collectLights` extracts type-0 (corona)
anchors ONLY, so the pak holds no particle data at all. Work = converter (type-1 anchors + `effects.fxp`
params — the text parser exists at `renderware/src/parsers/text/fxp.parser.ts` — into the `.oscell` light
table) + engine (instanced billboard pass, shares the corona pass; emitter simulation). Textured corona
sprites (`particle.txd` coronastar/coronamoon — the moon disc is still procedural) ride the same path.
NOT to be confused with
`docs/roadmap/0.5.0/plans/07-lod-generators-extended/sa-lod-generator/02-particle-emitters.md` (emitters on
LODs for the REAL SA game via the ASI — a different target).
**Done:** ✅ chimneys smoke and fountains run in `?engine=opensa`; ledger 06 row 13 closed → 14/14.

**B7. Destruction objects, then animation objects** — [08](08-dynamics.md) · size M each

- **B7·a Destruction (breakable) objects — ✅ DONE 2026-07-14, FIELD ✅.** Props shatter into analytic shards
  (shared baker with the three path; the ground probe FIXES prod's sinking-shards defect), uproot props
  (lampposts, meters — object.dat column G, which our parser had been discarding) fall over as real dynamic
  bodies with a convex-hull collider, and a smashed prop takes its 2dfx coronas with it (`.oscell` minor 4).
  Breakables stay INSIDE the merged bundle — the engine degenerates their index ranges in place, so the break
  costs no draw call (splitting them out per placement measured 4.5× the draws). Five field rounds and every
  lesson is in the 08 ledger — read it before touching this.
- **B7·b Animation objects — ✅ DONE 2026-07-14, FIELD ✅.** Garage doors, windmills and the spinning signs
  move (64 placements). No new engine machinery was needed: an IFP's "bones" ARE the clump's frames, so the
  B1 `IfpSampler` composes the chain and `setPartWorldMatrix` (written for damage debris) drives each atomic.
  The converter leaves ONLY the frames the clip moves out of the bundle — `burger01_LAw` is a 22×35 m diner
  that lives in the anim section purely because its sign spins, and both dropping it (the plan-041 "blue
  hole") and promoting it whole are bad trades. Ledger + lessons: [08](08-dynamics.md).

- **B7·d PROCEDURAL CLUTTER — ✅ DONE + FIELD ✅ 2026-07-15, see [19](19-procobj.md) + [20](20-breakable-clutter.md).**
  Host-generated + instanced (Option B): ONE memoized scatter drives render AND colliders (re-enabled, cap 150) so they cannot diverge; new engine `clutter` pipeline reuses the vehicle-model geometry; breakable
  clutter (cacti/rocks/rubble) shatters via per-instance keyHash → `breakClutterInstance` degenerates the
  instance matrix. The blocker for both was the browser VFS dropping never-IPL-placed procobj DFFs —
  `procObjModelRefs` in `build-vfs.ts` fixed it. (The original 9 803-body / 17 ms-per-step spiral is
  documented in [19](19-procobj.md).)

- **B7·c UV-SCROLL animation — SHIPPED + FIELD-CONFIRMED 2026-07-15, CLOSED, see [18](18-uv-anim.md).** The
  crawling neon + Vegas waterfalls. Resolved the design fork NOT with a per-vertex slot (the packed 36 B vertex
  was not worth +11 % for a rare feature) but by leaving the scroller OUT of the merged bundle as an
  **objectTable kind-4 draw** — a per-object cell uniform carries the live `uvAnim` transform the engine
  advances each frame (global by dict name, the prod keyframe lerp; speed is prod-exact). `.oscell` minor 4→5,
  `OspakManifest.uvAnimations`. The plan's skull sign turned out unplaced; real scrollers are `vgsN_scrollsgn01`
  / `vegaswaterfall02` / `visagesign1` (teleports in `game-config.tsx`).

## Milestone C — the flip and the endgame

**C1. Flip criteria run** — [10](10-integration-flip.md) · size M
The pre-agreed gates: 60 fps ls-noon @2× retina; ≥ WebGL fps on EVERY bench scene; parity screenshot
sign-off; stress matrix + 30-min soak green in Chrome and Safari (smoke ✅ 2026-07-13; full matrix/soak
still owed). **Criterion 4 replaced 2026-07-17: WebGPU-FIRST, no dual-renderer support** — the loader is
a boot GATE (WebGPU → the engine IS the game; else a "sorry, WebGPU required" screen), `?engine=three`
stays only as the manual comparison override until C2.
**Done:** the flip decision doc with every ledger linked; own engine becomes THE renderer.

**C2. Cleanup** — [13](13-cleanup.md) · size M
Drop the three-WebGL path, the 073 flag zoo, three/babylon/postprocessing (user decision: no WebGL
fallback). Every deletion PR bench-gated. **GATED on a separate explicit user command (2026-07-13
directive): after the flip the old path STAYS for a side-by-side comparison period (settings/picture/
anything forgotten) — C2 never auto-starts from C1 passing.**
**Done:** dependency/bundle ledger recorded; one renderer in the tree.

**C3. pmb integration + the exit exam** — [14](14-pmb-integration.md) · size L
`opensa-pack` becomes a perfect-map-builder stage (wind/stochastic/subdivision data move into pmb config);
full modded profiles (anderius/carcer/gostown) convert and run the final bench matrix.
**Done:** the headline the chain exists for — **the user's full modded SA at 60 fps on the own engine**.

---

## Standing rules while executing (do not relearn these)

- Bench ritual after every perf-relevant change; series.md is append-only; >10 % GPU/frame p95 regression
  blocks until explained (Metal timestamp quantization: trust avg when max is bit-identical).
- Reconvert BOTH paks (`pak`, `pak-sf`, later full-map) whenever the converter or manifest changes.
- Golden WGSL snapshots: change → review the diff → `vitest -u`; naga guardrails stay (no uniform-space
  arrays, no unbounded loops).
- ALL project docs and code stay English-only — repo-wide, not just plans (user rule, broadened
  2026-07-13); field verdicts get paraphrased in English; every verdict and measurement goes into the
  owning plan's ledger.
- Parked items have written prerequisites — check roadmap/0.5.0 before re-attempting directional shadows,
  weather wind, or stochastic default-on.
