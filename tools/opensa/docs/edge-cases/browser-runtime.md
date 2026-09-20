# Browser & platform edge cases

- **The local (folder) loader is Chromium-only** — File System Access API; `fetch` stays the default
  elsewhere. Opt-in per game (`assetLoader: 'local'`).
- **The native folder picker cannot be automated.** Playwright can't drive the FSA dialog — e2e uses an
  in-page fake FSA tree; real folder flows need a human. Headless _field checks_ are still possible: the
  bench harness boots the real game through `?loader=http-dir&src=<served build>` (no picker on that path).
- **Cache Storage needs a secure context.** Over plain `http://` (e.g. a phone on a LAN IP) `caches` is
  undefined and every cache op silently no-ops — assets re-download each visit, nothing breaks. The same
  applies to the pak's range-slice cache (201/4-03) — and note which side of the line the phone is on:
  Termux serves the console at `http://localhost:3001`, which IS a secure context, so the cache works
  there. A DIFFERENT device reaching the same server over `http://<lan-ip>` gets no cache and re-reads the
  district every open.
- **A cached `Range:` response cannot be stored as one.** `cache.put` rejects a 206 by spec, and
  `cache.match` ignores the `Range:` header when matching — so every slice of one file would collide on a
  single entry. `stream/pak-cache.ts` re-wraps the bytes as a 200 and puts the range IN the key.
- **Visual regression renders on Chromium's software backend** (for determinism), not real GPU — it cannot
  judge WebGPU-specific defects.
- **The shell e2e needs built `static/games/original-*` archives** — it only runs where those exist (not on
  GitHub-hosted CI).
- **User activation is fragile.** The folder prompt must be the **first** await in the Play-click handler
  (an IndexedDB read before it loses the gesture); `requestPointerLock` may only be called once per gesture
  (a second call silently breaks selection — the map-viewer dead-select bug).
- **The install-source loaders ingest a SUBSET of `gta3.img`** (`selectInstallEntries`: IPL-placed models +
  every ped/vehicle + procobj clutter + loose/world). A feature that builds geometry live from a DFF chosen
  by any OTHER data file must add its model+txd refs to `build-vfs.ts` (the `procObjModelRefs` pattern) — or
  the model is silently absent in the browser (`getClump` returns empty, nothing renders) while offline Node
  probes, which read the whole archive, work fine.

## A frame's length includes work no in-loop timer can reach (2026-07-28, plan 091)

`dt` is wall-clock between the STARTS of consecutive rAF callbacks, so a frame's measured length covers
everything the browser did after the previous loop returned: promise continuations, worker `onmessage`
handlers, upload callbacks, GC. **No timer placed inside the loop body spans that region** — it is outside
the region any of them covers — and it is where a resolved vehicle spawn or a cell's collider build is paid.

The consequence for anything that measures a frame: the CPU blocks a loop times can sum to 5 ms on a 250 ms
frame and still be a complete account of the loop. The half that is missing is named by the frame-span
recorder (`packages/engine/src/debug/frame-spans.ts`), which async work reports itself into and the loop
drains at the top of the next frame — measured on 2026-07-28: a 250 ms boot frame whose `other` residual was
223.6 ms, of which the loop could see nothing at all.

## Rapier queries: two traps that cost a session each (2026-07-27, plan 081/10)

- **A ray sees NOTHING until the world has stepped once.** The query pipeline is built inside
  `world.step()`, so a probe written against freshly-created colliders reports "no ground" and looks like a
  data bug. Every physics test that casts must step first; the real game never notices because it steps
  before anything asks.
- **A trimesh hit on the BACK of a triangle comes back as `featureId + triangleCount`.** That is parry's own
  encoding, and the game's roads are wound so a downward ray lands on exactly that side: a 106-triangle road
  answered 127 and 133. Read straight, the id runs off the end of any per-triangle table and every lookup
  silently reports "unknown" — take it modulo the triangle count. A hand-written test fixture naturally winds
  its quad TOWARD the ray and passes while the game fails, so the regression test has to wind it away.

