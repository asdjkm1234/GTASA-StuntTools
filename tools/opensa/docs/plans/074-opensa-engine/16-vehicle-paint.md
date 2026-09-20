# 074·16 — Deep vehicle reflections & car paint

[← chain](readme.md) · owner of the rework the B5r v1 could not deliver

**PLAN CLOSED 2026-07-17 — user verdict: vehicle paint is good now; the parity debt is retired and
nothing here blocks the flip.** Steps 3+6 (SSR/grounding) stay recorded below as constraints for a
FUTURE beyond-parity iteration only.

**Status history: steps 1–2 CLOSED, field-ACCEPTED 2026-07-16** — step 1 (ACES+bloom) shipped with plan 09;
step 2 (the scene environment probe + the skygfx-neo reflection model, six field rounds — see the round
records below) accepted by the user as the direction to build on. Step 4 vehicle normals SKIPPED by the
user (2026-07-16) — design parked at docs/roadmap/0.6.0/plans/03-vehicle-normals. **Steps 3 (SSR) + 6
(grounding) were BUILT, field-tested and ROLLED BACK the same day (2026-07-17, user decision)** — the
record below is preserved for the next attempt; do NOT retry the same shapes. The escape hatch stands:
`graphics.vehicleReflection.preset: 'off'` sets `env.reflectionStrength = 0` and the whole term (probe
included) dies.

The user's brief, verbatim in intent: **the car is the most important part of the game; the paint must read
like real automotive paint, AAA-grade, day and night — not a coloured fill with a highlight.**

---

## What v1 already does (and it is not the problem)

- Reads the **DFF's own material-effect plugins**: which env texture (`xvehicleenv128` for paint,
  `vehicleenvmap128` for glass), the RpMatFX coefficient, the SA reflection-plugin intensity, the specular
  level. Coefficient 0 = not reflective, which is how SA marks tyres and rubber. Per-vertex slots
  (`VehicleModelData.reflect`), unit-tested.
- Takes the reflection's **colour from the live sky** (the shared Preetham LUT + sun/moon discs + the cloud
  dome), not from SA's textures — those are baked DAYTIME images (a painted horizon; for glass, literally a
  sunset photograph), so sampling them raw means a car reflects a sunset at midnight.
- Clearcoat Fresnel, a metallic-flake micro-normal anchored in model space, a blurred/sharp reflection pair,
  specular from the sun, the moon and the light pool (street lamps sliding along a bonnet at night).

None of that is wrong. It is simply **not enough**, for three reasons that no constant can fix.

## Why v1 cannot look AAA — the three root causes

1. **We reflect the SKY, not the WORLD.** Buildings, palms, kerbs, the road, the car next to you — none of
   them appear in the paint. A car that reflects only a smooth sky has nothing recognisable in it, and the
   eye reads that as "tinted plastic". Every AAA car reflects a real environment.
2. **SA panels are FLAT and their normals are flat.** On a flat quad the mirror direction is CONSTANT, so
   even a perfect mirror paints a constant colour. Flakes disguise this; they do not fix it. AAA cars are
   dense, curved, and carry normal maps. **This is a DATA problem**, not a shader problem.
3. **We have no tonemapping.** The scene renders to rgba16float and the post pass composites to the sRGB
   swapchain with no filmic curve, so an HDR highlight simply clips to flat white. The "depth" in AAA
   reflections is largely the tonemapper's roll-off plus bloom — without them, bright reflections look like
   paper cut-outs, which is exactly the field verdict.

There is a fourth, quieter one: **the car does not sit in the world** — no contact shadow, no ambient
occlusion under the body — so however good the paint gets, it will still look pasted on.

---

## The rework, ordered by dependency

Each step is a real piece of engine or pipeline work, not a tweak. The order matters: 1 and 2 are load-bearing
for everything after them.

### 1. Tonemapping + bloom on the scene target — the prerequisite

Without a filmic curve, every later item's highlights clip to white and the whole exercise is wasted.

- ACES (or Uchimura/AgX) applied in the post pass, which already owns the 16f → sRGB composite (074/09).
- Bloom on the bright-pass the godrays already compute — reflections and lamps bleed properly.
- **Gate:** a blown sky reflection on a wing keeps its colour and rolls off instead of clipping to paper white.
- **Risk:** this changes the WHOLE image, not just cars. It needs its own field pass against the prod look and
  its own bench row. It may well belong to plan 09 rather than here — decide at the start.

