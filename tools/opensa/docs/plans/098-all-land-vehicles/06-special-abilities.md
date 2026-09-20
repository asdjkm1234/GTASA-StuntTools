# 098/06 — Special abilities (the content wave on the 02 module)

**Goal:** the car-scoped abilities from the VSA catalogue become live registry entries: hydraulics first
(the user's own example class), then the moving-`misc_*` family. Each ability = detector + fixture field
+ driver + contract row, addable to ANY car by token — the whole point of the module. **Field checkpoint
4: a lowrider bounces; the same token moves the ability onto a mod car (glendale) after `--rebake`.**

## Scope decision (from the VSA catalogue, 15 classes)

| VSA class | Verdict here |
| --- | --- |
| UP/DOWN_LIGHTS | live since 084/02; migrated in 02 |
| ADV_HYDRALICs / BF engine+hydraulics | **build** — the headline ability |
| BUCKETs (dozer), CISTERNs (cement), PACKERs | **build** — state/input-driven `misc_*` articulation |
| TRUCK_HOOKs, TRACTOR_HOOKs, TRAILER_HOOKs, BAGGAGE_* | consumed by 05's hitch framework (tokens defined there) |
| BAGBOXA / BAGBOXB / TUGSTAIR (baggage trailers, tug stairs) | consumed by 05 as towed bodies; the tokens exist so a mod trailer can declare itself (2026-08-18) |
| TURRETs_1/2 | **out** — needs an aim-input surface; recorded extension with the input-wire restriction noted |
| WATER_JETs | **out** — an effects-system feature, not an articulation; recorded in `docs/features/vehicle-effects.md` as a known gap |
| PLANE_SMOKE | out of chain scope → the 0.6.0 note |

## What exists

- The 02 registry (detector → fixture field → driver → rig articulation channel) and its contracts
  vocabulary.
- 01's `handlingFlags` — SA's own hydraulics marker bit (exact bit recovered from gta-reversed
  `handlingFlags` docs/enum, cited in 01) — so STOCK lowriders get the ability from their authored row,
  and the token adds/removes it per mod. Both paths through one detector.
- The suspension surface: per-wheel rest/limits already flow through `suspensionSetup`
  (`physics-world.ts:2003-2068`); the 081 sag rule (static sag ≤ a share of authored travel) is the
  guard-rail any hydraulic pose change must respect — raising a corner must not silently violate what
  081 fixed.
- 41 stock models carry a non-pod `misc_*` (`build-vehicle-model.ts:859-860`) — the detector inventory
  for the moving-part family.

## Steps

- [ ] **Hydraulics.** Detector: handling flag OR token. Driver: per-corner suspension target
      manipulation through the existing setup surface (raise/lower/lean, bounce impulse), input scheme
      decided with the user at field time (SA's numpad scheme is the reference, not the spec — keyboard
      pedal lesson from 089: keys are binary, shape the response curve accordingly). Physics numbers
      (rest deltas, impulse) measured on the test track before field. Any fitted response constant →
      `docs/hacks/`.
- [ ] **Moving `misc_*` family.** One recon pass over the 41-model inventory to classify what each part
      IS (gta-reversed `CAutomobile::PreRender` misc handling — recover the stock semantics: cement
      cistern constant-rotate, dozer bucket input-driven, packer platform cyclic, tractor hook).
      Implement as registry drivers on the articulation channel: constant-rotate class first (cement —
      zero input surface), then input-driven (dozer bucket on a modifier key), then cyclic (packer).
      Each lands with its contract row; parts whose semantics stay unrecovered are RECORDED as such,
      not animated by guess.
- [ ] **Ability × damage/extras interaction check:** a `misc_*` that is also damage-grouped or an
      `extra` must keep both behaviours (the locked-dff/whole-car lesson says render-side surprises
      hide here) — negative tests first.
- [ ] **Docs:** `docs/features/vehicle-special-abilities.md` state per ability; contracts vocabulary
      rows; extension records for turrets/water-jets.

## Verification

Headless: detector census over the whole fleet (which models gain which ability, printed and committed
as a fixture — a diff in that census is a reviewable event); **the census has an ORACLE since 2026-08-18:
every stock carrier in `VEHICLE_FEATURE_TOKENS` (011's table — `zr350` for `UP/DOWN_LIGHTS`, `hotknife`/`bandito`
for `ADV_HYDRALICs`, `dozer` for `BUCKETs`, …) must be detected from its OWN asset WITHOUT a token, and a
detector that needs the token to find its stock carrier is a detector that has not recovered the rule**;
rebake byte-compare for cars with no abilities. The `sa`-side twin of every token — what the real game does
with the same `features.txt` — is vehicle-installer plan 011, and a mod car's declaration is checked on BOTH
targets before a token is called live. Field: the checkpoint above — bounce a stock lowrider, then `vehicle-installer --rebake`
glendale with the hydraulics token and bounce IT; drive the cement truck and watch the cistern turn.
Numbers (suspension deltas, per-frame driver cost with N ability cars live) into the ledger +
benchmarks.

## Ledger

(census snapshots, recovered misc semantics with refs, field verdicts, driver frame cost)
