# fastman92's ID limits are part of the SAVEFILE format

**Measured 2026-08-19 from the reference install's own `fastman92limitAdjuster.log` (FLA 6.5), plus SA's
save reader in the reversed source.** A fact about the original game and the adjuster we ship with, not
about OpenSA.

## What the adjuster says about itself

Every boot of the reference install prints this, unprompted:

```
Format of new savefiles will be different: patch for block of IPL flags is applied! Number of IPL flags will depend on current IPL ID limit.
Format of new savefiles will be different: patch for enhanced format of model flags block is applied!
Format of new savefiles will be different: patch for save game of variable length is applied!
...
Format of new savefiles will be different: patch for car generators with CCarGenerator_extended structure is applied!
```

The first line is the one with teeth: **the size of the save's IPL-flags block is a function of
`FILE_TYPE_IPL`.** Our install moved that from 256 to 1024 on 2026-08-18 (the pool raise recorded in
[reference-install-config.md](reference-install-config.md)), which makes the block four times longer.

So the adjuster ini is not only a runtime setting — it is a **savefile schema**. A save written under one
set of ID limits is not the same file the game expects to read under another, and neither the game nor the
adjuster refuses it on that ground.

## How the mismatch presents

SA's loader is block-tagged: `CGenericGameStorage::GenericLoad` (`0x5D17B0`) reads a fixed tag string
before **every** block and bails out through `ReportError` when it does not match. So the ordinary outcome
of a length drift is a **refused load, not a crash** — the reader over- or under-runs one block, the next
tag fails, and the game returns to the menu.

That matters for diagnosis in both directions:

- a save that silently refuses to load after an ini change is this, and is expected;
- a save that loads far enough to CRASH is **not** explained by block drift alone — the tags would have
  caught it first. Look for something the restored data then does at full size.

## What this obliges

- **Changing any `FILE_TYPE_*` in `fastman92limitAdjuster_GTASA.ini` invalidates existing saves.** Field
  reports taken across such a change are not comparable.
- **It was NOT the cause of the 2026-08-19 load-game crash**, which is worth saying because it was the
  first suspect: the same save loaded once and crashed the second time, which no format mismatch explains
  ([open issue](../open-issues/fixed/sa-load-game-crash-dummy-pool.md)). The fact above stands on its own.
- A field session that must keep its saves has to keep the ini fixed, or re-make the saves after the change.
- The build ships that ini (the tree root), so a delivery changes the schema on the player's machine — the
  same delivery path that reverted the pools in session 26
  ([fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md](../open-issues/fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md)).

Neighbour: [reference-install.md](reference-install.md) for which plugin owns which limit.