### 2. A real environment probe (the reflection SOURCE)

A cubemap (or octahedral 2D) probe of the ACTUAL scene, centred on the player's car:

- rendered from the existing world/sky passes into a small target (64²–128² per face), refreshed on a budget
  (one face per frame, or a full refresh every N frames — the world is static, so this is cheap);
- a **roughness MIP chain** (prefiltered IBL, split-sum approximation) so paint, glass and chrome each sample
  the blur they deserve — this is what our `mix(sharp, blurred, roughness)` hack is standing in for;
- falls back to the current analytic sky when no probe exists (parked cars far away, the lab).
- **Gate:** you can recognise a building in the paint.
- **Cost target:** ≤ 0.5 ms GPU amortised; must not regress the bench.

### 3. Screen-space reflections for the near field

The probe cannot see what is right next to the car (the road under it, the car alongside). SSR over the
existing depth + scene colour, composited UNDER the probe where it has no hit.

- **Gate:** the road and the neighbouring car appear in the door panels; no smearing at screen edges.
- **Risk:** the classic SSR failure cases (off-screen, disocclusion) must fall back to the probe cleanly.

### 4. Vehicle geometry & normals — the DATA half

The flat-panel problem is upstream of the renderer:

- **normal smoothing / crease-angle recompute** for vehicle bodies (the WORLD half shipped as
  map-optimizer plans 020-023, `tools/map-optimizer/docs/plans/`; vehicles need the same treatment and are a
  better first target — the panels are large and the artefact is obvious);
- optional **body normal maps** (procedural panel-line/orange-peel detail, or authored) — orange peel is a
  real property of car paint and reads instantly;
- consider light **tessellation/smoothing** of body panels at build time in the vehicle builder.
- **Gate:** a bonnet shows a continuous reflection gradient, not one flat patch per triangle.

### 5. A proper car-paint BRDF

With 1–4 in place, the shading model can finally be honest:

- two lobes: a coloured **base coat** (diffuse + subtle metallic flake) under a **clearcoat** GGX lobe;
- split-sum IBL against the probe's mips (the correct version of v1's `mix(sharp, blurred)`);
- **flakes done right**: density/size in model space, faded with distance and screen derivatives, feeding a
  separate narrow lobe — flakes are what make paint sparkle, and also what make it ALIAS;
- **specular anti-aliasing** (Toksvig / normal-variance), without which flakes + sharp GGX crawl and shimmer
  at any distance — non-negotiable once flakes exist;
- dirt/wear from the DFF's own grunge texture, so the paint is not uniformly showroom-fresh.

### 6. Grounding the car

- contact shadow / SSAO under the body, plus a soft ground shadow, so the car belongs to the road;
- (later, with 0.5.0/05 weather) a **wet look**: rain raises clearcoat gloss and drops roughness, which is
  where car paint looks its absolute best — worth planning for from the start.

---

## Step 2 implementation record (2026-07-16, awaiting field)

The probe went beyond prod's parity point on purpose: prod's CubeCamera renders the SKY DOME ONLY
(`SKY_PROBE_LAYER`, refreshed every ~15 game-minutes) — this probe renders the ACTUAL streamed world, which
is what the step-2 gate ("you can recognise a building in the paint") asks for.

**Shape** (`packages/engine/src/render/probe.ts` + `renderProbeFace`/`scheduleProbe` in `engine.ts`):

- 128² × 6 faces × 8 mips, rgba16float — all allocated ONCE at init, so the cube view sits inside every
  vehicle bind group (rigid layout bindings 5/6) while its contents refresh.
- One face every 2 frames (`PROBE_FRAME_INTERVAL`), each in its OWN submit BEFORE the main pass: the face
  camera is written into the SHARED frame uniform, the probe encoder is submitted, then the main camera is
  written — `queue.writeBuffer` is ordered against submits, so the recorded cell bundles replay with the
  face camera and no second frame bind group exists. Off frames still write the current mix (params4.w), or
  the paint would flicker probe↔analytic at half the frame rate.
- Face pass = frustum- and range-culled (`PROBE_RANGE` 350) OPAQUE cell bundles + the sky pass, MSAA4 into a
  scratch target; then a V-FLIPPED blit into the face's mip 0 ('probe-blit' — GL cube-face row order vs
  WebGPU render row order; flipping the projection instead would flip winding and break back-face culling
  inside the recorded bundles); then a 2×2 box mip ladder ('probe-mip') — the prefiltered-roughness chain,
  prod's `generateMipmaps` equivalent. Vehicles/peds/clutter/blends are NOT in the probe (no self-reflection).
