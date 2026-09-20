# An `objs` model is ONE atomic — what SA does with a clump that carries more

Recovered 2026-08-17 (open issue [`sa-lod-visibility-budget.md`](../open-issues/fixed/sa-lod-visibility-budget.md),
round 15 — the Burger Shot whose LOD "was absent"). Source: gta-reversed-modern `FileLoader.cpp` and
`Models/AtomicModelInfo.cpp` (`docs/links.md`); the RW list semantics from the SDK's `balist.h` (mirrored by
librw's `LinkList::add`).

## The loader

An IDE `objs`/`tobj` row is a `CAtomicModelInfo`. Its DFF is read by `CFileLoader::LoadAtomicFile`, which
walks the clump with `RpClumpForAllAtomics(clump, SetRelatedModelInfoCB)`. The callback, for EVERY atomic:

```cpp
GetNameAndDamage(frameNodeName, name, bDamage);          // "_dam" suffix → the damaged twin
CVisibilityPlugins::SetAtomicRenderCallback(atomic, nullptr);
if (bDamage) mi->AsDamageAtomicModelInfoPtr()->SetDamagedAtomic(atomic);
else         mi->SetAtomic(atomic);                       // m_pRwObject = atomic — the previous one is dropped
RpClumpRemoveAtomic(clump, atomic);
RpAtomicSetFrame(atomic, RwFrameCreate());               // a FRESH frame: any child-frame offset is gone
```

`CAtomicModelInfo::SetAtomic` is a plain assignment (`m_pRwObject = reinterpret_cast<RwObject*>(atomic)`, plus
2dfx/txd bookkeeping). So of N non-`_dam` atomics exactly ONE survives — the last the walk visits — and it is
drawn at the entity's origin whatever frame it was authored under.

**Which one is "last":** `RpClumpAddAtomic` inserts at the list HEAD (`rwLinkListAddLLLink`), and
`RpClumpStreamRead` adds atomics in file order, so `RpClumpForAllAtomics` visits them in REVERSE file order.
The last callback is the FIRST atomic in the file. For `burger01_LAw` that is the burger sign (atomic 0, geometry
0, frame `burger01_LAw3` at (7.18, −7.30, 1.01)); the building (atomic 1) is the one dropped.

## What R\* shipped, measured

Stock `gta3.img`, every DFF behind an IDE row, `_dam` twins excluded: **34 multi-atomic models, ALL of them
`anim` rows** (`CClumpModelInfo`, loaded by `LoadClumpFile`, drawn whole and animated: `burger01_LAw`,
`bs_building_sfs`, `vgnboigashot10/15/23/25`, `lawnboigashot25`, `boigas_sfe/sfw05`, `derrick01` (5 atomics),
`nt_noddonkbase` (5), `nt_windmill`, `oilplodbitbase`, `vgnprtlstation03` (3), `vrockpole`, `vegcandysign1`,
`cn2_ringking`, `sprasfw`, the `vgngassign*`/`xenonsign*`/`vgegassgn*` sign pairs, the `des_*`/`ufo_*` Area-69
props, `bigsprunkpole`, `xen2_countn`, `bd_fire1_o`, `munch_donut`, `wd_fence_anim`, `a51_radar_scan`) —
and **zero `objs` rows with more than one atomic**. R\* never fed an atomic model info a second atomic.

One stock oddity worth knowing: `oilplodbitbase` is BOTH an `anim` model (its arm nods) AND the LOD the
`nt_noddonkbase` instances point at — an animated LOD, at 800 m.

## What it means for us

- A LOD row is an `objs` atomic model. Whatever a tool writes into a LOD's `.dff` must be ONE atomic; a
  multi-atomic clump copied there draws one part of itself at the origin. That is the rule in
  [`restrictions/assets-and-data.md`](../restrictions/assets-and-data.md) ("an `objs` LOD is one atomic").
- The clone of an `anim` HD is a MERGE with the frame transforms baked (the rest pose the animation starts
  from) — `sa-lod-generator`'s `cloneLodDff` does that since 2026-08-17.
- Same reasoning for any tool that turns a clump into a map object (`hdToLod`, hole-fill, cells): one atomic
  out, or the game keeps one for you.
