# A tuning part is created as an OBJECT, and an object needs collision — `veh_mods.col`

**Measured 2026-08-19** from the shipping `gta_sa.exe` (1.0 US), two field crashes and the archives of a real
install. A fact about the original game, not about OpenSA.

## The crash

Previewing a NEW tuning part (one the stock game does not ship) kills the game:

```
Unhandled exception at 0x0059F8B4: 0xC0000005: reading location 0x00000029
ECX = the part's model id      EDI = 0x00000000
```

The code says the whole thing:

```
59f8a6:  movsx ecx, WORD PTR [esi+0x22]        ; the object's model index
59f8aa:  mov   edx, DWORD PTR [ecx*4+0xa9b0c8] ; CModelInfo::ms_modelInfoPtrs[id]
59f8b1:  mov   edi, DWORD PTR [edx+0x14]       ; CBaseModelInfo::m_pColModel  <-- NULL
59f8b4:  mov   al,  BYTE PTR [edi+0x29]        ; faults at 0x29
```

`edx` is valid (the model info exists — the caller has already written `m_nAlpha` at `+0xC`), `edi` is not:
**the model has no collision model.** The caller is the part-preview path, which reaches the ordinary
`CObject` constructor (`0x5A1F60`) through `0x4697A0`:

```
469778:  mov eax, ds:0xa43c78     ; the selected item: >= 0 IS a model id, < 0 indexes a 0x1c-byte table
46977f:  jge 0x46978d             ; taken for a model id -- NO range check of any kind
469797:  mov BYTE PTR [ebx+0xc],0xff
46979b:  call 0x5a1f60            ; new CObject(modelId, false)
```

## Where a stock part's collision comes from

**`gta3.img` carries `veh_mods.col`** — and it holds **exactly one entry per stock tuning part: 194 entries,
model ids 1000–1193**, which is the whole stock upgrade block of `data/maps/veh_mods/veh_mods.ide`. Nothing
else has one:

| | |
| --- | --- |
| any tuning part `.dff` (stock or mod) | **no embedded collision** — checked across the stock parts, a mod's parts and our derived ones: not one carries a `Collision Model PLG` chunk |
| `models/coll/vehicles.col` | 1 096 bytes, ONE entry (`airtrain`) — not this |
| `gta3.img : veh_mods.col` | 24 576 bytes, **194 entries, ids 1000–1193** — this |

So a part the stock game ships has collision; a part anybody ADDS does not, and the preview path does not
check.

## The flag that appeared to excuse it — and did not

Our added fleet derives ~46 tuning parts of its own, none of which has a `veh_mods.col` entry either, and
for a whole session they did NOT crash. The only thing that separated them from the two that did was the IDE
flags column, so this file first read the difference as: **a part with no collision entry must carry
`0x200000`**.

**The field disproved that on 2026-08-20, twice.** With the flag written into every one of them:

| spawned | id | flags | result |
| --- | ---: | ---: | --- |
| `spl_b_lr_bl` (a mod's hand-written part) | 1194 | `2097152` | **crash**, `0x0059F8B4`, `ECX = 0x4AA`, `EDI = 0` |
| `exh_lr_rem1_059` (one of the 46 derived) | 19051 | `2097152` | **crash**, same address, `ECX = 0x4A6B`, `EDI = 0` |

So the flag has nothing to do with it — and this project already knew what it IS, two greps away:
**bit 21 is DISABLE BACKFACE CULLING**, a rendering flag on 1 586 stock object defs, read by our own engine
since plan 004 and tabulated in [`docs/plans/039-ide-object-flags/readme.md`](../plans/039-ide-object-flags/readme.md).
The stock parts carrying it carry it because their geometry is two-sided. It was never going to answer a
null `m_pColModel`.

**What the 46 had in common was not a property of their data but a class of USE**: nothing had ever spawned
one. The mod shop MOUNTS a part onto a car and never reaches the
`CObject` constructor; a trainer that spawns the model as an object does, and then any part without
collision dies — ours, a mod's, whichever.

A control group that was never exposed to the treatment is not a control group. The hack built on that
reading is [`docs/hacks/retired/upgrade-part-no-collision-flag.md`](../hacks/retired/upgrade-part-no-collision-flag.md).

## What it means for a tool

A tool that writes a NEW tuning part row cannot leave this to the mod author. The check is static and needs
no field round: read every `objs` row of the built `veh_mods.ide`, read the entry names of `veh_mods.col`
inside `gta3.img`, and for every row with no entry require the flag. The id does not matter — this was
tested in the field by moving both parts to 19701/19702, and the crash moved with them (`ECX = 0x4CF5`).

**Built 2026-08-20, and field-confirmed the same day**: every part either tool adds gets a **bounds-only
COL3 model of its own**, the shape SA's own LOD vegetation ships, written into `models/coll/opensa-parts.col`
and registered with one `COLFILE 0 MODELS\\COLL\\OPENSA-PARTS.COL` line in `default.dat`. A file of ours
rather than an append to `veh_mods.col`, because that entry lives inside `gta3.img` and rewriting a 1.6 GB
archive is a poor price for 112 bytes per part. `assertUpgradeCollision` then refuses a build whose
`veh_mods.ide` names a part with collision in neither place.

**Measured on the real install**: 253 `objs` rows, **194 with stock collision** (exactly the 1000–1193
block) and **59 without** — 11 derived for the voodoo, 2 a mod declares by hand, 46 the added fleet derives.
All 59 now carry one, with the bounds of their own geometry (13 models read out of the archives, 46 loose in
`modloader/added-vehicles/`). Both ids that crashed spawn cleanly with the file in place.

Neighbours: [`carmods-upgrade-ceilings.md`](carmods-upgrade-ceilings.md) (what a part NAME must look like and
how many a car may have), [`carmods-unknown-part-crash.md`](carmods-unknown-part-crash.md) (a `carmods.dat`
token with no IDE row at all), [`rw-frame-list-parent-order.md`](rw-frame-list-parent-order.md) (the OTHER
crash the blade's parts caused, and the reason this one was masked for a session).
