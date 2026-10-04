# opensa-pack — plans

The converter's own plan folder (2026-07-17, user decision — the tool had grown a lot of machinery whose
plans lived scattered in the 074 chain). Convention mirrors the other tools (`map-optimizer/docs/plans`).

| #   | Plan                                                  | Status                                                                |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| 000 | [Converter tool](000-converter-tool.md)               | SHIPPED (the founding plan, was 074·03) + living bake-defaults note   |
| 001 | [Missing-normals guard](001-missing-normals-guard.md) | SHIPPED 2026-07-15                                                    |
| 002 | [Fetch-game paks](002-fetch-game-paks.md)             | STUB — post-migration (user refines scope; gostown & co)              |
| 003 | [Game-shaped output](003-game-shaped-output.md)       | IN PROGRESS — phases 0–2 shipped 2026-07-18; phase 3 (IMG + VFS) next |

## Cross-cutting plans that STAY in the 074 chain (tool + engine halves)

- [074/02 native formats](../../../../docs/plans/074-opensa-engine/02-native-formats.md) — `.oscell`/`.ostex`/`.ospak`, written by this tool, read by the engine.
- [074/07 baked channels](../../../../docs/plans/074-opensa-engine/07-baked-channels.md) — the AO/sun-vis/emissive BAKERS live here (`ao.ts`, `sunvis.ts`, `bvh.ts`), the consumers in the engine WGSL.
- [074/12 stochastic texturing](../../../../docs/plans/074-opensa-engine/12-stochastic-texturing.md) — the curated list + planner flag here, the 3-tap sampler in the engine.
- [074/14 pmb integration](../../../../docs/plans/074-opensa-engine/14-pmb-integration.md) — this tool becomes a perfect-map-builder stage (the chain's exit exam).

## Current bake defaults (2026-07-17)

AO/skyVis: **ON by default** (`--no-ao` to skip — it replaces prod's SSAO). Sun-vis (heavy shadows):
**opt-in via `--bakes`**. Water shore-field: always on (seconds). See the CLI header (`src/cli.ts`).
