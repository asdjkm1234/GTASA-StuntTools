# 001 — RE: the two `carmods.dat` ceilings

**Status: DONE 2026-08-19** — both arrays fully catalogued out of the shipping exe; the lift shapes are
decided below and 002 builds them. Measurement and rule: `docs/gta-sa-original/carmods-upgrade-ceilings.md`,
`docs/restrictions/sa-target.md`. Starting points from gta-reversed (`Models/VehicleModelInfo.{h,cpp}`):

- `CVehicleModelInfo::ms_linkedUpgrades` = `CLinkedUpgradeList` @ **`0xB4E6D8`**: `int16 m_anUpgrade1[30]`,
  `int16 m_anUpgrade2[30]`, `uint32 m_nLinksCount` (124 bytes). Writers: `AddUpgradeLink` (`0x4C74B0`,
  from `LoadVehicleUpgrades`' `link` case). Readers: `FindOtherUpgrade` (the loop from `m_nLinksCount - 1`
  down, both arrays) and whoever else indexes the arrays — the scan says.
- `CVehicleModelInfo::m_anUpgrades` = `int16[18]` at a fixed offset inside `CVehicleModelInfo` (the struct
  is a pool element, so the array cannot grow in place — relocation by INDEX like `IplDef`'s int16 story:
  a sidecar per model id, or a wider array in our own allocation with the readers redirected). Writers:
  `LoadVehicleUpgrades` `mods` case (`m_anUpgrades[upgradeIdx++]`, then `hydralics`, `stereo`). Readers:
  `CVehicleModelInfo::GetNumRemaps`? no — `CVehicle::AddVehicleUpgrade`/`CVehicleModelInfo::GetUpgrade*`,
  the mod shop's listing (`CShopping`), `CVehicleModelInfo::SetupVehicleUpgradeFlags` consumers — the scan
  says; every site is a relocation target.

## Steps

1. **Scan** with `scripts/debug/exe-field-access-scan.ts`: the link list by its absolute address
   (`0xb4e6d8`, `0xb4e714` = `m_anUpgrade2`, `0xb4e750` = `m_nLinksCount`, and the `lea`/index forms), the
   per-car array by its struct offset (`--offset <off> --width 16 --context <CVehicleModelInfo vtable / the
   pool base 0xB74494>`). Classify every survivor; the gta-reversed grep must agree (the 011 method).
2. **Read the live bytes** at every site on the reference install through the SDK's `VerifyAllSites`
   (a verify-only build of this plugin with the catalogue filled): FLA hooks `LoadVehicleUpgrades`? (it
   patches vehicle-side things — its log lists them) — record who owns what.
3. **Catalogue** (`gen/catalogue.ts` + `docs/patch-catalogue.md`), with the exe-fixture test from day one
   (perfect-map `gen/generate.test.ts`'s last test, lifted into the SDK or copied).
4. **Decide the lift shape per array** and write it down: relocate-and-repoint (004's `gpLoadedBuildings`
   pattern — enlarge to N, repoint every site) for the static list; for the per-model array, the sidecar
   keyed by model id (the int16 pattern) or a relocated `CVehicleModelInfo` layout (NO — pool element size is
   everywhere). The numbers: links 30 → 256, parts 18 → 64, both configurable in the ini we ship? perfect-map
   has no ini — decide: compile-time constants with a generous margin, like the rest.

## Measured

Read out of `fixtures/original/gta_sa.exe` (the ONE accepted build) with
`i686-w64-mingw32-objdump -d -M intel`, cross-checked against gta-reversed. **Every access site of both
arrays is accounted for**, which is the whole point of this plan — 004 nearly shipped with one unpatched
read, and the census is what stops that.

### 1. `CLinkedUpgradeList` @ `0xB4E6D8` — the game-wide `link` pairs

Layout, confirmed by the two methods' own displacements:

| field | offset | size |
| --- | --- | --- |
| `m_anUpgrade1[30]` | `+0x00` | 60 B |
| `m_anUpgrade2[30]` | `+0x3C` | 60 B |
| `m_nLinksCount` | `+0x78` | 4 B (DWORD) |

**The address `0xB4E6D8` appears exactly 7 times in the exe, and every one is `mov <reg>, 0xb4e6d8`
immediately before a call to one of two methods** — the arrays are never indexed from outside:

| site | what |
| --- | --- |
| `0x4073C0` | `mov eax,0xb4e6d8; ret` — a getter with **no callers at all** (dead) |
| `0x5B6859` | `LoadVehicleUpgrades`' `link` case → `call 0x4C74B0` (the only writer's only caller) |
| `0x4986BB`, `0x6DF962`, `0x6E32D1`, `0x156A11D`, `0x156C98A` | the five `call 0x4C74D0` readers (two of them in the relocated high region — the HOODLUM body split perfect-map already met) |

