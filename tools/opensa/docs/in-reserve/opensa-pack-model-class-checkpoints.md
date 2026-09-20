# Per-model-class checkpoints inside the pack stage

**Out of:** perfect-map-builder plan 006 (`tools/perfect-map-builder/docs/plans/006-resume.md`, `--resume`),
2026-08-17. The plan's text designs them; phases 1–3 shipped without them.

**Why deferred:** the pack stage is a ~25-min weld (checkpointed per chunk — `tools/opensa-pack/src/checkpoint.ts`)
followed by six model classes (~9 min on the full `original` tree) and the archive rewrite (idempotent per
family). A resumed pack re-enters at its last finished weld chunk and re-runs every model class. Measured
2026-08-17 on the first real killed build (gostown, killed at weld chunk 6/21, resumed): the resumed pack was
byte-identical to an unbroken one (`world.ospak`, `water.bin`, all four archives — only the manifest's
`buildTime` differs) and the model classes were 6 s of a 100-s pack — the checkpoint would have saved nothing
there, and on `original` it saves ~9 min of a ~55-min run: a resume already spends its worst case (stage 1
onward, ~50 min) never. The design is known: each class writes its bundles into
`.work-<target>/pack/models/<class>.done` with the `.osm` bytes it produced (they are inserted into the
archives only at the very end), a resume after "vehicles converted, peds failed" re-runs peds only.

**TRIGGER:** a pack that dies INSIDE the model classes (after the weld) more than once on the same tree, or
a model-class wall-clock that grows past the weld's — the day the ~9 min becomes the part a resume waits for.

**Where the trigger is checked in code:** `tools/opensa-pack/src/convert.ts` `openCheckpoints` — the
`resume: N/M chunks taken from checkpoints` log line says the model classes are NOT checkpointed and re-run,
and names this card. A reader watching a resumed pack sit in the classes reads it before asking why.
