# 04 — Graphic improvements (shadows + street-lamp lighting)

**STATUS: DRAFT bundle** — both members are parked ideas the user wants to think through properly later
("we'll think it through properly later"); nothing here is scheduled or committed to a design.

The common thread: both features were BUILT in some form during the 074 chain, field-tested, and removed
by user decision — the current shipping engine is the deliberately simple, stable, fast version. This
bundle exists so the next attempt starts from the full record of what failed and why, not from zero.

| #   | Idea                                                             | Came from                                                                                                         |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 01  | [Baked directional sun shadows](01-baked-directional-shadows.md) | 074/07 v2, built + field-reverted 2026-07-12 (receiver-densification prerequisite inside); moved from 0.5.0/03    |
| 02  | [Light ALL lamps of loaded HD cells](02-hd-cell-lamps.md)        | The 2026-07-17 lamp-pool removal + the user's field observation that the budget likely allows lighting everything |
| 03  | [Contact darkening for dynamics](03-dynamic-contact-shadows.md)  | The "SSAO for cars/peds" question reformulated (2026-07-17); the rolled-back plan-16 blob is one candidate inside |
| 04  | [Real light from 2dfx coronas](04-2dfx-real-lights.md)           | 085 row E (Ten Green Bottles blink glow) closed-for-now 2026-07-23 — blink-synced surface light, wet-road specular, clustered scale |

The [hd-realtime-lod-baked concept](../../../../plans/074-opensa-engine/concept/hd-realtime-lod-baked.md)
(HD segment real-time light+shadows, bakes only for LODs) cuts across all three members — a decision
there may answer the bundle at once.
