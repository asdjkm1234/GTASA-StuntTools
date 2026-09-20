# Raise `CStreaming::ms_files` in our own ASI

**Came out of:** the typed archive split — [`architecture/img-archive-layout.md`](../architecture/img-archive-layout.md),
`tools/img-splitter` [plan 001](../../tools/img-splitter/docs/plans/001-archive-split.md). Splitting
`models/gta3.img` by content type wants more archives than SA registers.

## Why it is deferred (2026-08-15, the user's field run)

The shipped layout fits the stock table **exactly**. `splitBuckets: ['vehicles']` puts the mod car set into
`vehicles.img` plus one spill sibling, so the built `gta.dat` carries 5 `IMG` lines against 3 hardcoded
archives — **8 of 8**. The game launched and played with no adjuster work at all.

**Read that verdict precisely, because it is the thing most likely to be misremembered**: it does not show
the ceiling is lifted on that install. It shows we never reached it. From the outside the two are
indistinguishable, and only one of them survives a ninth archive.

## THE TRIGGER — **FIRED 2026-08-19**

The second bullet below is the one that went off, and it went off the way it was written: *"the vehicle
payload growing past two files … a third file is one large mod set away"*. The added-cars fleet (central plan
102) is that mod set — 115 cars and 46 tuning parts, **+1.37 GB** — and the vehicles family became
`vehicles.img` + `vehicles2.img` + `vehicles3.img`. The `sa` build now fails at `assertArchiveSlots`:

```
9 registered IMG archives of 8 stock slots (3 hardcoded + 6 in gta.dat)
```

3 hardcoded (`gta3`, `gta_int`, `player`) + 6 registered (`carrec`, `script`, `cutscene`, `vehicles`,
`vehicles2`, `vehicles3`). Six of those nine are stock and not ours to remove, so the fleet fits in eight
only by shrinking the vehicle payload back under two archives (~3.5 GB against today's 4.17 GB) — or by
taking the lift this card is about. **The deferral is over; what happens next is a decision, not a
discovery.**

## The trigger, as it was written

**A ninth registered `models/*.img`.** Any one of these produces it:

- a bucket beyond vehicles getting its own archive — the classifier already produces `peds` and `weapons`,
  and they are held back only by `splitBuckets`;
- the vehicle payload growing past two files (it is 3.08 GB against a 1.75 GiB cap, so a third file is one
  large mod set away);
- the map bucket needing a spill sibling — `gta3.img` finished the last build at **1.64 GB**, 110 MB under
  the cap;
- any other stage wanting an archive of its own.

**Where the trigger is checked:** `assertArchiveSlots` in `tools/img-splitter/src/split.ts`, run by the split
and again on the finished `sa` tree. It fails the build with the arithmetic and names this card. That is
deliberate — past the eighth archive the game does not warn, it **crashes at load**, so the symptom on its own
tells you nothing about the cause.

## What is already in hand

Nothing needs re-deriving. The ceiling, its two halves, and the mechanism a working adjuster uses are written
up in [`gta-sa-original/img-archive-limit.md`](../gta-sa-original/img-archive-limit.md):

- **`TOTAL_IMG_ARCHIVES = 8`**, derived rather than remembered (gta-reversed `Streaming.h`: `ms_files` at
  `0x8E48D8`, next static at `0x8E4A58`, `0x180` over a `0x30` struct), corroborated independently by GTAMods.
- **The ceiling has TWO halves** — `ms_files` and the CdStream handle tables — so a plan budgeting only for
  the first has budgeted for half the work.
- **The mechanism**, read out of `SimpleLimitAdjuster_IMGfiles.asi`: relocate the table into your own
  allocation, then rewrite the 4-byte OPERAND inside each of the 14 instructions that referenced the old one,
  every write wrapped in `VirtualProtect`. All fifteen sites are tabulated, including the coexistence probe
  that reads `CdStreamRead`'s first byte for an existing `0xE9` hook.
- **What we would refuse to copy**: that adjuster patches blind. Our SDK declares address and expected bytes
  once in the catalogue and verifies before applying, which is what makes a wrong exe a loud no-op instead of
  a corrupted process.
- **Nothing else on the target owns this limit** — FLA's ini patches ID pools, not the archive count — so the
  one-owner rule in [`restrictions/sa-target.md`](../restrictions/sa-target.md) is satisfied before we claim it.

## What doing it would cost

An ASI payload on the `asi/sdk` catalogue pattern: ~15 verified patch sites, a relocated table sized to our
own number, and the CdStream half beside it. The comparable precedent is `asi/perfect-map`'s int16 patch —
same shape, same gate, and it took one plan chain.
