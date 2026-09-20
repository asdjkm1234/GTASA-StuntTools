# img-splitter — plan chain

| #   | Plan                                                                                                                                                                                                                                                                              | State                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 001 | [Split `models/*.img` into typed, size-bounded archives](001-archive-split.md) — census + the two unknowns, the IDE-derived classifier, the splitter, the cap and spill in the shared writer, the pmb stage, the field run | written, not started |
| 002 | [One owner per archive entry](002-one-owner-per-archive-entry.md) — the vehicle bucket takes everything `vehicles.ide` and `veh_mods.ide` name plus every `<car><n>.txd`; a build holding one name in two of the archives the split owns is refused; a car's files stop straddling siblings. Spans `vehicle-installer` (the staging and the paintjob prune) and the pmb census (the guard) | **BUILT** 2026-08-20, field-confirmed |

The design these implement is [`docs/architecture/img-archive-layout.md`](../../../../docs/architecture/img-archive-layout.md).
