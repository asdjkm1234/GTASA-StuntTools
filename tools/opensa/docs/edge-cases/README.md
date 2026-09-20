# Edge cases & current limitations

The standing constraints of the project **as of today** — hard limits, format gotchas, and known boundaries
on the own-WebGPU-engine path. No legacy: anything that only applied to the removed three.js renderer or to
fixed bugs does not belong here (a fixed bug's surviving _constraint_ does).

**Maintenance rule** (also in `CLAUDE.md`): when a new limitation is discovered, add it to the matching
file; when one is lifted, remove it in the same change.

**Read this folder while DEBUGGING** — it answers "why does it behave like this?". The rules a NEW design has
to satisfy are next door in [`restrictions/`](../restrictions/README.md), which is read BEFORE an idea,
concept or plan is written. A fact may appear in both, but only once as detail: the measurement lives here,
the one-line rule and its blast radius live there.

| File                                             | Scope                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| [sa-formats.md](./sa-formats.md)                 | Strict RenderWare/SA asset-format requirements (DFF/TXD/COL/IMG) |
| [sa-runtime-limits.md](./sa-runtime-limits.md)   | Real-SA engine pool ceilings the `sa/` build target must respect |
| [converter-pipeline.md](./converter-pipeline.md) | opensa-pack / pmb / map-optimizer / LOD-generator boundaries     |
| [engine-rendering.md](./engine-rendering.md)     | Own WebGPU engine rendering limits and approximations            |
| [streaming-formats.md](./streaming-formats.md)   | Native-format versioning + streaming memory model invariants     |
| [browser-runtime.md](./browser-runtime.md)       | Browser/platform constraints (FSA, Cache Storage, e2e)           |
| [physics-runtime.md](./physics-runtime.md)       | Rapier vehicle-controller boundaries (cosmetic wheel rotation…) + where a vehicle body may exist at all (no parked car between 150 m and 250 m) |
| [camera-rig.md](./camera-rig.md)                 | Follow-camera (080 director) limits — the mid-corner muted chase  |
| [dispatch-console.md](./dispatch-console.md)     | The operator surface's own limits — sketches do not drape or occlude, a distance is the straight line, one radar scale, no radar in plan mode |
| [route-graph.md](./route-graph.md)               | Drivable-route limits (096) — a city grid yields no route at all  |
| [cleo-vm.md](./cleo-vm.md)                       | CLEO VM / vehicle-rig gotchas — native-call args are in C order, not script order; dummy frames are not addressable parts |