## Rapier's raycast vehicle: three asymmetries to design around (2026-07-26, plan 081)

`DynamicRayCastVehicleController` is Bullet-lineage, and three of its properties are load-bearing for anyone
touching driving. All three are worked around in `PhysicsWorld.setVehicleControls`; none is a bug to file.

- **Its friction clamp is skipped in a straight line.** `update_friction` computes the limit
  `μ × suspensionForce × dt` and a `skid_info` factor, then applies it only `if wheel.side_impulse != 0.0`.
  A car accelerating or braking dead ahead therefore has NO longitudinal grip limit and will put any force it
  is handed into the road (measured: 5 g launches). The clamp has to be applied by the caller.
- **Its friction circle weighs the two axes unevenly**: `fwd_factor = 0.5`, `side_factor = 1.0`. A wheel
  braking at its full grip has spent only half of its circle and keeps up to **87 %** of its lateral
  capacity — so locking a wheel's brakes does not unstick it. Cutting `side_friction_stiffness` is the only
  way to express "this tyre is skidding".
- **It exposes no skid state.** `skid_info` is internal; sliding has to be inferred from
  `wheelForwardImpulse` / `wheelSideImpulse` against the wheel's own friction circle.

## Mobile GPUs: no BC, so a pak is built for ONE family (2026-08-04, narrowed 2026-08-07)

A pak built from SA assets is **BC-compressed throughout** — the converter passes SA's own DXT blocks through
untouched (`packages/cell-weld/src/textures.ts`, "opaque, well-formed DXT: pass through"), and `.ostex` encodes
only BC1/BC2/BC3/BC7 and RGBA8. Mobile GPUs (Adreno, Mali, PowerVR, Apple) ship **ETC2 and ASTC**, never BC,
and WebGPU exposes each as a separate optional adapter feature.

So on a phone the browser is not the problem — Chrome on Android has had WebGPU since 121, Safari since
iOS 26 — the **content** is. The measured consequences:

- The device now BOOTS on a phone: `initDevice` requests `texture-compression-bc` only when the adapter offers
  it (requesting a feature the adapter lacks makes `requestDevice` reject outright, which is why it used to
  throw). Verified 2026-08-04 on an emulated Pixel 7 with the feature filtered out of the adapter.
- **The world is then refused at MANIFEST time**, not at the first texture: `ospakRequiredFeatures` derives the
  demand from the formats the converter chose, and `requireWorldSupport` checks it once in `setupStreaming`
  before a cell streams. The message names the world and the missing feature. `beginOstexUpload` still throws
  by name as the backstop — model dictionaries (vehicles, peds) reach the GPU without passing the pak manifest
  at all, because a car lives outside the pak.
- **The shell's pre-boot gate no longer asks about BC.** It probes for an adapter and nothing else; a phone
  used to be told its browser does not support WebGPU, which was false. Device and content are two questions
  and are now answered in two places.
- **RGBA8 `.ostex` uploads anywhere.** It is what the dispatch console's `?demo=1` city uses, and
  `opensa-pack --rgba8` now builds a whole world that way: the switch refuses the DXT passthrough so every
  world texture is decoded to RGBA8. It costs **4-8x the texture memory**, which is why it is per-build and
  belongs with a district `--rect` rather than the whole map.

**Cheaper than RGBA8 exists since 2026-08-07: `opensa-pack --textures astc`** re-encodes every array — the
world's and every model dictionary's — to ASTC 4x4 at one byte per texel, the same as BC3 and a quarter of
RGBA8 (plan 200/2-02). It is a second generation of loss on the world's textures, since SA ships DXT, and it
costs build time. What it does NOT do is make one pak serve both families: an ASTC pak demands
`texture-compression-astc` exactly as a BC pak demands `texture-compression-bc`, so **the remaining limit is
that a pak is built for one GPU family** — desktop gets `bc`, a phone gets `astc`, and `rgba8` is the only
one that loads on both. The Basis/KTX2 route that would have removed even that was closed by decision
(`docs/postmortem/universal-texture-transcode.md`).

