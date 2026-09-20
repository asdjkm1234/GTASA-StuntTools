# 004 — Traffic: the car as a ModelVariations variation of its base

**Status: BUILT 2026-08-19.** Why an added car is ever seen without a cheat: ModelVariations 10.7 (mod 11,
`sa` layer) swaps a spawning stock car for one of the ids listed in its section. The merge is 012's
(`model-variations.ts`); this plan decides what to write and reads the user's old output for the shape.

## The shape (from the old build, `modloader/Model_Variations/ModelVariations_Vehicles.ini`)

```
### manana
[<mananaId>]
Global=<mananaId>,<001vehId>[,<otherAddedId>…]
```

One section per BASE slot, keyed by the base's ID (the mod accepts ids and names; the old build used ids),
`Global` = the base itself first (so stock still spawns) then every added car naming it. A car with several
`(base1, base2)` appears in each. `model-variations-extra.txt` blocks (trailers, siblings — with `{{name}}`
resolved to the ADDED slot's freshly allocated id when the name is an added slot, or the stock id otherwise)
merge as their own sections; 006 (tuned traffic) adds the `TuningFullBodykit`/`TuningChance` keys to the same
base sections — the section merge is by name, so the two plans compose without order.

## Steps

1. Build the per-base `Global` lists from the ledger (slot → id, bases) and merge each `[<baseId>]` section
   through 012's merge: `Global` is REPLACED with `<baseId>` + the sorted added ids; any other key in the
   section is kept (006's, the author's `Trailers*`). Idempotent.
2. `model-variations-extra.txt` per car → 012's merge with the `{{name}}` resolver fed the ledger first and
   the built IDEs second; an unresolved name is logged and left as authored.
3. Refuse — naming the mod — when `modloader/Model_Variations/ModelVariations_Vehicles.ini` is not in the
   built tree: an added car that nothing spawns is a car nobody will ever see, and that should not be
   silent.
4. Tests — the section composition with 006's keys present, multiple bases, `{{name}}` to an added id, the
   refusal.
5. Field — drive the base's neighbourhood (manana spawns in the poor-family groups): the Vega appears;
   `rdtrain` pulls its authored trailer set.

## Measured

**Built 2026-08-19.** `add-vehicles/traffic.ts`; the merge is `vehicle-installer`'s, which gained
`mergeIniKeys` (merge single KEYS into a section, keeping every other key it has) and `readIniKey` beside
012's section-level merge.

**Two decisions the old build's own output forced, and they went the other way from the plan:**

1. **One section per model, keyed by its NAME.** The old tool wrote the tuning keys into `[voodoo]` and the
   variation list into `[412]` — the SAME model addressed two ways, in two sections; whichever the plugin
   reads last is the one that survives, so one of the two was doing nothing in that build. We write one
   section per model and merge by key, which is also what lets 006 add its tuning keys to the same section
   without either plan caring about order. **Not field-proven** — it is a row in the plan-102 field round.
2. **`Global` is EXTENDED, never rewritten.** Writing the key outright cost `petro` and `towtruck` their
   trailers: both are the base of an added car AND author `Global=Trailers1` (a reference to the key beside
   it), so the authored value was replaced by ids and `Trailers1` was left defined and referenced by nothing
   — a behaviour that silently stops happening. Now `[petro]` reads `Global=Trailers1,514,19055`.

**Traffic speaks for the whole TREE, not for the run.** The registration is written from the LEDGER after it
is merged, so `--only 001veh` does not drop the other 114 cars out of their bases' lists (verified: after an
`--only` run `[freibox]` still lists all eight of its carriages).

**Full run on an APFS clone:**

| | |
| --- | --- |
| base sections written | **101** — one per stock slot the fleet varies |
| the ini | 1 section (`[Settings]`) + 8 authored + 100 → **108** |
| a base with 8 added cars | `[freibox] Global=590,19078,19079,…,19085`, ascending |
| a base that also authors trailers | `[petro] Global=Trailers1,514,19055`, `Trailers1` untouched |
| a second run | ini byte-identical |

Tests: 10 in `traffic.test.ts`; add-vehicles 35, vehicle-installer 185.

**Left as authored, on purpose**: `petro`'s and `rdtrain`'s `{{205veh}}`-style placeholders name added cars
that are not in this fleet at all (the numbering runs to 169veh), so they stay unresolved and the plugin
logs them — dropping an author's line would be worse than a log line nobody reads.


## 2026-08-20 — the section shape was wrong twice, and the field said so twice

This plan chose **one section per model, keyed by NAME**, and wrote the added car's id into its base's
section. Both halves were wrong, and the user's earlier build had had it right all along:

1. **The variation list belongs in an ID-keyed section that carries nothing else.** In the base's NAME
   section it shares a token list with the base, so the added car wears the base's parts — a 1958 Pontiac
   with the blade's continental-kit spare wheel hanging behind it. Fixed by writing `### blade` / `[536]` /
   `Global=536,19110`; `ExcludeModelsFromInheritance` was armed for a session and reverted unused, because
   with the lists apart there is nothing to inherit.
2. **An added car's OWN section must be keyed by its ID too.** `[059veh]` left the car untuned in traffic
   while Transfender tuned it perfectly: the plugin resolves a header to a model, and the added car's name
   does not exist at that moment — the `vehicles.ide` row that gives it one is merged by Mod Loader out of
   `modloader/added-vehicles/`. Keyed `[19050]` it works.

The reasoning this plan used against the shape — that a model addressed twice would have one section
overwrite the other — was never tested; the user's build ran both for a long time. Recorded as a fact about
the plugin in
[`gta-sa-original/model-variations-sections.md`](../../../../docs/gta-sa-original/model-variations-sections.md).
