# `carmods.dat` has two fixed-size ceilings, and neither is checked

**Read out of gta-reversed 2026-08-19** (`Models/VehicleModelInfo.{h,cpp}` — `CVehicleModelInfo::LoadVehicleUpgrades`,
`CLinkedUpgradeList`), measured on stock `data/carmods.dat`, on our built tree and on the user's earlier
added-vehicles build. A fact about the original game; the rule it imposes on a design is in
[`docs/restrictions/sa-target.md`](../restrictions/sa-target.md).

| structure | size | what fills it | stock | `build/original/sa` | the old added-cars build |
| --- | --- | --- | --- | --- | --- |
| `CVehicleModelInfo::ms_linkedUpgrades` (`CLinkedUpgradeList` @ `0xB4E6D8`): `int16 m_anUpgrade1[30]`, `int16 m_anUpgrade2[30]`, `uint32 m_nLinksCount` | **30 pairs, game-wide** | every line of the `link` section (`wg_l_lr_rem1, wg_r_lr_rem1`) — `AddUpgradeLink` writes `[m_nLinksCount++]` with no bound | **23** | 23 | **30 — exactly full** (23 + 7 added wing pairs) |
| `CVehicleModelInfo::m_anUpgrades` — `int16[18]` per vehicle | **18 per car** | the car's `mods` line, THEN `hydralics` and `stereo` appended unconditionally → **≤ 16 listed parts** | `jester` 16 (full) | 15 max | 16 |

Past either, the write goes into whatever follows the array — `m_nLinksCount` itself for the link list,
the next fields of the model info for the per-car array. Nothing reports it; the symptom arrives later,
wherever the clobbered memory is read. Neither FLA nor OLA has a setting for them (FLA's `Collision links`
is unrelated).

Two more facts the same loader imposes on a part NAME: `CAtomicModelInfo::SetupVehicleUpgradeFlags(name)`
derives the component's flags FROM THE NAME PREFIX (`exh_`, `wg_l_`, `wg_r_`, `spl_`, `rf_`, `fbmp_`,
`rbmp_`, `bnt_`, `bbb_`, `fbb_`, `lgt_`, `misc_`, …), so a renamed part keeps its prefix or loses its
behaviour; and the IDE loader reads a model name with `sscanf %s` into `char[24]` while an IMG entry name is
24 bytes including `.dff` — a part name is safe at **≤ 19 characters**. Stock part names are ≤ 14
(`misc_c_lr_rem1`).

**19 is FIELD-CONFIRMED, 2026-08-19** (plan 102's shop round): the added fleet's derived parts sat exactly on
that ceiling — `fbmp_lr_rem1_059veh`, `rbmp_lr_rem2_059veh`, `wg_l_lr_rem1_059veh`, `wg_r_lr_rem1_059veh`,
19 characters and 23 with `.dff`, one byte of the 24 left for the NUL. All 46 derived parts import at their
own ids, fit their cars in the mod shop and crash nothing. It had NO margin: a scheme adding one character to
the suffix is over — and the next mod set did exactly that (`wg_r_lr_slv1_slamvan`, 20).

**The margin the token scheme bought, 2026-08-20** (`vehicle-installer` 014): the suffix is no longer the
slot name but the shortest prefix that tells the slot apart from every other slot in `vehicles.ide`, floor 3.
All 212 stock slots tokenise distinctly — 142 at 3 characters, 33 at 4, 19 at 5, 2 at 6, 14 at 7 and 2 at 8
(`monstera`/`monsterb`, which have to reach past `monster`). Every part any stock car can wear stays under 19
with its own car's token, the added fleet's longest derived name drops from 19 to **16**
(`fbmp_lr_rem1_059`), and the eight-character tokens belong to monster trucks, hot-ring racers, artic
trailers and trains — none of which the mod shop sells a part for.

**Both numbers were read out of the shipping exe on 2026-08-19** (`asi/perfect-vehicle` plan 001), and the
machine code says them more plainly than the source does:

- `CLinkedUpgradeList`'s layout is pinned by its own two methods — `m_anUpgrade1` at `+0`, `m_anUpgrade2` at
  `+0x3C`, the count at `+0x78` — and `AddUpgradeLink` (`0x4C74B0`) is six instructions with **no bounds
  check of any kind**. The address `0xB4E6D8` appears 7 times in the exe and every one is `mov <reg>, imm`
  before a call to that writer or to `FindOtherUpgrade` (`0x4C74D0`), so nothing indexes the arrays from
  outside.
- `m_anUpgrades` sits at `CVehicleModelInfo + 0x2D6` and its SIZE is the constructor's own initialiser:
  `lea edi,[esi+0x2d6]; mov ecx,9; rep stos DWORD` = 36 bytes = 18 int16. The `mods` loader writes the
  tokens in a loop with no bound, then appends the two strings at `0x85BB20`/`0x85BB28` — `stereo` and
  `hydralics` — at `[…+edi*2+0x2d6]` and `[…+0x2d8]`. That is where "16 listed + 2 appended" comes from.
  A 17th part lands in the DWORDs the constructor sets to `-1` at `+0x2FA`/`+0x2FE`.

Why it matters: every ADDED car that re-models its base car's wings costs one `link` pair, and the stock
game leaves exactly 7. `tools/add-vehicles` guards both numbers until `asi/perfect-vehicle` lifts them
(its plan 001 is the RE of every access site).
