# 006 — Tuned traffic for every stock car

**Status: BUILT 2026-08-19** (the user's YES). The other half of what the old tool wrote into
`ModelVariations_Vehicles.ini`: for every stock car that has paintjobs or tuning parts, a section that lets
ModelVariations spawn it tuned:

```
[blade]
Global=536,paintjob1,paintjob2,paintjob3,paintjob4,bnt_b_lr_bl,exh_lr_bl1,…,wg_r_lr_bl1
TuningFullBodykit=1
TuningChance=75
ChangeOnlyParked=0
```

Derived, not authored: `Global` = the car's own id, `paintjobN` for each `<slot>N.txd` the built archive
holds for the slot, then every part on the car's `carmods.dat` line (stock or replacement — read off the
BUILT file, so a replacement car with a different bodykit gets ITS parts); the three keys are the tool's
defaults, overridable from a small config (`TuningChance`, `TuningFullBodykit`, `ChangeOnlyParked`) so the
user tunes the feel without touching code. A base section that 004 also writes gets BOTH: `Global` carries
the added ids AND the paintjobs/parts (the old build's sections show exactly this union).

## Steps

1. A pure builder: (slot, id, paintjob count, carmods line) → section; the merge is 012's.
2. Config: `add-vehicles.json` in the source root (optional) with the three defaults and an `exclude` list
   (the mod's own `ExcludeModelsFromInheritance` exists for the same reason — police, emergency, trains).
3. Composition test with 004 (one section, both sets of keys); idempotence.
4. Field: traffic shows tuned stock cars at roughly the configured rate; the config change is visible on the
   next run without a rebuild of anything else (it is an ini merge).

## Measured

**Built 2026-08-19.** `add-vehicles/tuned-traffic.ts`; the merge is 012's `mergeIniKeys` and the `Global`
composition is 004's `extendGlobal`, which grew a fourth argument for non-id tokens (`paintjobN`, a part
name).

**Everything in the section is read off the BUILT tree**, which is what makes it work for cars nobody has
authored a rule for: the model's id from `vehicles.ide`, one `paintjobN` per `<slot><N>.txd` the ARCHIVES
actually hold (counted upward until one is missing, the way the game numbers them), and the parts on the
model's `carmods.dat` line — so after 005 an added car gets its own DERIVED part names, and a replacement
car gets whatever bodykit it shipped.

**One section per model, and the two writers compose in it** — the point of 004's decision. On the clone:

```
[elegy]                                     ← the base: 004's added id AND 006's tokens, one Global
Global=562,19113,paintjob1,…,paintjob4,exh_a_l,exh_c_l,…,spl_a_l_b
ChangeOnlyParked=0
TuningChance=75
TuningFullBodykit=1

[118veh]                                    ← the added car, with the names 005 derived for it
Global=19113,paintjob1,…,exh_a_l_118veh,exh_c_l_118veh,…
```

**Measured**: **103 models** given a tuned section on a four-added-car run; the ini 111 sections / 15 939 B
(the user's old build: 172 sections / 13 570 B — it wrote each model TWICE, once by name and once by id,
which is the shape 004 replaced). A second run is byte-identical, and a changed `tuningChance` shows up on
the next run without touching anything else in the file.

Config: `add-vehicles.json` in the source root, every field optional —
`{ "tuningChance": 75, "tuningFullBodykit": 1, "changeOnlyParked": 0, "exclude": ["police", …] }`. The
exclude list is folded, so a model matches however it was typed. **No config file is shipped**: the
defaults are the ones the user's earlier build ran, and a file is only worth writing when he wants
something else.

Tests: 10 in `tuned-traffic.test.ts`; add-vehicles 56.

## 2026-08-22 — the NITRO upgrades never reach `Global`

His call, and it needs no crash to justify it: tuned traffic exists so a city of factory-fresh bodies does not
look identical, and `nto_b_l` / `nto_b_s` / `nto_b_tw` show **nothing** from outside a car. Every tuned spawn
was asking the plugin to mount three parts a passer-by cannot see. Measured on the built ini: **154 of the
sections carried them, 457 tokens in all**, and a stock line like `comet, nto_b_l, nto_b_s, nto_b_tw` is nitro
and nothing else — so for those cars the whole tuned section was mount work with no visible result. Such a
model now gets no section at all, which is what "nothing to tune" already meant here — **but a nitro-only car
that HAS paint jobs keeps its section** (his call, the same day): the paint is a reason on its own, and it is
the reason the token list, not the part list, is what decides. Pinned by a test.

The filter is by the `nto_` PREFIX rather than by three ids, because a prefix is what SA's own loader
classifies a component with (`CAtomicModelInfo::SetupVehicleUpgradeFlags`) — the family name is the game's,
not ours. `SKIPPED_UPGRADE_PREFIX` in `tuned-traffic.ts`.

**What this is NOT**: a diagnosis of the `0x007F0BF7` crash (frame-not-found while installing a tuning part)
that reproduced twice in a helicopter and stops when `ModelVariations` is removed. The nitro family is under
suspicion because it is what every tuned spawn mounts, but nothing has pinned the crash to a car or a part
yet, and he has flown that build before without seeing it. Tested first as a hand-stripped ini in the bottle,
with the same rule, before any rebuild.
