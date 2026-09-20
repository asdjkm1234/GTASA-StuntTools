# The install's SkyGfx fork: what its VEHICLE pipe reads for reflection (2026-08-18)

**What this is:** the same JuniorDjjr fork the building-pipe note covers
([skygfx-fork-building-pipe.md](skygfx-fork-building-pipe.md)) also replaces SA's car pipeline —
`skygfx1.ini` in this install sets **`vehiclePipe=PS2`** (values: `PS2`, `PC`, `Xbox`, `Spec`, `Neo`, `LCS`,
`VCS`, `Mobile`, `Env`) with `dualPassVehicle=1` and `envMapSize=128`. This file records which numbers of a
vehicle DFF that pipe actually consumes, read out of the fork's source (`src/vehiclePipe.cpp`, `src/gta.h`),
because a `vehicle-optimizer --prototype` run can be byte-perfect and still look inert here.

## What the pipe reads, per material

```c
// vehiclePipe.cpp — the FX pass of every non-Leeds/Neo variant, incl. PS2
materialFlags = *(RwUInt32*)&material->surfaceProps.specular;   // SA packs FX flags into this float's bits
hasEnv1 = !!(materialFlags & 1); hasEnv2 = !!(materialFlags & 2);
hasSpec = !!(materialFlags & 4) && !renderingWheel;
if (RpMatFXMaterialGetEffects(material) != rpMATFXEFFECTENVMAP) { hasEnv1 = hasEnv2 = hasSpec = false; }
if (hasEnv1 || hasEnv2) fxParams.shininess = envData->GetShininess();   // + a per-pipe multiplier
```

`envData` is SA's own per-material plugin, and its precision is the point (`gta.h`):

```c
struct CustomEnvMapPipeMaterialData {
    int8 scaleX, scaleY, transScaleX, transScaleY, shininess;   // quantised to BYTES
    …
    float GetShininess(void) { return shininess / 255.0f; }
};
```

Those five fields are the DFF **reflection plugin** `0x253f2fc` (`scale.xy`, `offset.xy`, `intensity`) — not
the MatFX env-map's `coefficient`. So:

- **the reflection STRENGTH the pipe uses is the reflection plugin's `intensity`**, quantised to an int8;
- the MatFX env-map is only a GATE (`RpMatFXMaterialGetEffects(material) == rpMATFXEFFECTENVMAP`) plus the
  per-material FX-flag bits — its `coefficient` float is not what scales the reflection in this pipe;
- every variant multiplies the byte on the way out, and the factor is large: `× 8.0 * envShininessMult`
  (PS2/Spec/Env path and `neoCarpipe.cpp` alike), `× 3.0 * leedsShininessMult` for LCS/VCS.

## What that means for a DFF edit

`intensity × 8` is ≥ 1 for anything at or above **0.125**, so the stock 0.5 and a "tasteful" 0.16 both leave
the shader term saturated and look the same on screen. **The visible range is roughly 0.02 – 0.12**, and a
retune that stays above it is a correct file change with no visible result — measured on `yankee` +
`walton` (0.5 → 0.07) and `yankee` + `yosemite` (0.5 → 0.16), both invisible in this install while the file
diff is exactly the 66 floats it should be.

The multipliers are commented out in this install's ini (`envShininessMult`, `neoShininessMult`,
`leedsShininessMult` all at their 1.0 default), so nothing softens the ×8.

## The specular term is the other half, and it is the one a report usually means

The same FX pass reads `specData->specularity` (the DFF specular plugin `0x253f2f6`, `level` f32 at offset 0)
and applies `× 3.0 * envSpecularityMult`, gated by flag bit 4 and skipped on wheels. Measured on the reported
car: `yankee` carries specular **0.26–0.56** across 80 of its 91 specular materials, while the tasteful donors
sit at **0.05** (`walton` 124 of 180) and **0.08** (`yosemite`). At ×3 that is 1.7 against 0.15 — the highlight,
not the env reflection, is what reads as "too shiny", and zeroing the reflection intensity alone changed
nothing on screen (field arm, 2026-08-18). `vehicle-optimizer` transfers it since the same day.

**Not verified here** (needs the game, not the source): how SA converts the DFF float to that int8 at load
(a `×255` round is the obvious reading of `GetShininess`), and whether the shader saturates the term or keeps
scaling past 1. Either way the conclusion for a plan is the same — judge a reflection edit in the 0.02–0.12
band, or on a car whose `intensity` starts inside it.

## Cross-references

- `tools/vehicle-optimizer/docs/plans/003-material-effect-copy.md` — the transfer this explains, its ledger and
  the `--coefficient` / `--reflection` overrides.
- `scripts/debug/dff-reflection.ts` — reads both numbers out of any DFF and diffs a before/after pair.
- Fork + original: `docs/links.md` (`JuniorDjjr/skygfx`, `aap/skygfx`).
