# vehicle-cutscene

**Status: plans 002–006 are all DONE.** Both car gates PASSED (2026-08-12), the bike branch
FIELD-PASSED first round (2026-08-13, scene STRP4B2), the boat branch structurally verified (no stock
scene plays csdinghy — the named gap), the [plate bake](docs/plans/003-plate-bake.md) FIELD-PASSED
first round, the [35-scene sweep](docs/plans/004-full-scene-field-review.md) was approved 2026-08-14
after 23 fix rounds, the [seat retarget](docs/plans/005-seat-retarget.md) shipped with it, and the
tool's pmb-pipeline route was field-accepted 2026-08-15. The full 23-model fleet converts with 0
errors in ~3.5 s, or ~2.4 s emitting only its three outputs
([numbers](../../docs/benchmarks/tools/2026-08-13-vehicle-cutscene-fleet.md),
[006](../../docs/benchmarks/tools/2026-08-15-vehicle-cutscene-no-base-copy.md)).

Converts installed **vehicle mods** into their **cutscene counterparts** — the `cs*` models in
`models/cutscene.img` — so the real game's cutscenes show the same custom cars the player drives.
23 cutscene vehicle models across 21 `vehicles.ide` slots (cars + one bike + one boat), each rebuilt from
the mod's gameplay DFF by frame surgery: flattened rig, HAnim skeleton with the vanilla model's bone ids,
four instantiated wheels, baked carcols paint, empty `txdp`-resolved TXD.

```bash
# census + readiness report (writes nothing):
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in mods-src/original/vehicles --inspect

# convert the fleet into an output game (--self-contained-txd embeds mod TXDs for a stock-gameplay target):
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in mods-src/original/vehicles --out <dir>

# emit ONLY the three files the tool writes (models/cutscene.img, data/txdcut.ide, anim/cuts.img) —
# the field-delivery shape; --out is not wiped and may not be the game itself:
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in mods-src/original/vehicles --out <dir> --no-base-copy
```

`--in` is read by the SAME resolver `vehicle-installer` uses (`@opensa/tool-kit/vehicles-dir`), so a
structured folder — `models/` overridden per slot by `new/` — gives the cutscene fleet exactly the cars the
driving fleet got (vehicle-installer [plan 007](../vehicle-installer/docs/plans/007-models-and-new.md)).

- [001 — architecture + research record](docs/plans/001-architecture.md) (the census, the rig contract,
  the decisions)
- [002 — implementation](docs/plans/002-implementation.md) (prioritized steps, field gates)
- [003 — plate bake](docs/plans/003-plate-bake.md) (readable cutscene license plates — vanilla shows blanks)
- [004 — full scene field review](docs/plans/004-full-scene-field-review.md) (all 35 vehicle scenes swept
  via the override → per-scene verdicts → the user's approval)
- [005 — seat retarget](docs/plans/005-seat-retarget.md) (a riding actor is lifted onto the DONOR's seat —
  a scene-value pass, because the actor is not in the car's clump)
- [006 — `--no-base-copy`](docs/plans/006-no-base-copy.md) (emit only the three written files, byte-identical
  to the copy run — what makes the standalone converter usable on NTFS)
