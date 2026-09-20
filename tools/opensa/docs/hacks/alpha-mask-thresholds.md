# The alpha-mask thresholds (5 % / 5 % / 10 %)

**Where:** `tools/opensa-pack/src/alpha.ts` — `isAlphaMask`, plan 092.
**Stands in for:** SA's ONE alpha pass with a per-entity, per-frame alpha-test reference. We have two
passes and must choose one per TEXTURE, offline, forever.

## What the game actually does (recovered 2026-07-29)

From the reversed source (`docs/links.md` → gta-reversed), which is the reason this file can be honest about
what it approximates:

- `CRenderer::RenderEverythingBarRoads` (`Renderer.cpp`) opens the world pass with the alpha-test reference
  at **140** (`if (!CGame::currArea)`).
- `CVisibilityPlugins::RenderEntity` (`VisibilityPlugins.cpp:555-578`) then sets it PER ENTITY:
  - the model has `bDontWriteZBuffer` (the `0x40` IDE flag) → **z-write OFF and reference 0**,
  - the entity is distance-FADING → **reference 0**,
  - inside an interior area → **reference 0**,
  - otherwise → **reference 100**.

So vanilla has no cutout/blend classes at all. It runs one pass with blending always enabled and an alpha
test whose reference moves between 0 and 140 depending on what is being drawn and how far away it is.

## What we do instead, and why

The own engine has a hard split — `world-cutout-*` (alpha-to-coverage at reference 128, depth WRITE,
`depthCompare: greater`) and `world-blend-*` (no depth write, `greater-equal`). The split is not an
approximation of laziness: A2C is what resolves a cutout edge without the black fringe that killed the
old path (`open-issues/fixed/alpha-edge.md`), and it needs the texture classified before it is packed.

`isAlphaMask` therefore decides, per texture, which side of SA's reference the texture *lives* on:

```
mask ⇔ below ≥ 5 %  ∧  above ≥ 5 %  ∧  near ≤ 10 %
       (below = α < 80, above = α > 176, near = the 128 ± 48 band)
```

**Two of the three constants are honest, one is fitted:**

- The **reference (128)** sits inside SA's own 100–140 band — derived, not invented.
- The **10 % edge bound** is the KNEE of a measured distribution: over the map's 2 201 two-sided soft-blend
  textures the `near` share falls 564 → 553 → 340 → 145 across the first four 2.5 % bins and then flattens
  into a 50–100 tail. Measured, with the run recorded in the plan.
- The **5 % side floors are FITTED.** They were swept (0.02 / 0.05 over opaque floors 0.15–0.40) and judged
  by eye on dumped alpha channels — a51_glass and railshadowdif must stay, wattsstax and Upt_Fence_Mesh must
  move. Nothing in the game says 5 %. Residual at the chosen value: **1 602 of 2 541** soft-blend textures
  flip, one known false negative (`Desrtmetal`, a diamond mesh at near = 13 %, just past the knee), and no
  false positive survived the eye review of both risky buckets.

## What is NOT modelled

- **The fading case.** SA drops the reference to 0 while an entity distance-fades, so a cutout softens as it
  fades out. Our class is fixed at bake time and cannot follow a per-frame state.
- **Reference 140 vs 100.** We use one reference for every masked texture; SA uses a different one for roads
  and for the general pass.
- The `0x40` case IS modelled — and this recovery CONFIRMS the gate rather than justifying it after the
  fact: SA answers a no-z-write model with reference 0, i.e. no alpha test at all, which is exactly the
  blend class `classOf` keeps those defs in.

## What would retire it

Carrying SA's model instead of ours: one pass, blending always on, with the alpha reference as a
per-DRAW uniform (140 / 100 / 0) rather than a baked per-texture class. That means giving up A2C for the
cutout edge — so it needs the fringe problem solved another way (premultiplied mips already do most of the
work; the open question is the edge without coverage preservation). Until then these three numbers stand.

## What else moves if they change

Every one of the 1 602 flipped textures changes PASS, which changes depth behaviour map-wide — and the
texture bytes too, since the cutout class turns on per-mip coverage preservation. A change here costs a
full re-pack and a field round on all three of plan 092's controls (the towers, hi-poly canopies, glass).
