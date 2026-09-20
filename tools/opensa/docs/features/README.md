# Feature reference

Per-feature state of the engine: what is implemented (supported formats/cases), key files and
known gaps. Maintained for three purposes: finding unimplemented cases, writing tests for the
implemented ones, and assembling the release changelog.

| Feature                                       | Doc                                                |
| --------------------------------------------- | -------------------------------------------------- |
| DFF parser (models)                           | [dff-parser.md](dff-parser.md)                     |
| TXD parser + textures                         | [txd-textures.md](txd-textures.md)                 |
| IMG archive + asset cache                     | [img-archive.md](img-archive.md)                   |
| Asset loader (chunk download/cache)           | [asset-loader.md](asset-loader.md)                 |
| Map pipeline (DAT/IDE/IPL → streaming)        | [map-pipeline.md](map-pipeline.md)                 |
| Collision + physics                           | [collision-physics.md](collision-physics.md)       |
| World lighting (SA prelit)                    | [world-lighting.md](world-lighting.md)             |
| Time, night content, light sources            | [night-and-time.md](night-and-time.md)             |
| Weather + environment (sky/water/fog)         | [weather-environment.md](weather-environment.md)   |
| Vehicles                                      | [vehicles.md](vehicles.md)                         |
| Vehicle license plates                        | [vehicle-plates.md](vehicle-plates.md)             |
| Character                                     | [character.md](character.md)                       |
| Camera (follow rig, photo/map free-fly)       | [camera.md](camera.md)                             |
| Video mode (seeded showcase runs, 096)        | [video-mode.md](video-mode.md)                     |
| Animated map objects (UV + IFP)               | [animated-map-objects.md](animated-map-objects.md) |
| Procedural ground clutter (procobj)           | [procobj.md](procobj.md)                           |
| Road-sign text (2dfx type 7)                  | [roadsign-text.md](roadsign-text.md)               |
| World effects (2dfx particles)                | [world-effects.md](world-effects.md)               |
| Vehicle effects (smoke, skids, dust — 089)    | [vehicle-effects.md](vehicle-effects.md)           |
| Breakable objects                             | [breakable-objects.md](breakable-objects.md)       |
| Game mods (WorldMod, vegetation wind)         | [mods.md](mods.md)                                 |
| Fetch pack (pmb build → hosted fetch chunks)  | [fetch-pack.md](fetch-pack.md)                     |
| Zones, HUD, debug tooling                     | [zones-hud-debug.md](zones-hud-debug.md)           |
| UI shell (boot/menu/loading/pause)            | [ui-shell.md](ui-shell.md)                         |
| Mobile on-screen controls (touch)             | [mobile-controls.md](mobile-controls.md)           |
| Dispatch console (CAD over the map)           | [dispatch-console.md](dispatch-console.md)         |
| CLEO scripts (decoder, VM, host, native atlas) | [cleo.md](cleo.md)                                 |

Cross-cutting architecture (native `.osm`/`.ostex`/`.oscell`/`.oswire`/`.ospak` formats, engine world
streaming, the boot/loader chain, the offline build pipeline) lives in
[docs/architecture/](../architecture/README.md).
