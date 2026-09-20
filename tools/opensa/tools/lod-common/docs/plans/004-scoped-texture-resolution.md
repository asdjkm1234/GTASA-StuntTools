# 004 — Scoped texture resolution (per-model TXD, not global first-wins)

**Status: ✅ shipped 2026-07-05.** lod-common `getFrom`/`resolveFrom` + `scoped-texture.ts`; lod-procobj
`buildSpeciesLod` scoped renames; sa-lod content-aware `partitionCloneTextures` + atlas-scoped encodes; opensa
scoped cell-merge buckets + per-cell `textureMap` through the worker boundary + registry-resolved shared TXD.
Coverage: unit (texture-source, scoped-texture, partition variants, merge buckets), integration (procobj
two-species shared-TXD variants), real-asset regression (`sm_bush_large_1` + badlands/gta_proc_bush fixtures —
`npm run test:fixtures`). NOTE: previously generated LOD builds need a REGENERATION to pick up correct textures.

**The bug:** LOD generators resolve texture NAMES through a single flat index over every
TXD in the archive ("first TXD wins" — `createTextureSource`). But SA texture names are only unique **within
one TXD**, and Rockstar reuses the same name across TXDs with different pixels (area recolours). Result:
LODs randomly pick a wrong-variant texture.

## Evidence (2026-07-05, stock gta3.img)

- `newtreeleaves128` exists in **15+ TXDs** — even with different formats (`dxt3` in `gta_proc_bush`/`des_trees`,
  `rgba8888` in `badlands`/`gta_tree_bevhills`) — i.e. definitely different pixels per TXD.
- `sm_josh_leaf` exists in `gta_procdesert.txd` (dxt3, the joshua's own — dark desert needles) AND
  `gta_deserttrees.txd` (rgba8888 — a green variant).
- In-game repros (lod-procobj output): `sm_bush_large_1` (silver-gray HD, def txd `badlands`) got a **green
  dense** LOD; `sand_josh1` (def txd `gta_procdesert`) got **bright-green** puffs. Geometry (QEM) is fine —
  only textures are wrong.

Affected consumers of `createTextureSource`:

1. **sa-procobj-placement** — the reported repro. Double trouble: the shared `lod_procobj.txd` keys textures
   by bare name, so even with correct per-model resolution, two species carrying different pixels under one
   name would collide inside the shared dictionary.
2. **sa-lod-generator** — `finalize.ts` reads the clone-TXD's texture NAMES from the correct source atlas, but
   `encodeHalvedTxd(names, source, …)` resolves each name through the GLOBAL index → a clone of
   `gta_procdesert.txd` can embed another TXD's same-named pixels.
3. **opensa-lod-generator** — baked cell meshes merge groups from many models, and `finalize.ts` packs ONE
   shared TXD from bare names (its comment even asserts "cells already received identical pixels per name" —
   that assertion is this bug). Same collision + wrong-variant classes as procobj.

## Design

### lod-common (`texture-source.ts` + new `scoped-texture.ts`)

- Index becomes two-level: `txd → name → texture`, keeping the flat first-wins map for the legacy `get(name)`.
- `TextureSource` gains **optional** `getFrom(txdName, name)` — resolve inside the given TXD, `null` when that
  TXD doesn't carry the name. Optional keeps existing test fakes valid; `resolveFrom(source, txd, name)`
  helper = `getFrom?.() ?? get(name)` (scoped-first, global fallback for names genuinely absent from the
  model's TXD — SA tolerates that via its own TXD fallbacks, so do we).
- **Scoped names** for shared dictionaries: `scopedTextureName(txd, name)` — deterministic, RW-safe (≤ 31
  chars: `<txd>_<name>` verbatim when it fits, else 23-char prefix + fnv1a32 hex8 of the full pair). A
  `ScopedRegistry` (`scopedName → {txd, name}`) records what each scoped name means;
  `scopedSource(base, registry)` is a `TextureSource` view that resolves scoped names via `getFrom` and passes
  unknown names through — so the modifier chain (foliage/alpha checks, texture stats, transparent-group drop)
  and `encodeLodTxd` work on renamed meshes without signature changes. Registries are plain data
  (worker-transferable).

### sa-procobj-placement

- `scanIdes` also returns `txdByModel` (the def's `txdName`).
- Per species, after decimation: rename every mesh group's texture to `scopedTextureName(defTxd, raw)` and
  record it in one build-wide registry. Foliage detection, `--prelight`, and `encodeLodTxd` all read through
  `scopedSource` — the shared `lod_procobj.txd` then carries each species' OWN variant under a unique name,
  and the LOD DFF references it by that name (names/UVs still 1:1, no atlas).
- The `--in` HD-swap path is untouched (swapped HDs keep stock names + their own TXD via `txdp`).

### sa-lod-generator

- `finalize.ts` clone-TXD encode resolves through the source atlas: a per-call scoped view
  (`get: (n) => resolveFrom(source, hdTxd, n)`). Names inside a clone TXD stay unchanged (they're the
  atlas's own names — unique within it by construction).

### opensa-lod-generator

- The per-model mesh build (bake path) renames group textures to scoped names using the instance def's
  `txdName`, recording into a per-worker registry; the worker result message carries the registry entries
  (plain array) and the coordinator merges them (same deterministic function ⇒ no cross-worker conflicts).
- `finalize.ts` packs the shared TXD through `scopedSource(textureSource, mergedRegistry)`; the harness /
  preview paths use the same view. The "identical pixels per name" comment dies with the bug.

## Tests

- Unit (synthetic archives, `buildArchiveBuffer` + tiny encoded TXDs): two TXDs sharing a name with different
  pixels → `getFrom` returns each TXD's own; `get` keeps first-wins; `scopedTextureName` determinism, 31-char
  cap, long-name hashing, collision-freedom for distinct pairs; `scopedSource` resolves scoped + passes
  through raw names.
- Real fixtures (`npm run test:fixtures`, MANIFEST additions): `sm_bush_large_1.dff` + its def TXD
  `badlands.txd` + the first-wins winner `gta_proc_bush.txd` — assert the two TXDs' `newtreeleaves128`
  differ, and that scoped resolution picks `badlands`' pixels for the bush while flat `get` picks the wrong
  one (the regression pinned).
- procobj integration: two fake species with same-named different textures → the emitted `lod_procobj.txd`
  contains BOTH variants under scoped names and each LOD DFF references its own.
- sa-lod finalize: clone TXD embeds the hdTxd's variant, not the global one.
- opensa finalize: shared TXD written through a registry carries per-model variants.

## Non-goals

- Content-hash dedup of identical pixels shipped under different (txd, name) pairs — harmless duplicates, not
  worth the machinery now.
- `txdp` parent chains inside `getFrom` — generators run on pre-mod game trees where txdp is absent; the
  global fallback covers missing names. Revisit if a build with txdp parents ever feeds a generator.
