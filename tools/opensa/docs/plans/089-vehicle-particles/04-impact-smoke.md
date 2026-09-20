# 089/04 — Impact smoke

**Status: SHIPPED 2026-07-28** (branch `089-04-impact-smoke`), awaiting the field verdict. The shortest
step of the chain by design: the lane exists (089/01), the event exists (the damage system's strong-hit
drain), and this step only connects them.

## Shape

- **The trigger is NOT new**: `PhysicsWorld.takeImpacts()` DRAINS, and `VehicleDamageSystem` is its sole
  consumer (a second listener would race it — the readme called this out). The damage system now exposes
  `onStrongHit(force, point)`, fired for exactly the impacts that pass its calibrated gate
  (`STRONG_HIT` 300 kN, now exported) on a registered vehicle — so **"a hard crash puffs, a kerb tap does
  not" is inherited from the panel-damage calibration**, not re-tuned for smoke.
- **The sink** (`engine-vehicles.ts`): repositions the shared collisionsmoke emitter to the contact point
  and bursts 3–8 puffs, life and opacity scaled by how far past the gate the force went (full at ~4× the
  gate). The ramps are an eye-fit → `docs/hacks/impact-smoke-fit.md`; bursts are instantaneous, so sharing
  the tyre-smoke emitter is safe.

## Verification

- **Tests** (`vehicle-damage.system.test.ts`, negative first): the sink never fires for weak, pointless
  (no contact point) or foreign-body impacts; fires with the force and the contact point for a strong hit
  on a registered car.
- **Headless kerb-mount lap** (square into a pavement edge, gLong spiking to −63 g): a translucent smoke
  cloud at the kerb on the strike, dissipating over the next seconds. Cost story unchanged from 089/01's
  record — a crash is 3–8 one-shot particles.

## Open / next

- AI-car crashes puff too (the damage system registers every spawned car) — by design; the burst is tiny.
- Step 5 (surface-driven dust/grass/sand, depends on 081/10's surface reads) is the chain's remaining
  step, plus the plan-level acceptance drive across all four effects.
