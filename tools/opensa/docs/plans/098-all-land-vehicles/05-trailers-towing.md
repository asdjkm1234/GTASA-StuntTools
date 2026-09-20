# 098/05 — Trailers & towing (the first joints in the repo)

**Goal:** the 9 `trailer`-type models exist as towable entities: a cab hitches one, pulls it, reverses
it, detaches it — on a hitch framework that towtruck/tractor towing can reuse. **Field checkpoint 3:
hitch artict1 to a linerun, drive a lap, reverse without a jackknife explosion, detach.**

## What exists (recon 2026-08-04)

- Trailers parse (9 rows, 15 columns), bake `.osm` (`pack-vehicles.ts:55-88` is unfiltered) and spawn
  today — as driverless "cars": no seat dummy → fallback seat offset, fallback sedan handling if the id
  is missing (`gta-sa-world.adapter.ts:672-716`), fully enterable in principle. Nothing marks them
  non-drivable; 01's threaded `type` is the hook for that.
- **Field defect (2026-08-06, screenshots): the long semis do not stand level.** artict1 / artict2 /
  artict3 / petrotr spawn tipping nose-down over their rear bogie — the wheel rig only finds the rear
  axles, so the sprung chassis pivots until the kingpin end (or the landing-gear tip) digs into the
  road. Two consequences: the parked stance is visibly wrong, and the kingpin sits at ground height, so
  a cab cannot back under it — the attach flow depends on this being fixed first.
- **Zero Rapier joints exist anywhere** (`createImpulseJoint`/`JointData`/revolute/spherical: no hits).
  `PhysicsWorld` has no joint API. This plan introduces the first one.
- The closest articulation analogue is the door hinge subtree (`VehicleDoor.parts`, whole-subtree
  rotation) — render-side only, no physics.
- `meanFrontAdhesion` already falls back to the whole wheel set "when a model flags none as front
  (bikes, trailers)" (`enter-vehicle.system.ts:1355-1367`) — the one place the code already anticipates
  this class.
- Relevant restrictions: a dynamic body may only be created where static collision already exists; no
  reads before the world steps; the NaN chassis guard (`physics-world.ts:1440-1467`) will throw through
  a joint explosion — that is the failure detector, keep it loud.
- Wheel-count growth is a measured cost: `docs/performance/deferred-optimizations/surface-probe-per-wheel.md`
  priced per-wheel probes — a towed trailer adds wheels to the live set; re-measure, don't assume.

## Design

- **`PhysicsWorld` joint API** (minimal, explicit): create/destroy a limited spherical or revolute joint
  between two owned bodies, queried state (current articulation angle), impulse-threshold breakage
  optional and OFF by default. No general joint zoo — exactly what hitching needs.
- **Parked stance: an unhitched trailer rests level on its landing gear.** The models carry the
  support-leg geometry (visible in the field screenshots), so the stance DERIVES from the asset — the
  support contact point comes from the trailer's own geometry/collision, sag from its handling row,
  never a per-model constant. Recover how SA holds a detached trailer level (`CTrailer`'s landing-gear
  handling in gta-reversed) in the same recon step as the hitch convention — they are one convention:
  the kingpin height the stance establishes is the height the attach flow aligns against.
- **Hitch identification derives from the asset.** SA marks tow points with model data (`misc_a` towbar
  on cabs, trailer kingpin position) — recover the exact convention from gta-reversed
  (`CTrailer`, `CVehicle::GetTowBarPos`/`GetTowHitchPos`) in a short recon step BEFORE the framework is
  shaped; whatever the models don't carry comes as `TRAILER_HOOK`/`TOW_HOOK` feature tokens on the 02
  registry (the VSA catalogue lists the stock hook carriers as the reference set: linerun, tanker,
  rdtrain-class cabs; tug/baggage for the airport family). Every recovered name → contracts row.
- **Runtime:** proximity + reverse-alignment attach (manual first — back the cab up to the kingpin,
  attach on key or on contact, recover SA's rule as research not spec), anti-jackknife damping as a
  measured torque about the joint (numbers into the ledger, constant gets a hack file if fitted),
  detach input, trailer marked non-enterable via 01's type.
- **Stability programme:** straight-line at speed (sway), S-curves (whip), reverse articulation limit,
  kerb drop. Each a `?phys=` scene where expressible headlessly.

## Steps

- [ ] Recon step: recover SA's hitch-point + pairing convention AND the detached-trailer landing-gear
      handling from gta-reversed; write both into this file's ledger and `docs/contracts/vehicles.md`
      BEFORE coding the framework.
- [ ] Parked stance: unhitched artict1/artict2/artict3/petrotr stand level on the landing gear
      (asset-derived support point); field-checked against a line-up of all four before the hitch work
      — attach alignment depends on the kingpin height this establishes.
- [ ] `PhysicsWorld` joint API + unit coverage against the fake-GPU boot path (negative first: joint to
      a dead body, joint before step).
- [ ] Hitch framework: identification (asset + token), attach/detach lifecycle, joint limits from the
      recovered geometry.
- [ ] Trailer entity behaviour: non-enterable, lights later (they carry taillight dummies — record as
      06/07 extension), wheels live on the existing rig path.
- [ ] Anti-jackknife damping + the stability programme; scenes + captures.
- [ ] Towtruck/tractor + `farmtr1` reuse — stretch inside this plan ONLY if the framework lands early;
      otherwise recorded as the follow-up wave with the baggage family.

## Verification

Headless: joint unit suite; hitch attach/detach round-trip in the fake-GPU boot; stability scenes within
envelopes; car regression gate untouched. Field: the checkpoint lap above, judged also in reverse —
reversing an artic is the honest test of the joint, and the reporter's angle is "does it fight me
believably", not "does it not crash". Per-frame joint + extra-wheel cost measured with the `vehicles`
benchmark slice and recorded before/after.

## Ledger

(recovered hitch convention with gta-reversed refs; joint cost numbers; stability scene envelopes; field
verdicts)
