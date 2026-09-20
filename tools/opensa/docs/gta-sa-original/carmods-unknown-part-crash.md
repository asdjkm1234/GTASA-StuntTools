# `carmods.dat` naming a model no IDE row defines crashes the game at boot

**Measured 2026-08-17 on the reference bottle (SA 1.0 US, OLA + FLA + our asis).**

```
Unhandled exception at 0x004C4576 in gta_sa.exe (+0xc4576): 0xC0000005: Access violation reading location 0x00000012.
    ECX: 0x00000000  …
    Backtrace: 0x004C4576 → … → 0x004C4A80
```

`0x4C4570` is `CAtomicModelInfo::SetupVehicleUpgradeFlags(const char* name)` (gta-reversed
`AtomicModelInfo.cpp`), and `+6` is its first read, `this->bUseCommonVehicleDictionary` at `+0x12` — of a
NULL `this`. The caller is `CVehicleModelInfo::LoadVehicleUpgrades` (`0x5B65A0`, `VehicleModelInfo.cpp`):
for every token of a `link` / `mods` / `wheel` line it does

```cpp
auto ami = static_cast<CAtomicModelInfo*>(CModelInfo::GetModelInfo(nextToken, &iModelId));
ami->SetupVehicleUpgradeFlags(nextToken);   // no null check
```

so **a token that is not the name of a loaded model is a null dereference during data load** — before the
menu, on every boot, with no log line naming the file. There is no hardcoded upgrade-id range (1000–1193 is
where stock puts them; nothing in the reversed source refuses 1194+), so a mod MAY add parts — it just has
to define them.

**What produced it here**: `blade - 1964 Ford Thunderbird - gross` ships two new parts (`spl_b_lr_bl`,
`bnt_b_lr_bl`) whose IDE rows live in its `tuning_new_parts.txt`, which vehicle-installer did not read;
the built `carmods.dat` named them, the built `veh_mods.ide` did not. Latent since the mod was installed —
the bottle's `data/` had not been re-delivered since 10 Aug (see [reference-install.md](reference-install.md),
"The trap in delivering to it"), so the built line had never been booted.

**What catches it now**: `assertCarmodsModels` (vehicle-installer, plan 009) fails the install/rebake naming
the line and the token; `tuning_new_parts.txt` is read (`docs/contracts/vehicles.md`).
