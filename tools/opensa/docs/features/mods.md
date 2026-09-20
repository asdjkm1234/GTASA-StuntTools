# Game mods: WorldMod + vegetation wind

**Asset/data mods are a BUILD-time concern.** `mod-installer` and `vehicle-installer` merge a mod into the game
dir before it is packed; the runtime `modloader/` overlay that once did this at boot was removed — see
[postmortem/runtime-modloader-overlay.md](../postmortem/runtime-modloader-overlay.md) for why, and
[contracts/mods.md](../contracts/mods.md) / [contracts/vehicles.md](../contracts/vehicles.md) for the folder and
file conventions an installed mod must follow.

What remains here is the **code-level** mechanism:

- **WorldMod** (`packages/game/src/mods/`, plans 039/040) — engine features layered over the vanilla pipeline.
  **Currently unwired:** its reference impl (the wind mod) and the `decoratePart` build hook both died with the
  three renderer in 074/13, and sway now rides a converter channel + a vertex shader term instead. The interface
  survives as the declared extension point.

## Game mods (WorldMod) + vegetation wind

`packages/game/src/mods/` (`mod.interface.ts`, `wind-mode.ts` — `wind.mod.ts` was the three material
decorator, deleted in 074/13), plans 039/040.

## Implemented

- **WorldMod contract**: `{ name, decoratePart?(def, part), update?({hours, seconds}) }` —
  self-contained features layered over the vanilla pipeline the way community mods layer over
  SA. `game.installMod(mod)` wires the per-frame update; the adapter's composed `decoratePart`
  runs during cell builds (after the vanilla IDE-flag treatment). `game/mods/**` and
  `game/adapters/**` are the only game layers allowed to import renderware (ESLint-enforced).
- **Wind mod** (`createWindMod`):
  - Trigger = the explicit `WIND_MODELS` list (312 names, generated from the ground-truth
    `static/wind/` folder) or IDE IS_TREE/IS_PALM flags. Prelit ALPHA is NEVER a trigger (it
    false-positived 128 non-vegetation models — roads, LTS overlays, piers); it only provides
    per-vertex sway WEIGHTS (255 = rigid trunk, lower = swaying canopy).
  - Two sway profiles (palm vs tree: height-based and weight-based modes), shared
    `uWindTime` uniform, shader-injection composing with the world material
    (`|sway-{kind}-{mode}` program variants).
  - Applies to instanced map parts AND procobj clutter (same decoratePart hook).

## Known gaps / candidates

- Wind backlog: 3 cacti models missing adapted weights; `vgsEflgs1_lvs` casino flags +
  `vegasflag*` candidates not adapted (authoring task — `adapt-wind` tooling planned).
- Future mods on this pattern: PS2 trails, traffic-light cycling.

## Test coverage anchors

`wind-mode.test.ts` (trigger negatives incl. alpha-only, weight/height modes),
`gen-wind-list`/`wind-coverage` scripts. The three-side `wind.mod.test.ts` and
`build-region.test.ts` decoratePart ordering died with that renderer (074/13); sway is a converter
channel + a vertex-shader term in the engine now, not a material decoration.
