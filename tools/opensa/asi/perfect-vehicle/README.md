# perfect-vehicle.asi

Our own **vehicle-side** limit adjuster for real GTA:SA 1.0 US — the sibling of
[`perfect-map`](../perfect-map/README.md), on the same [SDK](../sdk/README.md), built the same way
(`npm run build:asi`, MinGW-w64, no CRT, KERNEL32 only).

It exists because `carmods.dat` has two fixed-size arrays that no adjuster has a setting for, and the added
fleet walks into one of them:

| ceiling                                                          | stock                             | here               | what overflowing does                                                          |
| ---------------------------------------------------------------- | --------------------------------- | ------------------ | ------------------------------------------------------------------------------ |
| `link` pairs, game-wide (`CLinkedUpgradeList` @`0xB4E6D8`)       | 30 (23 used)                      | **256**            | the next pair writes past both arrays and the count — silent static corruption |
| upgrade parts on ONE car (`CVehicleModelInfo::m_anUpgrades[18]`) | 16 listed (+`hydralics`+`stereo`) | **not lifted yet** | the 17th part overruns into the model info's next fields                       |

The second one is **researched and deliberately not built**: nothing needs it (the fleet's fullest car lists
15 of the 16), its RE is complete in [plan 001](docs/plans/001-re-carmods-ceilings.md), and
`vehicle-installer`'s guard refuses a tree that would need it — with a message that says the patch is not
built rather than pretending the plugin covers it.

## How the link lift works

The census in plan 001 found the list's address exactly **seven times** in the exe, and every one is a
`mov <reg>, 0xb4e6d8` immediately before a call to one of two methods (`AddUpgradeLink` 0x4C74B0,
`FindOtherUpgrade` 0x4C74D0); the seventh is a getter nothing calls. So the arrays are never indexed from
outside, and replacing those two methods with our own — over our own storage — is complete by construction
rather than by hope. It also avoids re-encoding the `+0x3C`/`+0x78` displacements, which are disp8 forms that
change instruction length the moment the array grows past 127 bytes.

We add the bound the game never had: past 256 the pair is dropped and logged instead of written past the end.

## Building

```bash
npm run build:verify -w @opensa/perfect-vehicle-asi   # dry run: verifies every site, patches nothing
npm run build:asi    -w @opensa/perfect-vehicle-asi   # the shipping build → dist/perfect-vehicle.asi
```

`dist/` is gitignored. `perfect-map-builder` ships whatever is there into the built `sa` tree before the
added cars are installed, and warns loudly when there is nothing to ship — a tree without it is one whose
`carmods.dat` the installer will refuse.
