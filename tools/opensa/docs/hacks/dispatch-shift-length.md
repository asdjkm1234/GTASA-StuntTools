# The dispatch shift is eight hours

**Where:** `apps/dispatch/src/ops/tracks.ts` — `SHIFT_HOURS = 8`, which sizes every unit's track ring
(`SAMPLES_PER_TRACK = SHIFT_HOURS × 3600 × 1000 / RECORD_INTERVAL_MS`), shipped 2026-08-22 with 201/8-01.
The divisor is OUR record interval and not the feed's publish rate — they were one constant until
2026-08-26, so a feed sped up to 1 s would have quadrupled this card's memory without anyone touching it.
**Stands in for:** a retention window somebody actually decided, or one derived from how a real shift on the
server runs. Neither exists.

## Why there is nothing to recover

The two numbers either side of it are both real and both cited:

- **`PUBLISH_INTERVAL_MS = 4000`** is PCAD's own publish rate, read out of `cadui.lua`'s `sendPositionUpdate`
  thread ([plan 202 §4](../plans/202-pcad-dispatch/readme.md)). It is a measurement of the feed, not a
  choice of ours.
- **`UNITS_ON_SCREEN = 150`** is the count the user named on 2026-08-06, before any of this was built
  ([201's budget table](../plans/201-dispatch-console/readme.md)).

Between them sits the one thing nobody has said: **how far back the operator should be able to scrub.**
[201/8](../plans/201-dispatch-console/8-the-time-axis/readme.md) says "the current shift (hours)" and stops
there, which is a unit and not a number. Eight is what a shift is in every dispatch product this plan
surveyed and in most of the world outside it; it is not read from this server, this community, or any
measurement of how long a dispatcher actually stays on.

## What it was judged on

Arithmetic, and it is the reason the number is comfortable rather than the reason it is right.
[The measurement](../benchmarks/opensa-engine/2026-08-22-dispatch-track-memory.json): **17.51 MB of host
memory for 150 units at 8 h**, checked against an actual `arrayBuffers` delta rather than accounted. That is
small enough that the choice never had to be argued — which is exactly the condition under which a number
gets picked by eye and then quoted for two years.

It also turned out to be conservative in wall-clock terms: because a stationary run collapses to its two
ends, the same ring holds **24 h at a plausible 25 % duty cycle**. So "8 hours" is a floor on the history a
real shift gets, not a ceiling.

## What would retire it

Any of these, and the first is the cheap one:

- **The user names a window.** One sentence retires this file.
- **A real shift is run** ([202 phase 4](../plans/202-pcad-dispatch/readme.md)) and the length of a session
  is a measurement rather than a guess — including whether operators hand over mid-shift, which would make
  the useful window shorter than the roster's.
- **The window becomes the operator's**, set in the console and remembered, at which point the constant is a
  default rather than a rule.
- **The feed's rate changes.** 202 phase 4 already proposes raising PCAD's 4 s publish rate; at 1 s the same
  8 h costs 70 MB, and the window and the rate stop being independent choices.

## Blast radius

Linear in memory and linear in history, and nothing else reads it:

| `SHIFT_HOURS` | samples/track | 150 units cost |
| --- | --- | --- |
| 4 | 3600 | 8.8 MB |
| **8** | **7200** | **17.5 MB** |
| 12 | 10800 | 26.3 MB |
| 24 | 21600 | 52.5 MB |

The cost is **host** memory and may not be charged against the chain's 300–500 MB residency ceiling, which
counts GPU bytes (`Engine.ledger()`). The report keeps them apart for that reason, and a capture that adds
them together is charging a track against a texture budget.

What changing it does NOT touch: the sampling policy, the interpolation, or anything a scrub does. The ring
is pre-allocated at capacity, so the cost is paid whether or not the shift is long enough to fill it.
