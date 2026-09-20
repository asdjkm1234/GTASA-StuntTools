# 002 — Lift: relocate + enlarge, behind two flags

**Status: BUILT 2026-08-19 for the LINK half** (`PV_FIX_LINKS`, 30 → 256); the per-car half is researched
and deliberately not built. **The field ladder is outstanding** — it is a row in the plan-102 round.

## Steps

1. **`PV_FIX_LINKS`** — the link list relocated to our allocation (N pairs), every catalogued site
   repointed (index arithmetic unchanged, base changed — the `gpLoadedBuildings` shape), the count's
   bound-less write now bounded by N (we add the check the game never had, logging the overflow instead of
   corrupting).
2. **`PV_FIX_UPGRADES`** — the per-car upgrades: sidecar or relocation per 001's decision, every reader
   redirected, `hydralics`/`stereo` still appended after the listed parts.
3. **Verify-only build** reports every site clean on the reference install; **APPLY build** logs
   `links APPLIED (N)` / `upgrades APPLIED (N)`.
4. **Field ladder** — a `carmods.dat` with 31 `link` pairs and a car with 17 listed parts (made with
   `tools/add-vehicles` and the guards told the plugin is present): boots, the mod shop lists and installs
   the parts, both wings swap together, eight world entries; then the stock file again (no regression).
5. **Retire the guards' refusal**: `tools/add-vehicles` 005 detects `perfect-vehicle.asi` in the built tree
   and reads the lifted numbers; the `docs/restrictions/sa-target.md` rows move to "lifted"; pmb ships the
   plugin beside `perfect-map.asi` (the same "pre-built artifact, not a build step" rule).

## Measured

**Built 2026-08-19.** `asi/perfect-vehicle` on the shared SDK: `gen/catalogue.ts` (4 sites), the generated
header, `src/patches/links.hpp`, and the plugin skeleton mirroring perfect-map's. Both build modes are clean
under `-Wall -Wextra`; the APPLY build is **16 384 B**.

**The patch.** Two 5-byte jumps, at `AddUpgradeLink` (`0x4C74B0`) and `FindOtherUpgrade` (`0x4C74D0`), into
trampolines that forward the game's callee-cleanup args to plain cdecl functions of ours over our own
`int16[256] × 2` storage. `this` (ecx) is dropped on purpose — the game's structure is no longer where the
data lives. The emitted trampoline was disassembled to confirm the encoding:

```
ff 74 24 08   push DWORD PTR [esp+0x8]      ; arg1 …then arg0, which lands at the same slot after the push
ff 74 24 08   push DWORD PTR [esp+0x8]
e8 …          call our writer/reader
83 c4 08      add  esp,0x8                  ; our own push, cdecl
c2 08 00      ret  0x8                      ; the game's args, callee-cleanup
```

**Why it is complete and not a best effort**: plan 001's census. Seven references to the list in the whole
exe, every one a `mov <reg>, imm` before a call to one of these two. Relocating instead would have meant
re-encoding the `+0x3C`/`+0x78` displacements — disp8 forms that change instruction length past 127 bytes.

**The bound the game never had**: past 256 pairs the writer drops the pair and logs it, instead of writing
past the end of two arrays and a count.

**Verified end to end on an APFS clone of `build/original/sa`:**

| | without the asi | with it in the tree |
| --- | --- | --- |
| `add-vehicles` over the full fleet | REFUSES at 31 link pairs, naming the plugin and the pair | **115 cars + 46 tuning parts installed**, 6.6 s |
| `carmods.dat` | — | 31 link pairs, worst `mods` line 15 |
| headroom reported | −1 | **225 link pairs** |

`vehicle-installer`'s guard reads the tree: `perfect-vehicle.asi` present → the link ceiling is 256; the
per-car ceiling stays 16 either way, and the refusal SAYS that half is not built rather than implying the
plugin covers it. `perfect-map-builder` ships the plugin into the `sa` tree before the cars are installed.

**Where the added cars are installed from, and why it moved**: not the common chain but INSIDE the `sa`
branch, on the finished tree, after the plugin is shipped and before the budget guards — the placement
`procobj` established for content that belongs to one target. In the common chain an `opensa` pak would have
carried 115 cars nothing can spawn.

## What is left

- **The field ladder** (step 4): a boot with 31 pairs, both wings of a re-modelled set swapping together in
  the shop, eight world entries, then the stock `carmods.dat` again as the regression. Rows in
  [the plan-102 field round](../../../../tools/add-vehicles/docs/plans/102-add-vehicles/field-checks.md).
- **`PV_FIX_UPGRADES`** — the per-car array. RE done (001), patch not written: nothing needs it, and writing
  a relocation nobody exercises is how a plugin grows a path that is wrong the first time it runs.
