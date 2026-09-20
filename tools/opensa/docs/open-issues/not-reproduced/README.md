# Not reproduced

Issues that were investigated, written up — and then never seen again on the engine we actually ship.

They are not [`fixed/`](../fixed/): nothing here was repaired, and no one can point at the change that ended
it. They are not open either, because keeping them in the live table makes every reader re-triage a symptom
that has not occurred in months of running the exact recipe that used to produce it.

**What a file here carries**: the original diagnosis in full, the evidence of non-recurrence (how many runs,
of what, over what period), and what would REOPEN it — a trace, a message, a symptom to watch for. A file
moves out of here the moment one of those appears.

**The usual reason a file lands here** is that the stack it lived in is gone. A crash in a three.js-era
handle pool cannot recur in an engine that no longer has one; what it cannot do is be proven dead, so it is
recorded as not reproduced rather than fixed.

| Issue | Doc | Why it is here |
| --- | --- | --- |
| Crash on entering a freshly-spawned car (`readBody` null body) | [vehicle-enter-null-body.md](vehicle-enter-null-body.md) | Two sightings, both three.js-era. **At least 180 staged teleport → spawn → enter cycles on the own engine with no sighting** (plan 096's video mode is that exact recipe), including one unattended 32.7-minute run of 40 scenes with 0 throws. Moved 2026-08-22 at the user's call, ahead of the recheck date it had been given. Reopens on any `readBody`/`linvel` null trace at vehicle entry |
