# 06·1·05 — Path editor (a viewer-family app over the ORIGINAL files)

[← chain](../readme.md) · prev: [04 sidecar](04-path-sidecar-and-contracts.md) · relates: `docs/ideas/editors/`

The city's nervous system, visible and editable. The editor reads and WRITES the original
`nodes*.dat`/`tracks*.dat` (decision D2 — its output benefits vanilla SA players and every path mod)
plus the sidecar for everything the originals cannot express. This extends the `docs/ideas/editors/`
framing (interactive editors over machinery we already own) — not a second editor architecture.

## Why editing originals is safe and right

- SA keeps paths as loose `data/Paths/*.DAT` files (not inside IMG archives) — read/write is plain file
  IO through the File System Access API, the same pattern the game shell already uses.
- The format is fully decoded after 1/02, including the parts we round-trip untouched.
- **Byte-faithful round-trip is the gate**: open → save with zero edits must be byte-identical (the
  mod-installer's byte-faithful conversion precedent). Only then are edits trustworthy.
- Output lands in a MOD folder (`mods-src/<game>/mods/N. City Paths/data/Paths/…`), never in
  `game-src/` — stock stays pristine; the pipeline installs it like any mod ("mods are installed,
  never overlaid").

## Features (build order)

1. **Viewer**: streamed map underneath (reuse the engine host embed the sa-map-viewer app proved),
   directed lanes drawn with direction arrows, colour by kind/lanes/speed/flags, ped graph and rail
   overlays, hover inspector. One instanced line/point pass — the corona/billboard instancing pattern.
   Debug-view rule: ONE owner of what is shown, headless mode included (the 094 lesson, twice paid).
2. **Selection & node/link editing**: move (ground-snap via map collision), add/delete nodes and links,
   lane counts, direction, flags, speed class. Undo/redo from day one (command list).
3. **Intersection authoring**: group nodes, author phase tables, bind rail crossings — writes SIDECAR.
4. **Density painting**: per-zone overrides over the 1/03 import — writes SIDECAR.
5. **Validation**: connectivity, orphan nodes, unreachable lanes, one-way dead ends, phase-table sanity
   (shares the sidecar validator), fixed-point range checks (positions ÷8 int16 — an edit out of range
   must fail at edit time, not at save).
6. **Toy flow preview**: ring-2 dots animating over the graph in-editor — light edits become visually
   verifiable before the game ever runs (uses the same flow tick as 2/01; first consumer of the spec).
7. **Export**: `NODES*.DAT`/`tracks*.dat` (spec-conformant) + sidecar + a diff report (what changed vs
   the loaded baseline — the reviewable artifact for a mod release).

## Goals gate

1. *Authored data:* the editor is HOW authored path data gets made; it must never write a file the
   original game rejects.
2. *Original:* R* edited paths in max scripts nobody has; community editors are old and lossy — recover
   the format, not their tools.
3. *Better:* live validation + flow preview + byte-faithful round-trip; demonstrated by the round-trip
   suite and a real edit shipped as a mod and driven in both hosts.
4. *Cost:* an offline app — no game-frame budget; editor's own perf noted only if it blocks use.
5. *Contract:* the mod-folder path shape it writes goes in `docs/contracts/mods.md`/`paths.md` (1/04).

## Verification

- Round-trip suite: byte-identical zero-edit save for all 64 stock area files + all track files.
- Cross-check: an edited area file loads in vanilla SA under Wine (drive the edited road with stock
  traffic BEFORE our suppression — the strongest spec-conformance proof available).
- End-to-end: edit a road (add a lane, flip a direction) → export mod → pmb build → engine drive over
  it + SA drive over it. One change, two hosts, same behaviour.

## Tasks

- [ ] App skeleton (viewer-family shell, map embed, camera/pick reuse) + graph render pass.
- [ ] Byte-faithful writer + round-trip suite (the gate for everything after).
- [ ] Editing + undo/redo + ground snap + range validation.
- [ ] Intersection/phase UI + density brush (sidecar authoring).
- [ ] Toy flow preview.
- [ ] Export + diff report + mod-folder layout.
- [ ] Docs same change: `docs/architecture/tools.md` entry, `docs/commands.md`, contracts rows; retire
      the relevant `docs/ideas/editors/` line into this plan (the lifecycle move).

## Measured numbers

- Round-trip: files byte-identical / total: —
- Vanilla-SA acceptance of an edited file: —
