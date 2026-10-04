# vehicle-optimizer

A standalone tool for **fitting vehicle models**. Two operations, usable together in one run:

1. **Uniform scale** — `--scale 1.1` grows the whole vehicle 10%: geometry (incl. `chassis_vlo` + `_ok`/`_dam`
   damage parts), the **dummy rig** (wheels / doors / seats / lights — scaled _with_ the geometry so nothing
   shifts and there's no gap when a door opens), and **collision**. It does **not** touch data files
   (`vehicles.ide` / `carcols` / `handling.cfg`).
2. **Shine copy** — `--prototype <reference>` retunes the three numbers a car's shine is made of, each on its
   own marking: the MatFX env-map `coefficient` and the reflection `intensity` on the materials the author
   marked reflective with an env-map (body, glass, chrome), and the **specular `level`** wherever it is
   non-zero — that last one is usually what a "too shiny" report actually means, and the install's SkyGfx
   vehicle pipe multiplies it by 3 (the intensity by 8, which saturates anything above 0.125). Values come from
   the reference by shared texture name where there is one, from its median otherwise. A value of **0** is left
   at 0 (the author said "matte"), and the run prints what it touched and with which numbers, so a no-op says
   so. **`--coefficient <n>` / `--reflection <n>` / `--specular <n>` set them outright** — with or without a
   donor, and they win over it. `scripts/debug/dff-reflection.ts <before> <after> --diff` shows exactly which
   materials moved.

Output is **standard RenderWare DFF/COL**, so it works in the **real game** — this module is independent of the
OpenSA engine (it never touches `../src` beyond reusing its read-only RW parsers).

## Usage

`--model` is a **path to a loose `.dff`, resolved against the cwd you run from** (same for `--prototype` and
`--out`). The finished DFF lands in an **`out/` folder beside the model**; `--out <dir>` overrides that.

```bash
# inspect a vehicle DFF (structure + which materials carry reflective effects) — nothing is written:
npx tsx tools/vehicle-optimizer/src/cli.ts --model ./fixtures/original/dff/vehicle/infernus.dff

# scale +10% and copy reflective effects from a reference → ./mods-src/original/1/out/infernus.dff:
npx tsx tools/vehicle-optimizer/src/cli.ts --model ./mods-src/original/1/infernus.dff --scale 1.1 \
  --prototype ./mods-src/original/1/elegy.dff

# same, written somewhere else:
npx tsx tools/vehicle-optimizer/src/cli.ts --model ./mods-src/original/1/infernus.dff --scale 1.1 --out ./tmp
```

```
vehicle-optimizer — infernus
  geometry  — 7 parts, 5421 verts, 8123 tris
  rig       — 28 frames (24 named dummies)
  materials — 19 total, 11 with reflective effects
    vehicleenvmap128 — env+refl
    ...
```

Today only `inspect` is implemented; `--scale` (plan 002) and `--prototype` (plan 003) are stubbed.

## Layout

```
vehicle-optimizer/
  src/
    cli.ts                 # --model <path> [--scale] [--prototype <path>]   (paths relative to cli.ts)
    core/                  # game-agnostic: VehicleAdapter contract (byte-based), report
    adapters/gta-sa/       # RenderWare adapter — reuses ../src parsers READ-ONLY; writers live here / reuse map-optimizer
  docs/plans/              # 001 architecture, 002 scale, 003 material-effect copy
  out/                     # processed DFFs (gitignored)
```

## Principles

- **Never modify `../src`** — read-only reuse of the RW DFF/COL parsers; all writers live here (or reuse the
  sibling `../map-optimizer` RW codec).
- **Real-game output** — standard RenderWare, no OpenSA-specific data; not coupled to the engine.
- **Game-agnostic core + per-game adapter** — a new game is a new adapter.
