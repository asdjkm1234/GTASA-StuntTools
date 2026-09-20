# 070 — Local lights: headlights & street lamps (de-corona)

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**

> **The unticked boxes below are VOID with the plan, and are struck rather than deleted (2026-08-11).**
> They were left as `- [ ]` when the chain was closed, so every repo-wide scan for open work kept
> reporting them — 118 phantom tasks across the ten closed chains. Nothing here is a debt: the banner
> above is the authority. They stay readable because what these plans INTENDED is still the record of
> why the own engine does what it does.


Part of the [rendering overhaul chain](../062-rendering-overhaul/readme.md). Depends on [064](../064-hybrid-world-lighting/readme.md) — a world that can RECEIVE light is what makes real local lights possible at all (038's unlit world was why headlights became glow+corona MVP, plan 033). Delivers the requested move away from the corona concept — partially: coronas remain as distant impostors.

## Context

- **Headlights** (`vehicle-headlight.system.ts`): lamp-glass emissive + 4 corona sprites, explicitly "to be redone properly"; no light hits the road.
- **Street lamps / 2dfx lights**: corona `Points` clouds per cell (`corona.ts`, `collectCoronas` in build-region); the pool of light under a lamp is BAKED night prelit, not projected light.
- three's forward renderer pays per-light per-object cost; dozens of real `PointLight`s would recompile programs and kill the frame. A custom light pool inside our world shader avoids all of that — we own the shader (038/002 legacy).

**Ruled out** (from the earlier headlights investigation, `vehicle-headlight.system.ts` notes — do NOT retry as-is): a real three `SpotLight` (can't light the world material meaningfully, barely visible even on dynamics), and a flat ground **decal / light-pool quad** on the road (sliced by uneven geometry, z-fights, ignores slope — reads badly). The pool term below is instead **per-fragment in world space** (using the world shader's existing `vWorldPosition`, already there for shadow sampling), so the beam conforms to road/curbs/walls/slopes automatically — that's precisely why it beats a decal.

## Decisions

1. **Custom clustered-ish light pool in the world material** (not three lights): a uniform array of the **N nearest/strongest lights** (N=16 base, 32 high tier) — position, colour, radius, cone (for spots). World shader iterates the array (cheap: no shadows, smooth radius falloff). Dynamics (MeshStandard) get the same lights mirrored as a few real three `PointLight`/`SpotLight` capped instances, or the same custom term injected — measured decision.
2. **Light sources registry**: 2dfx light entries (already collected per cell for coronas) become `LightDef`s with SA semantics (colour, radius from the 2dfx record, on-hours like tobj). A `LocalLightSystem` maintains the active pool by camera distance + priority (headlights of the player's car always win a slot).
3. **Headlights = 2 spot entries in the pool** + a **projected cookie** (the classic SA headlight texture projected onto the road via the spot cone term) + keep lamp-glass emissive. Beam visible on the road at night — the actual ask. Tail/brake lights: small red radius lights when braking.
4. **Corona demotion, not deletion**: within pool range the real light + bloom carries the look and the corona sprite shrinks/fades; beyond pool range the corona remains THE representation (SA-correct at distance, and free). One smooth handover curve, no popping (verify by driving toward a lamp line at night).
5. **No shadow-casting local lights** in this chain (budget); the pool term is purely additive light. Document as a known limit.
6. **Budget**: ≤ 1.0 ms at night in LV (worst corona/lamp density) for the pool term + projector.
7. **Wall-correct beams need normals; ground-only is the MVP.** Climbing the beam up walls uses N·L, so it wants decent normals — the map-optimizer conditioning (welded smooth normals, shipped) + 002's lit world provide them. A **ground-only** pool (assume an up-normal + cone) is the cheap fallback if per-fragment N·L is too costly or an area's normals are unreliable: ship the road pool first (the visible win), add the wall response after.

## Vehicle-lamp slice SHIPPED (2026-07-10 — the user-requested first half)

The user asked for the vehicle side first, done properly:

1. **The classic SA lamp-texture swap wired**: `build-vehicle.tagHeadlights` had already paired
   `vehiclelights128` ↔ `vehiclelightson128` (from vehicle.txd, same UVs) into `userData.lightsOnMap/OffMap`
   — but nothing consumed it. `setLamps` now swaps the material map when the lights turn on/off, on top of
   the existing per-type emissive (head warm-white / tail red, brake brightens).
2. **The world-shader LOCAL-LIGHT POOL core landed** (`worldLocalLightUniforms`, 8 slots, plan 070's
   central mechanism): per-fragment point/spot term with smooth radius falloff, cone, and **N·L via a new
   `vWsNormal` varying — beams follow road/kerbs/walls** (the per-fragment approach the plan chose over
   decals). Empty pool → `uLocalCount 0` → early-out (day cost ≈ 0). Modern pipeline only.
3. **Lamp identification RE-DONE from the data (two user-found bugs; final state confirmed: looks superb).**
   - _admiral (W123 mod) showed no lights._ Dumping both DFFs disproved this repo's own comment ("the marker
     colour is a per-lamp id, NOT front/rear"): SA encodes the lamp in the **material MARKER COLOUR**, and
     stock `admiral` and the mod use the identical four — `255,175,0` front-left, `0,255,200` front-right,
     `185,255,0` rear-left, `255,60,0` rear-right. We were instead guessing by centroid-to-dummy distance,
     which fails whenever the lamps live in a NON-identity frame (the mod puts them in `light_glass`; stock
     keeps them in `chassis`, which is why only stock worked). `lightType` now comes from the marker
     (transform-independent); the dummy heuristic stays as a fallback for unmarked models.
   - _stock `benson` lit up as blank white slabs._ The emissive was a flat colour that swamped the texture.
     Lamps now glow **through their own texture** (`emissiveMap = map`) — the lit atlas cell keeps its
     reflector/bulb detail and the red tail hue; the emissive only drives how hard it blooms. The atlas swap
     (`vehiclelights128` → `vehiclelightson128`, both in generic `vehicle.txd`) sets `needsUpdate` properly.
   - Per-material lamp handling extracted to `applyLampState` (complexity cap).
4. **Vehicle lamps feed the pool**: slots 0/1 = headlight SPOTS (forward-down ~38° cone, warm, radius 26 u,
   the road beam finally exists), slots 2/3 = tail POINTS (red: dim running → bright + wider on brake — the
   asphalt behind glows red when braking).
5. **Calibrated after the first in-game look** (user: works great, but overexposed): shader wrap term
   0.45 → 0.25, squared cone falloff (the plateau read as a hard searchlight blob), and the magnitudes moved
   into config — `headlights.beamIntensity` (2.2), `beamRange` (34), `brakeIntensity` (1.6) with sliders in
   Graphics. Measured why the first pool was invisible: a headlight grazes the road, so hard N·L gave
   L≈0.14 at 6 m (invisible); wrap lighting lifts it to ≈1.6 while walls/kerbs still respond to N·L.

## Street-lamp slice SHIPPED (2026-07-10)

6. **`LightDef` extraction — one collection, two consumers (as the plan demanded).** `collectCoronas` already
   walked every model's 2dfx lights and placed them per instance; `buildCoronaPoints` now stashes that exact
   array on the Points as `userData.lightDefs`. No second clump walk, no new parsing.
7. **`StreetLightSystem`** (`packages/game/src/lights/`): lifts those defs from the streamed cells (rebuilt
   every 30 frames — cells stream slowly), picks the nearest few within 34 u, and writes them into pool slots
   **4+** (the vehicle system owns 0–3; the two systems never fight over `uLocalCount`). Lamp radius derives
   from the authored corona size; colour from the 2dfx colour; strength scales with the night factor.
   Selection policy is the pure, unit-tested `selectLamps` (`light-pool.ts`) with **hysteresis** — an
   incumbent keeps its slot unless a rival is clearly nearer, so driving down a lamp row doesn't thrash slots.
8. **Corona demotion, not deletion** (plan decision #4): `uPoolHandover` fades a corona sprite to 35 % as you
   approach a pooled lamp — the real light carries the look up close, the corona stays THE representation at
   distance (SA-correct, and free). Modern pipeline only; classic keeps full coronas.

## Tasks

- [~] `LightDef` extraction from 2dfx light records (reuse `collectCoronas` walk — one collection, two consumers: corona points + light defs) incl. on-hours; unit tests on fixture models (streetlight DFFs).
- [~] `LocalLightSystem`: pool selection (distance/priority/hysteresis to avoid slot thrash), uniform packing, per-frame update in canvas-host.
- [~] World-shader light-pool term (point + spot cone, smooth falloff, night-gated); program-variant safety (pool size fixed at compile, count as uniform).
- [~] Dynamics path: mirrored capped three lights vs injected term — spike, measure, pick.
- [~] Headlights: 2 spot slots per active vehicle (player + nearest AI few), cookie projection texture, brake/reverse states; retire the "no road beam" MVP note in plan 033.
- [~] Corona handover: distance-based fade curve tied to pool membership; drive-by bench (no popping, no double-brightness at the crossover).
- [~] Config `graphics.lights` grows `{pool: 16|32, headlightProjection: bool}`; debug overlay: pool occupancy readout.
- [~] Bench: LV strip at night, downtown LS rain night (wet-look synergy noted for 009).

## Verification

- Night drive: headlight beam pools visibly on the road and walls, follows the car, brake flare works.
- LV lamp rows: pools of light under lamps from the POOL (not only baked prelit), coronas take over seamlessly at distance.
- Budget: ≤ 1.0 ms worst case; zero cost by day (pool empty → early-out).

## Measurements

_(record after implementation)_

- pool term ms at N=16/32 in LV night: …
- headlight projector ms: …
- chosen dynamics path: …
