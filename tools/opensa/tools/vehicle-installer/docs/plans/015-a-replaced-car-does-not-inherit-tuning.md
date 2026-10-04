# 015 — A replaced car does not inherit the stock car's tuning

**Status: DONE 2026-08-22 — step 1 built in the installer, step 2 taken in the DATA at the user's call.**

## The defect

`carmods.dat`'s `mods` line says which upgrade parts a car ACCEPTS. When a mod replaces a stock car and its
`*.settings.txt` carries no `carmods` line of its own, the installer leaves the stock line in place — so the
mod's model is offered the stock car's whole tuning kit, **a kit it was never adapted for**.

That is not a taste question. A universal (`*_b_*`) Transfender part hangs on a `ug_*` dummy inside the car
model — `ug_bonnet` for the hood scoops, `ug_spoiler`, `ug_roof`, `ug_wing_left/right`, `ug_lights`,
`ug_nitro` — and most mod authors do not carry those dummies over. Installing a part whose dummy is absent
crashes the real game at **`0x007F0BF7`**, *"frame did not find the child"*, reading `+0x98` off a null frame.

**Field, 2026-08-22**: the crash reproduced twice while flying a helicopter over the city, and stopped the
moment `ModelVariations` was removed — the plugin spawns traffic already tuned, so it is what mounts the
parts. The two crash dumps carry the upgrade id on the stack: `0x3F4` = **1012 `bnt_b_sc_p_l`** and `0x3ED` =
**1005 `bnt_b_sc_l`** — hood scoops, on `willard` and `greenwoo`.

## What the data says

Derived from stock (`scripts/debug/` census, 2026-08-22):

| | |
| --- | ---: |
| stock cars offering a part their model cannot mount | **0 of 77** |
| our built tree | **30 of 154** |
| of those 30, cars that INHERIT the stock line | **4** — `willard`, `greenwoo`, `stallion`, `admiral` |
| of those 30, cars that declare their own line and still name an unmountable part | 26 (all of them nitro) |
| `vehicles` cars declaring their own carmods line | 82 of 212 (130 inherit) |
| `add-vehicles` cars declaring one | 65 of 115 |
| inheriting cars that ship part `.dff`s of their own | **0** |

The three cars that crashed are three of the four inheritors. The mount table itself is read off stock data:
every one of the 17 stock cars offered `bnt_b_*` carries `ug_bonnet`, all 31 with `spl_b_*` carry
`ug_spoiler`, all 77 with `nto_b_*` carry `ug_nitro`, and so on — no exceptions in either direction.

## Step 1 — no declared line, no inherited line

**A `vehicles/` car whose settings declare no `carmods` line has the stock line for its slot REMOVED.** The
car simply is not tunable, which is the honest reading of a mod that says nothing about tuning: the stock line
describes a model that is no longer in the slot.

Not a widening of scope: measured above, **no inheriting car ships part `.dff`s**, so nothing that would have
been buyable stops being buyable. An added car has no stock line for its own id, so the rule is a no-op there.

Done when: `removeCarmods` exists and is idempotent, `applyVehicle` calls it in the else-branch of the
carmods merge, and the built tree's four inheritors lose their lines.

**BUILT.** `removeCarmods` in `merge.ts` (the private `removeFromSection` it reuses already existed for the
carcols move), called from `mergeSettings`, which now takes the slot. 254 tests in the tool green.

**The footprint, measured on the fleet before the next build**: exactly **7 lines are removed** —
`admiral`, `greenwoo`, `moonbeam`, `romero`, `savanna`, `stallion`, `willard`. The other 123 inheriting cars
have no stock line to lose. Four of the seven are the flagged ones (three of them the crashers); the other
three — `moonbeam`, `romero`, `savanna` — carry the mounts their stock line needs, so they lose tuning that
would have WORKED. That is the price of the coarse rule and it is the user's call: a car that says nothing
about tuning is treated as not tunable. Step 2's mount check is the finer instrument if he ever wants those
three back.

## Step 2 — a line may not name a part the model cannot mount

The 26 cars that DO declare a line still name parts their model has no dummy for (nitro, every one of them —
an author copying the stock line). `ModelVariations` no longer offers those (`add-vehicles` dropped the
`nto_` family from tuned traffic the same day), but Transfender still would, and the crash would be the same.

The rule: a line may only name a part the car's own model can mount. Mount table above; car-specific
families (`_lr_`, `_a_`, `_c_`) are out of scope because they replace a standard component every model
carries rather than hang on a `ug_` dummy.

**Taken in the DATA, not in code — the user's call.** The line those 26 cars declare is *entirely*
unmountable (measured: 27 of the 30 flagged lines become empty once the unmountable parts go, and the three
that keep something are step 1's inheritors), so the fix is to delete the line from the mod's own
`*.settings.txt` and let step 1 do the rest. **26 files edited, 0 partial cases** — every one of them a
nitro-only line, and none of those cars ships part `.dff`s, so nothing buyable was lost. The removed lines
and the original files are backed up under `NO_COMMIT/carmods-lines-removed-2026-08-22/`
(`mods-src/` is gitignored, so git cannot restore them).

**The gap this leaves, stated plainly**: nothing in the build enforces rule 2. A NEW mod whose settings name
a part its model cannot mount puts the crash back, silently. The code guard is written up in
[`docs/contracts/vehicles.md`](../../../../docs/contracts/vehicles.md) as the rule and here as the work not
done — one afternoon if the field ever asks for it.

## Ledger

| Step | Date | Result | Numbers |
| --- | --- | --- | --- |
| 1 | 2026-08-22 | built, 254 tool tests green | 7 stock lines removed on the current fleet (4 of them dangerous); 0 inheriting cars ship part `.dff`s |
| 2 | 2026-08-22 | done in the data (26 settings files), no code guard | 27 of 30 flagged lines are entirely unmountable; 0 partial; 0 of the 26 ship part `.dff`s |
