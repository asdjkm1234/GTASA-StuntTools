# 082 — execution priority

**STATUS 2026-07-28: CLOSED.** The chain ran in the planned order, each plan's ledger carries its numbers,
and the rebuilt pak was driven: plates are on the cars. The 03 bench guard and the measured half of 04's
field session (distribution, slot count, spawn overhead, a ram test) were NOT taken — the feature was
closed on the look verdict; the readme's "Left unmeasured" section keeps the list.

Linear chain — each plan consumes the previous one's artifact:

| Order | Plan                       | Why                                                                                                                                                                                                          |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | **01 Plate raster**        | Pure, zero dependencies, testable today; also settles the slot SIZE plan 03 needs and the charset constants.                                                                                                 |
| 2     | **02 Converter tagging**   | The reconvert-carrying plan — land early so its `.osm` change batches with other pending reconverts; its census scopes 03/04. Also settles the `generic/vehicle.txd` fate before runtime code depends on it. |
| 3     | **03 Engine atlas + slot** | Needs 01's raster size + 02's flagged submeshes (fixture). The only engine-surface plan.                                                                                                                     |
| 4     | **04 Config + wiring**     | Needs everything; delivers the user-facing feature and the damage proof.                                                                                                                                     |

Checkpoints: suite + fake-device assertions per plan; ONE field session at 04 (plates are
binary-visible — intermediate field rounds add nothing). Bench guard at 03 (draws/GPU unchanged on
the vehicle scene).

Interplay: independent of 080/081; if 081 (vehicle physics) is running, schedule 04's damage
verification AFTER any 081 change to the damage thresholds to avoid re-testing.