- Rigid WGSL: `textureSampleLevel(probe, mirror, PAINT_ROUGHNESS × 7)` × `PROBE_GAIN 3.0`, blended over the
  analytic sky by params4.w; probeMix ramps 0→1 over the first 6 faces and RESETS on a >80 u centre jump
  (teleport = no stale faces in the paint). Host feeds `engine.probeCenter` = seated car, else player;
  `?probe=0` = analytic A/B; the lab never sets a centre — analytic fallback by design.
- `rigidClearcoat` is WIRED again (it was dead code since the B5r rejection — fsRigid never called it).
  Its per-vertex early-out became a multiply: the moon sprite inside `reflectedWorld` is an
  implicit-derivative `textureSample`, and branching on a varying before it is non-uniform control flow —
  tint rejects the pipeline (found headless: both rigid pipelines invalid, black canvas).
- Instrumentation: probe span = GPU timestamps slots 4/5 (own submit → begin/end honest, unlike the post
  chain's Metal-overlap case), `stats.gpuProbeMs`, HUD `probe X ms`, bench JSON `gpuMs.probe`.

**Measured (headless ANGLE/Metal, M3 Pro, 1440×900, in-game `?bench=all`):** all six scenes stay
vsync-locked 120 Hz with the probe on (avg 8.33 ms, p95 10.1–10.3 — the p95 level is this headless
environment, `?probe=0` reads the same 10.2). The `gpuMs.probe` column reads 0.38–1.94 per face render,
but it is an UPPER BOUND: on Metal the face pass's begin timestamp overlaps the previous frame's trailing
fragments, so the span tracks the scene's world-pass time — cutting `PROBE_RANGE` 350→250 did not move it,
and the decisive probe on/off A/B on the heaviest scene (ls-rain-night) moved NOTHING at the frame level
(pass/post deltas within run variance ±0.3 ms, p95 identical). **Cost gate passed by A/B**; the ≤0.5 ms
number is unmeasurable through the contaminated span — judge by on/off. Zero WebGPU validation warnings;
`?probe=0` A/B differs on the car (RMSE ~3 % over the car crop) and nowhere else in the frame. Field look
verdict + a real-display sweep are owed.

## Step 2 field round 1 (2026-07-16) — glow + no-reflections + glass sparkle

Field verdict on the first probe build: **the car GLOWS day and night, no recognisable reflections, and the
metallic flake sparkles on the windscreens**. Three causes, all constants/wiring — the probe itself was
fine (verified by eye with the new `?probeview=1` DEBUG view: fullscreen cube-by-camera-ray, drawn over the
frame at the end of the world pass; left half sharp mip / right half the paint mip; the Ganton panorama
matched the real scene's orientation and building order exactly — no flip, no rotation):

1. **Glow** = `PROBE_GAIN 3.0`. The v1 "our sky is LDR, gain it" argument does NOT apply to the probe — it
   holds the REAL HDR scene (the sky pass writes real sun overshoot). 3× the whole environment × fresnel
   over every panel read as a luminous coat, day and night. → **1.3**.
2. **No readable reflections** = `PAINT_ROUGHNESS × 7 = 2.45` probe mip — twice as blurred as prod
   (`enhanced` preset roughness 0.15 × 8 mips ≈ 1.2); on SA's flat panels (one mirror direction per panel)
   that much blur collapses buildings into a uniform wash. → **PROBE_PAINT_LOD 1.2** (prod-parity).
3. **Sparkle on glass** = fsRigidBlend got the same flaked normal + SA pattern as paint.
   `rigidClearcoat` is now parameterized by material: paint = flaked normal + pattern + paint mip; glass =
   plain normal, pattern 1, **PROBE_GLASS_LOD 0.5** (near-sharp). Body flakes also calmed
   (`FLAKE_AMOUNT` 0.22 → 0.10 — dense white noise in the field screens).

Headless after the fixes: night car no longer glows (reads as dark paint in the night scene), day speckle
visibly calmer, probe panorama correct. Bench-exempt (constants only). Field re-check owed: building
silhouettes on the side panels while driving, clean windscreens, day/night glow gone.

## Step 2 field round 2 (2026-07-16) — material classes + the vehicle look bench

Field verdict on round 1's fixes: still not good enough — "no depth, no reflections, it glows, the normals
melt together; the car is the FACE of the game". The user's directive: split reflections by MATERIAL TYPE
(body / chrome / glass, `chassis_vlo` excluded) and build fast iteration tooling (day/night buttons).

**Material classes** (builder + WGSL, `MaterialClass` in `renderware/vehicle/types.ts`):

- Classified per DFF material at build time into `meta.w`'s HIGH nibble (lamp tag keeps the low nibble):
  `_vlo` LOD meshes, lamps and coefficient-0 materials (tyres/rubber/trim) → **matte** (no env term at
  all — the user's "chassis_vlo out of reflections"); translucent → **glass**; a chrome base texture or the
  `vehicleenvmap*` env map → **chrome**; carcols slots / `xvehicleenv*` / any other env-mapped opaque →
  **paint**. Custom cars' own chrome/env textures participate: every material's env texture is already a
  texture-array layer (`reflect.x`).
- WGSL response (branch-free — the uniformity rule): PAINT = flaked normal + sphere-map luminance pattern +
  mip 1.2 + dielectric fresnel; CHROME = plain normal, **constant metal reflectance** (CHROME_F0 0.75 —
  metal mirrors at every angle, not only grazing), near-sharp mip 0.4, **plus its own sphere-map COLOUR
  additively** (the authentic SA chrome; `xvehicleenv128`/`vehicleenvmap128` are 2D sphere maps, not real
  cubemaps — sampled by view-space normal exactly as SA does); GLASS = plain normal, sharp mip, fresnel
  opacity; MATTE = specular only. Gotcha: the layer-allocation ORDER in the builder is load-bearing — the
  base texture must resolve before the env map or the env texture lands on layer 0, which is the
  "not reflective" sentinel (caught by the existing reflect test).

**The vehicle look bench** (engine-lab — boots in seconds, no VFS build):

    /?pak=1&stream=1&src=pak-ls&vehicle=1&vmodel=vehicle-comet&at=2495,-1675,13.3&orbit=26&hour=12

- DOM debug panel: prod's F2 time shortcuts (00/06/12/18/21 buttons) + a 24 h slider, all LIVE; env-probe
  and probe-view toggles. The probe defaults ON with a vehicle and follows the orbit focus — with a
  streamed pak the cube contains the real city, so reflections are the real thing, not a mock.
- `?vmodel=<dir>` picks a fixture (vehicle-probe CLI `--out`; `vehicle` = landstal from the pinned
  game-src, `vehicle-comet` = the user's modded Comet from NO_COMMIT/optimized); `?at=gtaX,gtaY,gtaZ` moves
  the bench to any street corner; `?orbit=N` starts the camera N units out.

Headless check (Ganton, comet fixture): noon — paint shows highlight gradients across the deck, the chrome
bumper reads metallic, no glow, no noise; night (21:00) — the car sits in the streetlamp light, chrome
catches it, no glow. 1241 tests green (builder classification cases added), goldens updated. Field verdict
owed on the bench.

## Step 2 field round 3 (2026-07-16) — the config quarter, night fps, inside glass, the ./1 survey

Field reports off the live bench: night fps 120→60 with a car, still "no reflections", "dioptric" glass
from inside, frost on the bonnet. Four root causes, all found and fixed:

1. **"No reflections" in the GAME = the config quarter.** `game-runtime-config` ships prod's
   `vehicleReflection.intensity: 0.25` (three envMapIntensity units) and the driver fed it RAW into
   `reflectionStrength`, quartering the whole clearcoat AND specular. The driver now calibrates
   0.25 ↔ engine-neutral 1.0 (×4); the shared default config moved to 0.25 so the lab matches.
   On top of that, `CLEARCOAT_F0 0.05 → 0.18`: SA's own matfx is an ADDITIVE sphere map with no fresnel —
   the mods author coefficients against a visible HEAD-ON reflection; 0.05 read matte from every angle
   that matters.
2. **Night fps** = the bench pushed 4 per-pixel dynamic lamp lights for a PARKED car (SA parked cars run
   no headlights) — removed in the static bench; night went 60 → ~103 fps headless. The remaining night
   cost is the street-lamp pool (per-vertex over the world) + night bloom — the known plan-17/light-pool
   territory, not the car.
3. **"Dioptric" glass from inside** = the glass reflection (and its fresnel opacity boost) applied to BACK
   faces of the double-sided glass. `fsRigidBlend` now gates both by `@builtin(front_facing)` — inside
   view is plain tinted transparency.
4. **Frost** = flakes still too hot at close range: `FLAKE_AMOUNT 0.10 → 0.05`, `SPEC_GAIN 6 → 4`.

**The ./1 quality-mod survey** (9 cars — k1real24, mad_driver, alfamodding, funky, avant, stratumx, mad
max) drove the classifier: mods do NOT use stock env names — chrome = `vehicle_generic_chromeprts2/3` /
`env_chrome128` / `chromeprts2` env maps, chrome sheets (`ch75_chrmap`, `gen_chralu512`,
`fairmont_chrome_police`), or UNTEXTURED neutral-grey materials; body = `env_body` / `generic_envmap*` /
`reflection` / `euros86speca` (+ carcols markers, which stay authoritative — `chrom_body` rides painted
panels); glass = `env_glass` / `env_gls256` on translucent. `materialClass` now recognises all of these
(chrome texture markers list, `*chrom*` env names, bare-metal grey rule). Bench fixtures added for the
chrome-rich mods: `?vmodel=vehicle-alpha`, `?vmodel=vehicle-buccanee`.

**Bench UX same round:** vehicle mode = PARKED at the focus (centre of the road), camera does NOT
auto-spin, wheel zooms to ~2 units (the old ratio floor stopped ~100 u out on a full-city pak), eye floor
1.2 u for street-level views; `?drive=1` restores the convoy. `?at=gtaX,gtaY,gtaZ` / `?orbit=N` position
the bench; lab HUD gained the probe column. Headless: noon deck shows sky-sweep gradients + metallic
bumper, alpha (Stealth) reads near the prod reference; night 21:00 ~103 fps.

## Step 2 field round 4 (2026-07-16) — THE MODEL IS NOW SKYGFX'S NEO CAR PIPE

Field reports: night still 60 fps on the user's 2× display, reflections still unconvincing; and two
directives — **no name-based material classification** (mods combine arbitrary names) and **"do it like
skygfx"**. Studied the shipped SkyGfx Extended distribution (`neo/carTweakingTable.dat`) + aap's sources
(`neoVehiclePass1VS.hlsl` / `Pass2VS.hlsl` / `neoCarpipe.cpp`):

- **neo pass 1**: `R = 2N(N·V)−V` sphere-samples the env; `amount = lerp(b⁵, 1, fresnel) × shininess`
  (b = 1−saturate(N·V)); the pipeline **LERPS the lit base toward the env by that amount** (D3DTOP_LERP) —
  never adds. `fresnel = 0.4` in the shipped tweaking table (flat across weather/hour), `shininess` = the
  DFF matfx coefficient.
- **neo pass 2**: broad Blinn specular, `power = 18` default (weather table 10–70), point lights at ×2 —
  added on top.

Ported verbatim into fsRigid/fsRigidBlend with ONE upgrade: the env source is our live scene probe instead
of their static neo.txd sphere map. `NEO_FRESNEL 0.4`, `SPEC_POWER 18` / pool ×2, `SPEC_GAIN 1`; the
LERP replaces all the additive/f0 machinery of rounds 1–3 (CLEARCOAT_F0, PROBE_GAIN, PATTERN_MIX, the
chrome sphere-add — all deleted). Classes now differ ONLY in data terms: paint = flaked normal + mip 1.2;
chrome = plain normal + mip 0.4 + coefficient floored to 0.85; matte = amount 0; glass = neo amount drives
both the mirrored colour and the opacity swell (back faces stay plain — the round-3 gate).

**Classifier de-hardcoded** (user directive): no texture/env NAME matching at all. Chrome = the one pure
DATA signal — UNTEXTURED neutral-grey env-mapped material (the ./1 bumper/trim convention); textured
chrome sheets simply stay paint, which under the one-LERP-law model is exactly how skygfx treats them.

**Night fps**: the pool admitted up to 64 street lamps and the world shades the WHOLE pool per vertex —
`fillLightPool` now sorts static 2dfx candidates nearest-first and caps them at 24, reach 130 → 100
(prod's street-light fade is 90). Headless night: 120 Hz at 1×, world pass ~4 ms (was up to 5.8).

Headless verdicts: noon comet — grazing panels darken toward the environment (the "depth" read), deck
carries the sky, chrome metallic; **alpha's rear glass reflects recognisable palm trees** — the step-2
gate ("recognise a building in the paint") observed. 1242 tests green; fixtures regenerated.

## Step 2 field round 5 (2026-07-16) — night fps root #2: per-pixel pool on the CAR; glass damped

The user isolated the night drop precisely: 120 fps WITHOUT the car, 60 with the car IN FRAME — the cost
lives in the car's own fragments. fsRigid ran TWO per-pixel light-pool loops (the static-diffuse one
inside rigidShade and the point-light half of rigidSpecular): up to ~48 iterations per pixel × millions of
close-up car pixels at 2× retina, night-only because the day pool is empty. **Fix, neo-faithful — the
original's pass 2 IS a vertex shader: both pool terms moved to vsRigid** (varyings `poolDiffuse` /
`poolSpec`, the latter pre-scaled by the material's specular level); the fragment keeps only the sun/moon
lobes on the flaked normal (the sparkle). Cars are 3–5 k verts, so the vertex cost is free; headless night
with the car holds 119–120 fps at 1×.

Same round, the glass verdict (paraphrased: glass reflections read too strong, and seeing the wheel
through the windscreen is the improvement to keep): `GLASS_REFLECT 0.5` damps the neo amount on
fsRigidBlend — the street stays in the glass, the interior reads through it.

## Step 2 field round 6 (2026-07-16) — DIRECTION ACCEPTED; the wheel-through-windscreen sort

User verdict (paraphrased): overall much better — good enough to move forward. One bug left in the arc: the
steering wheel drew OVER the windscreen — unsorted vehicle transparency (the wheel's alpha material
followed the glass in model order; blends are depth-read-only). Fix: `VehicleModelSubmesh` gains a
model-space CENTROID (the builder averages each material group's triangle corners) and the engine sorts
the translucent phase back-to-front per instance by the part-matrix-transformed centroid (`center` is
optional — pre-field fixtures sort at the origin). Fixtures regenerated.

**Step 2 arc summary** (six field rounds in one day): scene probe → glow/mip/glass fixes → material
classes + the lab look bench → the config quarter + inside-glass + the ./1 survey → **the skygfx neo
reflection model** (LERP toward the live probe, fresnel 0.4, broad specular) + the no-name classifier +
the light-pool caps → per-vertex car pool lighting + glass damping + the transparency sort. Remaining
plan-16 steps: SSR (3), vehicle normals (4 — the low-poly "melting normals"), grounding (6).

## Steps 3 + 6 — BUILT AND ROLLED BACK (2026-07-17, user decision)

**Verdict: the whole SSR + contact-shadow build was reverted the same day it shipped — "it worsened the
experience; a completely different approach next iteration; for now the simple stable fast version".**
What stayed in the tree from the day: the translucent SORT fix (centroid − bounding radius — the raked-
windscreen/steering-wheel regression, a real bug independent of this arc) and the lab's `?az=DEG&el=N`
orbit pins. Everything below is the preserved record of what was built and what the field taught —
read it before the next attempt.

Field history compressed: v1 cost 110 → 60–70 fps at night on the real display (march at any distance +
MSAA depth store every frame); tuning (near-field 45 u gate, 12 steps, capture every 2nd frame offset
from the probe) brought it to 80–90 and a clean `?bench=all` display sweep (5/6 scenes vsync 120) — but
free-roam night still dipped and a step-geometry bug ("marching stripes": step gap outgrowing the
thickness window at growth 1.5) burned trust. The shadow's own field round: bind-pose placement sank the
decal under the road (physics settling) → needed a per-car physics raycast; the falloff knee had to sit
at the sill line or the blob read as absent. Each fix worked, but the stack of caveats is exactly what
"needs a different approach" means.

**Constraints for the next attempt (so it starts ahead):** prod has NO SSR and no contact blob (its cars
ground via CSM; its reflections are a sky-only cube probe) — both features are beyond-parity, so they
must be FREE and artifact-free or opt-in; any march must respect step-gap ≤ thickness-window slope by
construction; any ground decal must take its height from physics, not bind pose; and the night frame at
2× retina has no per-pixel budget left (the pool/headlight territory of plan 17 already owns it).

## The original steps 3 + 6 implementation record (ROLLED BACK — for reference)

**Step 3 SSR — reprojection against LAST frame's scene** (vehicles draw INSIDE the world pass, so the
current frame's colour/depth are unreadable there; one-frame-old history is the standard answer):

- **History capture** (`'ssr-capture'` pipeline + module): after the world pass, one fullscreen pass
  writes a FIXED-size (1024×512 rgba16float) snapshot — rgb = the resolved HDR scene, a = each pixel's
  camera DISTANCE reconstructed from the multisampled depth (sample 0, reversed-Z unproject through
  `invViewProj`; sky depth 0 → sentinel 60 000, finite because rgba16float overflows to inf at 65 505).
  Fixed size for the probe-cube reason: the view sits inside every vehicle bind group (rigid binding 7)
  and must never rebuild on resize. The capture (and the world pass's `depthStoreOp: 'store'` + the
  depth's TEXTURE_BINDING) runs ONLY on frames with live vehicle models and `env.ssr > 0` — no cars, no
  depth writeback, no cost.
- **Frame UBO tail** (400 → 480 B): `prevViewProj` + `prevCamera` (`.w` = the `?ssr=` gate). The engine
  copies the current camera into them AFTER submit, so the shader always projects into the frame the
  history was captured under. First frame: prev = current, history zero-initialized → every march misses.
- **The march** (`ssrTrace` in the rigid module): 16 geometric steps (t₀ 0.3, ×1.4 → reach ~46 u — the
  probe owns the far field), thickness window `0.55 + t×0.4` (must grow with the step gap or thin
  surfaces fall between samples), camera-facing fade (rays bending back toward the camera reflect what
  the history never saw), screen-border fade over 0.1 uv (the "no smearing at screen edges" gate). Every
  tap is `textureSampleLevel` — explicit LOD, so the early-outs are legal in non-uniform control flow,
  and the whole march is GATED on `amount × ssr > 0.004` (only pixels whose neo amount will show it pay;
  the implicit-derivative taps in `reflectedWorld` all happen before the branch — the uniformity rule).
- **Composite**: inside `rigidEnv`, `env = mix(probe/analytic, ssr.rgb, ssr.a × gate)` — SSR sits OVER
  the probe by hit confidence, a miss falls back with zero seam. Both fsRigid (paint/chrome) and
  fsRigidBlend (glass) get it, glass through its own damped amount.
- **Headless verdict** (Ganton comet, noon): the on/off diff is confined EXACTLY to the car (road/kerb
  content appears in the deck and glass; zero off-car pixels touched), no WebGPU validation warnings,
  120 Hz held (lab GPU pass 2.55 → 2.57 ms with probe on).

**Step 6 grounding — the contact blob** (SA's own under-car shadow, an ambient-occlusion decal, not a
sun shadow):

- **Data**: `buildVehicleModel` now computes the MODEL-space bind-pose AABB (every submesh's vertices
  through its part's bind transform — raw positions are part-local, a wheel's box would land at the
  origin). `VehicleModelData.bounds` required; `VehicleFixture.bounds` optional (old fixtures cast
  nothing); the four lab fixtures regenerated.
- **Engine**: host-fed `engine.groundShadows` (the dynamicCoronas pattern — the host owns car transforms
  and bounds), drawn as ONE instanced quad draw (`'vehicle-shadow'` pipeline) after the opaque vehicles,
  before the sky: multiply blend `(zero, 1−src-α)` darkens the road, depth-read `greater` rejects pixels
  the body covers, cap 512.
- **Falloff — the field lesson of the round**: superellipse `d = |u|³+|v|³`, fade `1 − smoothstep(0.55,
1, d)`. The first knee (0.3) produced an invisible shadow: the dark CORE is hidden under the body — the
  eye only sees the margin ring (body edge at d ≈ 0.6), and an early knee put the whole visible ring in
  the fade tail. Diagnosed headless with an alpha=1 nuclear quad (drew correctly → the maths, not the
  pipeline).
- **Hosts**: engine-vehicles pushes one decal per live car (GTA-space maths → `gtaPositionToEngine`,
  pitch/roll follow the chassis so slopes stay glued; strength 0.45, distance fade 70→115 u); the lab
  bench pushes for parked/convoy fixture cars (lift 0.1 above the wheel-bottom plane).
- **Headless verdict**: noon — a soft dark ring hugs the sills and bumpers, car reads seated; night
  21:00 — blends into the dark road, no double-darkening, 120 Hz, GPU pass 2.91 ms night.

Bench: see [bench/series.md](../../benchmarks/opensa-engine/2026-07-18-series.md) § 16·ssr-grounding (headless in-game `?bench=all`, on/off).

## Steps 3+6 field round 1 (2026-07-17) — night fps + wheel sort + the sunken shadow (ROLLED BACK except item 2)

Three reports off the first field build, all root-caused and fixed the same session (items 1 and 3 were
then reverted with the arc; item 2 — the sort fix — STAYED, it is not part of SSR/shadows):

1. **Night fps 110 → 60–70.** The v1 march ran on every reflective car pixel at any distance, and the
   capture stored the MSAA depth every frame. Tuned: march gated to the NEAR FIELD (`SSR_RANGE` 45 u —
   beyond it the paint mip buries SSR content in the probe anyway), 16 → 12 steps (reach ~26 u), capture
   - depth store every 2ND frame, offset from the probe's frames so the two extra passes never stack.
     Field: back to 80–90 at night, then the user's full display sweep (16·display-sweep) read five scenes
     vsync-locked 120 Hz. Cost scales with car SCREEN AREA within 45 u, not car count — a wall of close
     cars is bounded by one fullscreen march.
2. **Wheel through the windscreen again at down-looking angles.** The round-6 centroid sort can't
   represent a raked glass sheet: the windscreen's CENTRE sat behind the wheel while its overhang was in
   front. Sort key is now `centroid distance − bounding radius` (the submesh's nearest extent; builder
   computes the radius, fixtures regenerated) — large sheets bias LATER in the back-to-front order, the
   correct side of every near-tie. Verified across 5 pinned azimuths (lab `?az=DEG&el=N`, new).
3. **No shadow under cars in the game.** The decal rode the bind-pose wheel-bottom plane under the root —
   physics settling/suspension drops the chassis below that, so the quad sank under the road and the
   depth test ate it whole (the lab's ideally-seated bench car hid this). The host now raycasts the
   ACTUAL ground (`physics.groundBelow`, own body excluded) and lifts the quad 8 cm above the hit; an
   airborne car casts nothing.

**Remaining night variance (70–110 by location, NIGHT ONLY — day stable, no `?ssr=0` attribution):** the
known night-lighting territory — the per-vertex street-lamp pool over the world, per-pixel dynamic
headlights while driving, the night bloom profile — i.e. plan 17's subject, not this plan's. Field input
recorded for the plan-17 round.

## Decision log

- **2026-07-14 — v1 REJECTED in the field, deep rework parked here.** Two shader rounds (an additive sky term,
  then a clearcoat with HDR sky + clouds + flakes) both read as "matte paint with a highlight". The failure is
  structural (sky-only source, flat panels, no tonemapper), not numeric. The user's call: leave v1 in the
  tree, plan the rework properly rather than iterate on constants.
- The v1 numbers, for whoever picks this up: `REFLECT_HDR`, `REFLECT_GROUND`, `CLEARCOAT_F0`,
  `PAINT_ROUGHNESS`, `PATTERN_MIX`, `FLAKE_SCALE`/`FLAKE_AMOUNT`, `SPEC_POWER`/`SPEC_GAIN` in
  `packages/engine/src/render/shaders.ts` (the `rigid` module). The escape hatch is the config preset.
- **Prod comparison — VERIFIED IN CODE, and it answers the natural objection ("but prod managed without all
  that, and it looked fine"):** it did NOT
  manage without it. The three path already HAS items 1 and 2 of this plan, which is exactly why it looks
  better than our v1:
  · **tonemapping** — `plugins/postfx.plugin.ts:183` (`ToneMappingEffect`), switchable via
  `graphics.toneMapping` / `toneMappingMode` (`game.ts:684`). Its highlights roll off; ours clip flat.
  · **a real prefiltered environment probe** — `plugins/vehicle-reflection/vehicle-reflection.plugin.ts:83`:
  a `CubeCamera` into a `WebGLCubeRenderTarget` with **`generateMipmaps: true` + `LinearMipmapLinearFilter`**,
  i.e. a roughness MIP chain. Our `mix(sharp, blurred)` is a hand-rolled stand-in for precisely this.
  · plus `MeshPhysicalMaterial` clearcoat (`presets.ts` → `enhanced`: clearcoat 1, roughness 0.15).
  The own engine has NEITHER a tonemapper NOR a probe. That is the whole gap — not shader constants.

## Done means

Side-by-side against the three path at noon, dusk and midnight: our paint reads at least as deep as prod's,
with recognisable world content in the reflection, a stable (non-crawling) flake sparkle, and street lamps
sweeping across the bodywork at night. Bench: ≤ +1.0 ms GPU p95 at 2× retina for the whole stack.
