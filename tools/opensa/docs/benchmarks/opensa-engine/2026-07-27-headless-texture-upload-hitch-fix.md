# 2026-07-27 — texture-upload hitch: before/after the budgeted drain

**Conditions.** Headless harness (`tools-debug/bench-harness/drive.js`), `u-turn` lap (the lap that streams
hardest — velocity prefetch drags the request ring through unloaded map), infernus, `?loader=http-dir`
against the canonical pak `build/original/opensa` (manifest `buildTime 08:41 24-07-2026`, game `original`,
app 0.3.0). Run by Claude on the M1 dev machine. BEFORE numbers are the same-day location run recorded in
[`../../performance/applied/texture-upload-budget.md`](../../performance/applied/texture-upload-budget.md)
(same lap, same pak); AFTER is head `0668c3f` + the budgeted-drain change (uncommitted at run time).

**The change under test.** A cell's texture array used to decode + upload whole in the pak worker's
`message` handler — between frames, outside every budget. Now the handler only decodes and creates the
texture; the (layer, mip) writes drain from `StreamingDriver.update` under `UPLOAD_BUDGET_MS = 1.5`, and
`TextureArrays.has` turns true only with the last write. The `[slow]` line grew an `upload` field inside
the stream parens for exactly this readback.

## Slow frames during the lap ([slow] lines, SLOW_FRAME_MS threshold)

| run | slow frames total | of them streaming-driven | worst blob single | drain per frame |
| --- | --- | --- | --- | --- |
| BEFORE (location run, same lap) | many across the drive | 86.8 / 70.0 / 61.7 / 20.5 ms frames, `blob` 84.7 / 65.8 / 59.5 / 15.2 ms | **84.7 ms** | — (unbudgeted) |
| AFTER (this run) | **3, all at boot/spawn** | **0** | **0.1 ms** | `upload` ≤ 1.5 ms |

The three remaining slow frames and their whole shape (verbatim):

```
[slow] frame 156.0 · … · stream 0.2 (blob 0.0 worst 0.0 upload 0.0) · fixed 20.8 · other 133.9 · cells 0
[slow] frame 25.1  · … · stream 0.2 (blob 0.0 worst 0.0 upload 0.0) · post 5.37 · other 19.7 · cells 0
[slow] frame 23.5  · … · stream 2.0 (blob 0.4 worst 0.1 upload 1.5) · other 19.3 · cells 12
```

- All three are boot/spawn frames (`cells 0/12`, `other` 19–134 ms) — the **second door** the applied doc
  names: the vehicle-model build resolving from a worker `onmessage` continuation, still unmeasured, NOT
  this lever's path.
- The one frame with any stream cost shows the fix's signature exactly: `blob 0.4` (the handler's residue —
  decode + `createTexture`), `worst 0.1` (no single call is big any more), `upload 1.5` (the drain sitting
  ON its budget).
- **Zero slow frames during the drive itself** — the 15–85 ms streaming stalls are gone from the lap that
  produced them.

`lateCreates` (the pop-in price the change was allowed to pay): no non-zero report in the run. The `[phys]`
u-turn capture landed normally (the lap completed; physics numbers are the 081 record's concern, not
this run's).
