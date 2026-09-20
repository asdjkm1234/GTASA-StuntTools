# Patch catalogue — perfect-vehicle

The human half of [`gen/catalogue.ts`](../gen/catalogue.ts), which is the machine source of truth. The two
MUST agree; a test reads every catalogued byte back off the shipping exe
(`fixtures/original/gta_sa.exe`, SHA1 `8c23ceff…`), so a typo here cannot reach the field as a jump written
over the middle of an instruction.

Addresses are 1.0 US virtual addresses (image base `0x400000`). The RE that produced them, with the full
census and the reasoning, is [plan 001](plans/001-re-carmods-ceilings.md).

## `carmods-links` — the game-wide `link` pairs (strategy: hook)

`CLinkedUpgradeList` @ `0xB4E6D8`: `int16 m_anUpgrade1[30]` at `+0`, `int16 m_anUpgrade2[30]` at `+0x3C`,
`uint32 m_nLinksCount` at `+0x78`.

| site | address | bytes | why it is in the catalogue |
| --- | --- | --- | --- |
| `AddUpgradeLink.entry` | `0x4C74B0` | `8b 41 78 66 8b 54 24 04` | REPLACED — a 5-byte jmp to our writer. Six instructions, no bounds check |
| `FindOtherUpgrade.entry` | `0x4C74D0` | `8b 41 78 85 c0 74 1b` | REPLACED — a 5-byte jmp to our reader |
| `LoadVehicleUpgrades.link.this` | `0x5B6859` | `b9 d8 e6 b4 00` | VERIFIED ONLY — the `mov ecx, list` before the writer's single caller. If an adjuster ever repoints the list, this byte moves and we defer instead of writing into a structure we no longer own |
| `FindOtherUpgrade.call.4986BB` | `0x4986BB` | `e8 10 ee 02 00` | VERIFIED ONLY — one of the five reader call sites, as a witness that the call shape is still what the census saw |

**What it does not touch**: the structure itself. After the patch the game's own 124 bytes are simply
unused; our storage is `int16[256] × 2` plus a count in the plugin's `.bss`.

**Coexistence**: FLA's log on the reference install lists 3 712 memory changes and names none of this; its
ini has no setting for either array. The per-site byte verify is the referee either way.

## Not in the catalogue yet — the per-car array

`CVehicleModelInfo::m_anUpgrades` @ `+0x2D6`, `int16[18]` (the constructor's own `rep stos` of 9 DWORDs
pins the size). Seven access sites, all classified in plan 001; the lift shape is a sidecar keyed by model id.
Nothing needs it, so nothing is written — see the README's table for what the guard says instead.
