# ModelVariations 10.7: a section keyed by NAME and a section keyed by ID are not the same thing

**A fact about the plugin the reference install ships** (mod `11` of the `sa` layer), not about OpenSA.
Field-established 2026-08-20 across two rounds, after two defects that both came from reading its ini as one
uniform shape.

## The two kinds of section, and what each is for

| header | what belongs in it | example |
| --- | --- | --- |
| **a model's NAME** — `[blade]` | what that model IS: its `paintjobN`, its tuning parts, its `Trailers1`, `TuningChance`, `TuningFullBodykit` | `[blade]` `Global=536,paintjob1,…,spl_b_lr_bl` |
| **a model's ID** — `[536]` | nothing but the ids that may spawn in its place | `[536]` `Global=536,19110` |

Both may exist for one model at once and both hold — the user's earlier build ran that way for a long time,
`[towtruck]` keeping its `Trailers1` while `[525]` carried its variation list.

**Mixing them is the first defect.** Put an added id into a NAME section and the two models share one token
list, so the added car wears the section model's parts: a 1958 Pontiac appeared in traffic with the blade's
continental-kit spare wheel, which is modelled to sit on the blade's trunk and hung in the air behind it.
The plugin has `ExcludeModelsFromInheritance` for exactly this, and it is not needed once the lists are kept
apart — there is nothing left to inherit.

## An ADDED car's own section must be keyed by its ID

**The second defect, and the more expensive one to read**: with `[059veh]` carrying its paintjobs and its
parts, the car spawned in traffic **untuned**, while Transfender showed the same car tuning perfectly.

The plugin resolves a section header to a model when it reads the ini. A stock name always resolves. An
ADDED car's name does not exist at that moment: the `vehicles.ide` row that gives the id a name is merged by
Mod Loader out of `modloader/added-vehicles/`, and nothing guarantees that happens first. So `[059veh]` binds
to nothing and is dropped, silently. `[19050]` binds directly and works.

Transfender is what makes this hard to see: the mod shop mounts parts itself and never asks the plugin, so a
car whose section was dropped tunes perfectly by hand and never in traffic. **A tuning defect that shows in
traffic but not in the shop is a plugin-binding defect, not a data defect.**

## What OpenSA writes, on that reading

`tools/add-vehicles` writes the variation list into `[<base id>]` under a `### <base name>` caption, and an
added car's own tuning section into `[<added id>]` under `### <slot>`. Stock cars keep their NAME sections,
which is where their own tuning already lived. Neighbours:
[`modloader-data-files.md`](modloader-data-files.md) for what Mod Loader merges and when.