Not yet demonstrated on a device: as of 2026-08-07 no ASTC pak has been built from real assets or loaded on
the Mali row's phone. Until plan 200/2 records that run, "an ASTC pak works on this GPU" is an expectation
from the adapter's feature list, not a measurement.

### Measured on a real phone (2026-08-04)

Yandex Browser 26.6.2 (Chromium 148), **Mali-G51 / ARM Bifrost, Android 10**, 360x800 CSS px, DPR 2:

| | |
| --- | --- |
| `navigator.gpu` | present |
| adapter, default request | **null** until `#enable-unsafe-webgpu` was enabled and the browser RESTARTED; obtained afterwards |
| adapter, `featureLevel: 'compatibility'` | also obtained — the Vulkan path was not the blocker here, the adapter BLOCKLIST was |
| `texture-compression-bc` | **no** |
| `texture-compression-astc` | **yes** (+ `-astc-sliced-3d`) |
| `texture-compression-etc2` | **yes** |
| `timestamp-query` | no — the HUD's GPU timings fall back to CPU, as designed |
| features | 12, including `core-features-and-limits`, so CORE limits apply (not the reduced compatibility set) |

Three things this pins down. **The BC/ASTC split is real hardware, not theory** — the same adapter that
refuses BC offers both mobile formats. **Chromium's Android 12+ rule is about the DEFAULT**, not a hard
ceiling: an Android 10 device reached a core adapter once the blocklist was lifted. And **the flag is a
developer flag** — it carries a security warning and nobody else's phone has it on, so it proves the hardware
is capable without being a shipping path.

What it makes possible today: `?demo=1` and any `--rgba8` pak render in 3D on this phone. What it argued for
next has since been built — `--textures astc` (200/2-02) — on the strength of this row: ASTC was never a
hypothetical target, this GPU carries it, and an ASTC `.ostex` costs roughly what BC costs instead of
RGBA8's 4-8x. The row still owes its successor: an ASTC pak actually loaded here.

## The dev server does not run on every phone: rolldown dies with SIGILL (2026-08-06)

Measured on the same Android 10 / arm64 device as the mobile row above, Termux, Node 24.18:

| | |
| --- | --- |
| `process.platform` / `arch` | `android` / `arm64` — and npm installed the RIGHT binding, `@rolldown/binding-android-arm64` |
| `node -e "require('rolldown')"` | **exit 132** — SIGILL, killed on the native binding's load |
| `require('lightningcss')` / `require('esbuild')` | 0 — they are fine, so this is rolldown alone |
| `vite --version` | works (it never loads rolldown) |
| `vite` (dev, even in an empty folder with one `index.html`) | **Illegal instruction**, no output at all |
| `NAPI_RS_FORCE_WASI=1` + `@rolldown/binding-wasm32-wasi` installed with `--force` | **still SIGILL** |

The wasm escape hatch does not help, and the reason is the order inside the loader: it calls `requireNative()`
FIRST and only consults `NAPI_RS_FORCE_WASI` with the result. On a CPU that lacks an instruction the binding
was built with, that first call ends the process — the fallback is never reached. (Physically removing the
native binding so the require throws is the only way to get there, untested here.)

**Consequence: on such a device the app cannot be served by vite at all** — not `dev`, not `build`. What works
is a PREBUILT app served as static files: `scripts/phone.sh` uses `build/webapp/index.html` when it exists and
skips vite entirely, which also collapses the two origins into one (no CORS, one port). The converter and the
static server are unaffected — they run on tsx/esbuild, which this CPU executes fine.

**Caught:** by nothing, and it is loud rather than silent — `Illegal instruction` with an empty log. Worth
recording because the symptom names no package: the message points at `node vite.js`, not at rolldown.
