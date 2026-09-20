# Two car mods ship a tuning part under the SAME stock name, and the last one installed wins

**FIXED 2026-08-20** by [`vehicle-installer/014`](../../../tools/vehicle-installer/docs/plans/014-borrowed-tuning-parts.md).
Field-found by the user 2026-08-19: the blade's rear bumper sits in the wrong place, and it is right in the
stock game.

## The fix, measured over the same 212 folders

**9 → 0.** A shipped part is the slot's OWN when its stock `veh_mods.ide` row is textured by that slot;
anything textured by another car is a NEW part of the car shipping it and is installed under
`<stock name>_<token>` with the stock part's IDE row, shop item, price and `link` cloned under it, and the
car's `carmods.dat` line repointed. So the voodoo's eleven borrowed parts become its own, and the blade and
the slamvan keep theirs.

| | before | after |
| --- | ---: | ---: |
| entry names two folders stage with different files | 9 | **0** |
| entry names shared by two folders at all | 9 | **0** |
| archive entries the fleet stages | 747 | 756 |

Both shapes the section below left to the user's call shipped, and shape 1 outlived shape 2: the guard now
asks about the entry name a file is staged UNDER, and refuses a fleet that still stages two different files
on one name — which after the rename can only be a name the derivation cannot classify. It is silent on the
real fleet, and that is what says the fix holds.

**The rule is not the one the plan was written with.** It named the slot's stock `carmods.dat` `mods` line;
measured first, that line is wrong in 22 places — a right-hand part is bought through its left partner's
`link` and is on no line at all, so renaming one would break a stock pair and leave the car buying a left
skirt with no right side. The TXD column never contradicts the line: 0 stock rows name a part whose txd is
another car's.

## The cause

A vehicle mod may ship replacements for the STOCK tuning parts of its slot, named exactly as the stock parts
are (`rbmp_lr_bl1.dff`, `wg_l_lr_slv1.dff`, …). Those names are global — one model per name in the archive —
so when two mods ship the same name, **the installer stages both and the last one silently wins**. The car
that lost then wears a part modelled for a different body.

Blade's rear bumper is the voodoo mod's, modelled for a 1960 Impala, which is why it hangs off a 1964
Thunderbird.

## Measured on the built tree, 2026-08-19

**9 clashes, all `.dff`, no `.txd`**, across three folders — and the voodoo mod wins every one of them:

| part | loser | winner (in the archive) |
| --- | --- | --- |
| `rbmp_lr_bl1` | blade — *1964 Ford Thunderbird - gross* (174 764 B) | voodoo — *1960 Chevrolet Impala - chezy* (771 365 B) |
| `bbb_lr_slv1`, `bbb_lr_slv2`, `fbb_lr_slv1`, `fbb_lr_slv2`, `wg_l_lr_slv1`, `wg_l_lr_slv2`, `wg_r_lr_slv1`, `wg_r_lr_slv2` | slamvan — *1968 GMC Pickup Hammered - alfamodding* | voodoo — *chezy* |

The voodoo mod borrows the slamvan's and the blade's part names to give itself parts — a mod-authoring
shortcut that works only while it is the only mod doing it. Its own ModelVariations section says so plainly:
`[voodoo] Global=412,…,bbb_lr_slv1,bbb_lr_slv2,fbb_lr_slv1,fbb_lr_slv2,wg_l_lr_slv1,…,rbmp_lr_bl1,…`.

## Why nothing caught it

- **Byte-faithfulness is not enough**: every file in the archive IS some mod's file, unmodified. The defect
  is which mod's.
- The install log reports each file staged; it does not report that a name was already taken by a DIFFERENT
  mod's file. `mod-id-collisions.ts` answers the same question for model IDs in `.ide` rows and would not see
  this — the clash here is an archive ENTRY NAME, and both rows are the same stock id.
- The symptom is geometric, not a failure: the part loads, mounts and renders. Only the eye catches it.

## The shapes a fix could take

1. **Guard only** — the installer refuses (or warns loudly) when two vehicle folders ship the same part file
   name with different content, naming both mods. Cheap, honest, and leaves the user to choose. This much is
   needed regardless of what else is built.
2. **Per-car part names** — give the losing car's parts a derived name and its own IDE id, and repoint that
   car's `carmods.dat` line, exactly as `tools/add-vehicles` already does for an added car's derived parts
   (plan 005). Both cars then keep their own geometry. Costs one id per clashing part (9 today) and touches
   the shop lists, which already carry per-car derived rows, so the machinery exists.

Not decided — it is the user's call which of the two ships.

## What is NOT the cause, checked

The `sa` target converts no vehicle model: `blade.dff`, its five TXDs and every other part of that folder are
byte-identical in the archive to the mod's own files. The one file the pipeline has ever rewritten is
`wg_r_lr_bl1.dff` ([frame order](../../gta-sa-original/rw-frame-list-parent-order.md)), and that repair is a
pure permutation whose result matches its untouched mirror frame for frame.
