# An added car in traffic wears its BASE car's paintjob and tuning parts

**FIXED 2026-08-20, field-confirmed the same day.** The shape came from the user: his earlier build had it
right and plan 004 had talked itself out of it.

**Two sections, two subjects.** A section keyed by a model's NAME is what that model IS — its `paintjobN`,
its tuning parts, its `Trailers1`. A section keyed by an ID carries nothing but the ids that may spawn in
its place. 004 put the added id into the base's NAME section, so the two models shared one list; now the
variation list goes into `### blade` / `[536]` / `Global=536,19110` and the added car has a section of its
own. **Nothing is left to inherit, so `ExcludeModelsFromInheritance` is not needed** — it was armed in the
bottle for a session and then reverted unused.

**And an added car's own section is keyed by its ID too, which cost a second field round.** Keyed
`[059veh]` the car spawned in traffic UNTUNED while Transfender tuned the same car perfectly: the plugin
resolves a section header to a model, and an added car's NAME does not exist when it does that — the row
that gives it one is merged by Mod Loader out of `modloader/added-vehicles/`, later. `[19050]` binds
directly and works. The stock names always resolved, which is why only the added cars were affected.
See [`gta-sa-original/model-variations-sections.md`](../../gta-sa-original/model-variations-sections.md).

**Also fixed alongside**: an added car's paintjob dictionaries ship LOOSE in `modloader/added-vehicles/`, so
counting them in the archives found none — 19 of the fleet's 46 were never offered, four cars losing all of
theirs to a base that has none.

---

**Open, 2026-08-19**, field-found by the user the first time added cars reached traffic (plan 102's round).
A car in the `blade` slot appeared with its paintjob sliding off the body and a spare wheel floating in the
air behind it.

## What it is NOT

**Not a model conversion.** On the `sa` target the installer converts nothing, and this was checked byte for
byte rather than taken from the comment that says so: `blade.dff`, `blade.txd`, `blade1..4.txd`,
`spl_b_lr_bl.dff` and `bnt_b_lr_bl.dff` in `models/vehicles*.img` are **identical** to the mod's own files in
`mods-src/original/vehicles/models/blade - 1964 Ford Thunderbird - gross/`.

## What it is

One ModelVariations section describes ONE model: the section is named after it, `Global` starts with its id,
and the rest of the list is **that model's** paintjobs and tuning parts. `add-vehicles` 004 puts the added
car's id into its BASE's section to get it into traffic, and the two now share one list:

```ini
[blade]
Global=536,19110,paintjob1,paintjob2,paintjob3,paintjob4,nto_b_l,nto_b_s,nto_b_tw,exh_lr_bl1,exh_lr_bl2,
       fbmp_lr_bl1,fbmp_lr_bl2,rbmp_lr_bl1,wg_l_lr_bl1,spl_b_lr_bl,bnt_b_lr_bl
```

`19110` is `115veh`, a **1958 Pontiac Bonneville**; the parts and paintjobs are the **blade**'s (a 1964
Thunderbird). `spl_b_lr_bl` is the blade's continental-kit spare wheel, modelled to sit on the blade's trunk
— on any other body it hangs in the air, which is exactly the photograph. The paintjob is the same story in
texture space: the blade's TXD over the Bonneville's UVs.

**Scale: 40 sections** carry an added id beside model-specific tokens — 32 with paintjobs, 22 with body
parts. Nitro (`nto_b_*`) is the one token that is safe on any body.

## The old tool never wrote this, and it is worth knowing why

`NO_COMMIT/1/build/modloader/Model_Variations/ModelVariations_Vehicles.ini` — the user's earlier, working
build — is one model per section throughout:

```ini
[blade]    Global=536,paintjob1,…,spl_b_lr_bl,bnt_b_lr_bl     ; no added id
[059veh]   Global=19822,paintjob1,…,exh_lr_11,exh_lr_12       ; its own id, its own parts
```

And its `cargrp.dat` carries no added id either — **so added cars were never in traffic in that build at
all**. Traffic is a capability plan 102 ADDED, and this defect is its cost, not a regression.

## The lever that was NOT needed, kept for the record

The plugin has the concept: `[Settings] ExcludeModelsFromInheritance=596,597,598,599,490,497,472,432,433` —
stock police and army models, kept from inheriting the settings of a section they appear in as a variation.
**All 115 added ids appended to that line in the bottle** (2026-08-19, bottle only; the tree is untouched).
The line is 725 characters, so read the plugin's own log echo first — a truncated list is the first thing to
rule out.

- **works** → one line in `add-vehicles`' ModelVariations writer, and the added cars keep their traffic;
- **does not work** → the section list itself has to change, and the two shapes are: drop the added id from
  any base section that carries model-specific tokens (those 40 cars leave traffic, the stock car keeps its
  tuning), or strip the base's tokens from the shared section (they stay in traffic, the stock car loses its
  tuned variants but keeps everything the mod shop offers). That is a call for the user, not the tool.

## Still unconfirmed

Which body the photograph shows. The floating part says it is the added car rather than the blade, because
the part fits the blade by construction — but the one-glance confirmation is the car's HUD name.
