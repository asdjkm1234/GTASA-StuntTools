# Budgeted texture-array uploads (the 15–85 ms hitch nobody could see)

**Status:** APPLIED 2026-07-27 (located and measured earlier the same day). The lever below was pulled
exactly as written: `beginOstexUpload` decodes + creates the texture in the worker's `message` handler
(cheap), the (layer, mip) writes drain from `StreamingDriver.update` under `UPLOAD_BUDGET_MS = 1.5` (at
least one write per frame, so a single over-budget write still progresses), and `TextureArrays.has(ref)`
turns true only with the LAST write — cells wait exactly as they do for an array that has not arrived. The
drain is reported as `StreamStats.uploadMs` and printed in the `[slow]` line
(`stream … (blob … worst … upload …)`); `lateCreates` stays the pop-in price gauge. The eager boot path
(pre-`textures` paks) and per-model dictionaries still upload in one go by design. Raised by a field report
of 20–250 ms frames whose named parts summed to 5.

**Field-confirmed same day**: the user drove the build and noticed no lags, then re-ran the in-game
`?bench=all` sweep — performance-neutral on every scene vs the 07-24 baseline (the expected shape: the fix
buys smoothness, not throughput), streaming slow frames all read `blob ≤0.6 worst ≤0.4 upload ≤2.4`, and
`lateCreates` stayed 0 on all eight scenes — the pop-in price this doc said to watch did not materialize.
Records: `docs/benchmarks/opensa-engine/2026-07-27-headless-texture-upload-hitch-fix.md` (headless A/B) and
`2026-07-27-ingame-after-texture-upload-fix.json` (the user's sweep). Note the 2.4: the budget check runs
AFTER a write, so a single frame can overshoot by at most one write — bounded and intended.

## What we did before (the hitch)

A cell's texture array was decoded and uploaded **the instant its blob arrived**, inside the pak worker's
`message` handler (`stream/streaming.ts` → `onBlob` → `world/textures.ts` `load` →
`core/ostex-upload.ts`). That upload was a nested loop of `device.queue.writeTexture` — one call per (layer,
mip) — over the whole array.

Two things make it a hitch:

1. **It runs between frames.** A `message` handler is not inside the rAF callback, so no timer the host frame
   keeps could see it. That is why the field log showed 90–98 % of every slow frame as unattributed.
2. **It is unbudgeted.** Cell CREATES have had a budget since 074/21 (`CREATE_BUDGET_MS = 1.5`, ≤2 per
   frame); the arrays those cells need bypass it entirely.

## Measured (2026-07-27, headless, canonical pak, `u-turn` lap)

The `[slow]` line now prints `stream (blob <total> worst <single>)` and an `other` residual. Slow frames
during streaming:

| frame    | blob total | worst single call | everything else |
| -------- | ---------: | ----------------: | --------------: |
| 86.8 ms  |    84.7 ms |       **84.7 ms** |         ~2 ms   |
| 70.0 ms  |    65.8 ms |           35.6 ms |         ~4 ms   |
| 61.7 ms  |    59.5 ms |           49.6 ms |         ~3 ms   |
| 20.5 ms  |    15.2 ms |           15.2 ms |         ~5 ms   |

`worst ≈ total` on the largest ones: it is **one array**, not a pile-up. So the fix cannot be "fewer per
frame" — a single upload has to be splittable.

## The lever

Make the upload resumable and run it INSIDE the frame:

- decode + `createTexture` on arrival (cheap), then keep a cursor over the (layer, mip) writes;
- drain the cursor from `StreamingDriver.update` under a budget, the same shape as `CREATE_BUDGET_MS`;
- `TextureArrays.has(ref)` stays FALSE until the last write lands — cells already wait for that exact
  condition (`advanceSlot` gates creates on `textures.has`), so nothing else needs to change.

## What it would win

The worst measured single stall on this path: **85 ms → ~1.5 ms per frame**, spread over ~50 frames instead
of one. It buys smoothness, not throughput — the same bytes still move.

## What it would cost

- A cell waits longer for its textures (up to ~0.5 s for the biggest array), so pop-in gets one more source.
  The `lateCreates` counter already measures exactly that and must be watched across the change.
- The texture path grows a state machine where it had a function. `engine.world-arrays.test.ts` and
  `engine.missing-textures.test.ts` pin the current behaviour and would need extending, not rewriting.
- The fake-GPUDevice tests (plan 077) assert DECISIONS, so a chunked upload is testable without a GPU.

## What would have to be true to pull it

A field verdict that the hitch matters — it fires while streaming NEW ground, so it is loudest on a fast
drive into unloaded map and invisible standing still. It is the single largest unexplained frame cost in the
record as of 2026-07-27.

## The wider finding, worth more than this one lever

**Work that arrives from a worker lands outside every budget.** The texture path is the one measured here,
and it is not the only door: `adapters/vehicle-model-builder.ts` resolves a PROMISE from its `onmessage`, so
the GPU-side model build runs in the continuation — a microtask, also outside the frame loop. The same field
log carries unattributed 20–90 ms frames at SPAWN time with `blob 0`, which is consistent with that and is
NOT yet measured (it needs its own timer, the way this one did). The rule the two share: a worker handoff
should give its result to the frame loop and let the loop pay for it, not pay in the handler.