The two methods, in full:

```
AddUpgradeLink   0x4C74B0  mov eax,[ecx+0x78] · mov dx,[esp+4] · mov [ecx+eax*2],dx
                           mov eax,[ecx+0x78] · mov dx,[esp+8] · mov [ecx+eax*2+0x3c],dx
                           inc DWORD [ecx+0x78] · ret 8            ← NO bounds check, at all
FindOtherUpgrade 0x4C74D0  eax = count; loop eax-- : cmp [ecx+eax*2],dx / cmp [ecx+eax*2+0x3c],dx
                           returns the partner, or 0xFFFF · ret 4
```

**Lift shape, decided: DETOUR THE TWO METHODS, own the storage.** No displacement rewriting (`0x3C` and
`0x78` are disp8 forms — a bigger array needs disp32 and the instructions change length), no relocation of
the static, no touching the 7 immediates. Both methods are `__thiscall`-shaped (`this` in ecx, args on the
stack, `ret 8` / `ret 4`) and small enough to reimplement exactly. Since every access goes through them,
detouring both is 100 % coverage by construction — which the census above is the proof of.

### 2. `CVehicleModelInfo::m_anUpgrades` @ `+0x2D6` — the parts on ONE car

`int16[18]`, pinned by the constructor's own initialiser: `0x4C760A` does `lea edi,[esi+0x2d6]` then
`mov ecx,9; rep stos DWORD` = **36 bytes = 18 int16**.

Every access, all 7:

| site | role |
| --- | --- |
| `0x4C760A` | the constructor's `rep stos` init (9 DWORDs of `-1`) |
| `0x5B675E` + `0x5B67CC` | `LoadVehicleUpgrades`' `mods` case: `lea ebx,[ebp+0x2d6]` then the loop `mov [ebx],cx · inc edi · add ebx,2` **with no bound on the tokeniser** |
| `0x5B67CC` / `0x5B67ED` | the two appends after the loop — `mov [ebp+edi*2+0x2d6],cx` and `[…+0x2d8],ax` for the strings at `0x85BB20`/`0x85BB28`, which are `stereo` and `hydralics`. **This is where "16 listed + 2 appended = 18" comes from, in the machine code** |
| `0x492E14` | `GetUpgrade(i)`: `movsx eax,WORD [ecx+eax*2+0x2d6]; ret 4` |
| `0x5B3559` | `SetUpgrade(i, v)`: `mov WORD [ecx+edx*2+0x2d6],ax; ret 8` |
| `0x49836A` | a direct read in the shop path, indexed by the global at `0xA43C7C` |
| `0x1569299` | `lea ecx,[edx+0x2d6]` in the relocated high region |

What the overrun hits: the constructor writes `-1` DWORDs at `+0x2FA` and `+0x2FE` right after the array,
so a 17th part lands in the model info's own following fields — silent, and read somewhere else entirely.

**Lift shape, decided: a SIDECAR keyed by model id**, the `IplDef` pattern of perfect-map 011. The array
lives inside a pool element whose size is baked into every allocation site, so it cannot grow in place; our
own `int16 upgrades[N]` per vehicle model, with the getter, the setter, the loader's write loop and the
direct shop read redirected. The constructor's init stays as it is (it clears the stock 36 bytes, which
remain the fallback).

### Coexistence

FLA's log on the reference install lists 3 712 memory changes and **not one of them names an upgrade, a
link or `carmods`** — its ini has no setting for either array (`Collision links` is unrelated). OLA owns
IPL zones alone here. So both lifts are ours to take; the SDK's live-byte verify against the running install
is 002's first step, not an open question.

### Numbers for 002

**Links 30 → 256, parts 18 → 64**, compile-time, like the rest of perfect-map (no ini — an ini is a second
source of truth for a number nobody tunes). The fleet needs 31 and 16 today; the margins are what stop this
plan being re-opened by the next fifty cars.
