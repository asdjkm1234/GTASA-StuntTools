# Building a pak a phone can open

A world built from SA assets cannot be displayed on a phone: its textures are BC-compressed and mobile GPUs
ship ETC2/ASTC instead ([edge-cases/browser-runtime.md](../edge-cases/browser-runtime.md)). Two converter
flags fix that — one picks a format the phone can read, the other keeps the bill down — and this page is the
whole recipe, including the case where the phone is the only computer available.

## The flags

| Flag | What it does | What it costs |
| --- | --- | --- |
| `--textures astc` | Re-encodes every array to ASTC 4x4 — **one byte per texel**, the format this phone actually carries | Build time (the encode) + one generation of loss |
| `--textures rgba8` (`--rgba8`) | Refuses the DXT passthrough and leaves the pixels uncompressed — a format every GPU reads | **4-8x** the texture memory |
| `--max-texture N` | Caps every texture edge at N (power of two), halving both axes together so aspect survives | One halving takes back **three quarters** of what the format costs |

**Prefer `--textures astc`** (since 2026-08-07, plan 200/2-02): it is a quarter of `rgba8` on the same texels
— measured on a real district, 27.2 MB against 115.4 MB
([benchmark](../benchmarks/opensa-engine/2026-08-06-headless-district-texture-budget.json)) — and the same
cost a desktop BC3 pak pays. `rgba8` remains the fallback while ASTC has not been proven on a device, and the
one build that loads on BOTH a desktop and a phone.

The format flag and `--max-texture` are meant to be used together. `--rgba8` alone makes a district
affordable only at a very small `--rect`; with `--max-texture 256` the same memory buys roughly sixteen times
the area. With `--textures astc` the cap becomes a quality dial rather than a survival one.

**Convert a SUBSET of the models** (`--vehicles admiral,infernus,comet --peds bmycg,wmycr`) when the point is
a field run rather than a complete game: the roster costs minutes on a desktop and hours on a phone, and two
cars are usually all a run touches. The catch is the reason `npm run phone` gates the spawners: a model left
out keeps its `.dff`/`.txd` and therefore its ORIGINAL (BC) textures, so on a device without BC the first
parked car or car generator reaching for one ends the run — `?parked=0&cargen=0`, both halves, since the
generators are the larger one. The player's ped (`GAME_CONFIG.mainCharacter`, `bmycg`) must be in `--peds`.

**The format flag covers the MODELS too** (`--rgba8` since 2026-08-04, `--textures astc` from the start) — and
completely only since 2026-08-07, when `pack-props` turned out to be the one by-name class that change missed.
A full-models mobile convert failed on it with `world [nothing], models [texture-compression-bc]`: the world
half was clean, the props' private dictionaries were BC. Each class that builds its own dictionary needs the
flag passed to it ([restrictions](../restrictions/assets-and-data.md)). It used to convert only the world, and
a car is not in the pak — `model-ostex.ts` picked BC for any block-aligned dictionary, so a phone loaded the
district and threw on the first spawn. That is why every recipe here passed `--no-models`. With models
converted the flag means what it says, and the cost lands where a car's dictionary already is (~20× its model,
so a full vehicle roster in RGBA8 is not a district-sized decision — keep `--no-models` unless the run needs
cars, or use `--textures astc`, which is what makes a roster affordable at all).

## Verify it rather than trust the flag

```bash
npx tsx tools/opensa-pack/src/cli.ts --game … --out … --textures astc --platforms mobile
```

`--platforms` fails the pack when what it wrote demands a feature that GPU family does not carry, reading
**both** halves (the pak's arrays and every model's dictionary). Without it the pack still reports the demand:
one log line, and `platforms` in `report.json`.

On the engine side the same question is answered twice more, and neither needs a phone in the room:

- `packages/engine/src/core/device.test.ts` boots `initDevice` against a **simulated mobile adapter** (the
  fake's `adapterFeatures` minus BC, rejecting a required-but-absent feature exactly as a browser does). This
  is what pins the 2026-08-04 fix: asking for BC unconditionally makes `requestDevice` reject on every mobile
  GPU, and before this test nothing could see it.
- `packages/engine/src/stream/setup.test.ts` refuses a BC world on a no-BC device at MANIFEST time, so the
  message names the world rather than one texture.

## Capturing a run from a real phone

The build checks say a world *can* load; only a device says what it costs. What a capture must record — and
what it may not be used to claim — is in
[`docs/benchmarks/readme.md`](../benchmarks/readme.md#mobile-runs-a-different-schema-and-never-a-comparable-one).
Two things bite in practice:

- **A flag is not reach.** The 2026-08-04 capture needed `#enable-unsafe-webgpu` plus a browser restart,
  because Chromium's adapter **blocklist** returned a null adapter (not a missing Vulkan path —
  `featureLevel: 'compatibility'` produced an adapter too). A run behind that flag measures hardware
  capability. Say so in the row.
- **Serve over https.** On a plain `http://` LAN IP, `caches` is undefined and every cache operation silently
  no-ops, so the phone re-downloads the world each visit and the numbers include a download nobody intended.
  Since 2026-08-05 the shell **says so** — a note under the preloader (*"This download will not be kept…"*) and
  a `[loader] downloads are NOT cached` line in the console. If you see either, the run carries a download.

A texture over the cap is decoded rather than passed through — a DXT block cannot be resized while compressed —
so `--max-texture` alone already implies re-encoding for the textures it touches.

## One command, on the phone itself

Everything below is what `npm run phone` (`scripts/phone.sh`) does in one go — convert if there is no pak,
print what the pak carries, start both servers, print the URL to open. It exists because a field run is a
ritual repeated dozens of times on a device with no keyboard, and every step of it that has to be retyped is
a step that gets skipped:

```bash
npm run phone:setup                             # once per device, and again after any pull (deps, tsx, the app)
npm run phone                                   # first run: converts, then serves
npm run phone                                   # every run after: servers up, here is the link
REBUILD=1 npm run phone                         # re-convert into the same folder
BAKE=0 OUT=./build/phone-plain npm run phone    # the other side of the collision A/B, in its own folder
TEXTURES=rgba8 OUT=./build/phone-rgba8 npm run phone     # the other side of the texture-format A/B
MODELS=0 npm run phone                          # skip the model convert (dispatch only — no physics)
DISTRICT=ganton OUT=./build/phone-ganton npm run phone   # another measurement district, in its own folder
RECT=8,-8,11,-5 OUT=./build/phone-ls npm run phone       # ground the district table does not name
```

**ASTC encoding is threaded, and its default is wrong for a phone.** `astc-encoder.js` starts one worker per
core; each is a V8 isolate reserving its own code range, and each inherits the convert's `--max-old-space-size`
setting. On the target device that ends the encode stage with `Fatal process out of memory: Failed to reserve
virtual memory for CodeRange`, printed once per worker that lost the race — after the whole district has
already been converted, which is the expensive half. The encode then died at `1` as well — and that was the clue, because at `1` no worker exists to blame. The
cause was not the cap but where it went: it reached the model dictionaries and never the WORLD arrays, whose
encoder was constructed with no options at all and kept the library's one-per-core default. Fixed 2026-08-09,
with `threads` made a required option so a third call site cannot inherit a default silently; the encode then
ran in 12.8 s. `HEAP=` remains as a knob because a small device can want it, and the convert line prints
textures, threads and heap together so a log answers this class of question without a screenshot.

**Give every pak its own REAL directory.** `OUT=` is a path, and on a phone it is routinely a symlink —
internal storage is small, so build output gets pointed at shared storage. On 2026-08-09 four names
(`phone`, `phone-ganton`, `phone-ls`, `phone-ls-rgba8`) all resolved to ONE folder, so every convert
overwrote the previous pak and the A/B that was meant to keep two apart kept one. The convert now prints the
resolved path when it differs, and a `REBUILD=1` removes the previous `pak/` first — a rebuild that starts
on top of the last one can inherit archives it never converted, which is how a district that reads 597
texture layers on one build came out with 49 on the next.

`npm run phone` therefore passes **`--astc-threads 1`**, which is the only setting that reserves no new
address space at all — measured 2026-08-09 by counting worker threads off `/proc/self/status`: `0` spawns one
per core, `2` spawns two, and `1` spawns **none**, running the encode on the main thread. Two was tried in the
field first and died the same way, which is what moved this from a guess to a measurement. The cost is speed
(astcenc's own pool is 2.38x one thread, bit-identical either way), and a convert that finishes slowly beats
one that dies at the last stage after the whole district is already converted. `ASTC_THREADS=0` restores
one-per-core for a machine that can afford it.
The thread count does not change the output bytes (pinned by a test), so it is a build-speed knob and never a
build difference.

**The DISTRICT is the rect.** `DISTRICT=` picks the pak rect, the game spawn and the map's opening point
together, from the one table the console reads (`apps/dispatch/src/world/districts.ts`; `npx tsx
scripts/district.ts` lists them). It defaults to **`los-santos-centre`, the district 201/1-01 pinned** — so
the default run produces a capture that belongs to the chain's before/after series, which the first real
mobile row did not. `RECT=`/`SPAWN=` still override for ground the table does not name.

Two consequences worth knowing before the first run after this change: an existing pak in `build/phone` was
converted for **Ganton**, so it no longer matches the default request and the recipe check will refuse to
serve it (naming both sides). Keep it with `mv build/phone build/phone-ganton` and reach it again with
`DISTRICT=ganton OUT=./build/phone-ganton npm run phone`, or convert the pinned district into a folder of its
own. Each district in its own folder is the arrangement the chain wants anyway — the two are compared, not
replaced.

Changing a knob needs a folder of its own (or `REBUILD=1`): a pak already in `OUT` is reused, and since it
records what it was built from, a request that does not match it is refused rather than silently served —
see [Build it once, then reuse it](#build-it-once-then-reuse-it--and-know-what-you-are-reusing).

It refuses to start if `game-src/original/data/gta.dat` is missing, and it never re-converts silently — a
phone convert is minutes to hours. The rest of this page is the same recipe by hand, and the reasons behind
each flag.

**If the device cannot run vite**, unpack the committed archive and the script serves the app as static files
instead of starting a dev server — same command, one origin, no vite:

```bash
mkdir -p build/webapp && tar -xzf prebuilt/opensa-webapp.tar.gz -C build/webapp
```

(`prebuilt/` also says how to refresh it — `npm run build -- --base=./`; the `--base` is what keeps the asset
paths working from a subfolder.) That is not hypothetical: on an Android 10 / arm64 phone the
rolldown binding dies with `Illegal instruction` before printing a line, and no wasm fallback is reachable
([edge-cases/browser-runtime.md](../edge-cases/browser-runtime.md)). Build with `--base=./` or the asset
paths will be absolute and 404 from a subfolder.

## Bake the collision too (200/3-01)

A phone's CPU makes every main-thread spike several times worse, and the largest named one is a COL parse per
cell. `--bake-collision` moves it into the converter:

```bash
npx tsx tools/opensa-pack/src/cli.ts --game … --out … --textures astc --max-texture 256 --bake-collision
# or, through the canonical build:
npx tsx tools/perfect-map-builder/src/cli.ts --game ./game-src/original --in ./mods-src --exclude sa --bake-collision
```

It is **off by default on purpose**: the runtime reads the bake when the pak carries one and parses COL when it
does not, so the same tree built twice — one flag apart — is the A/B this is judged on, and neither side needs
a code change. What to look for:

- the pack log: `collision: baked N cells (M triangles, K breakable regions) on the 256 game grid`;
- in the browser, on a cold district entry, `cell-collision-decode` in the frame's span breakdown where the
  COL path used to spend its milliseconds inside the `collision` block.

**Use the GAME, not `dispatch.html`.** The dispatch surface streams the world but runs no physics, so it never
asks for a cell's colliders — the baked path is simply not on its route.

## On a desktop

```bash
npx tsx tools/opensa-pack/src/cli.ts \
  --game ./game-src/original --out ./build/district \
  --textures astc --max-texture 256 --rect 8,-8,11,-5 --no-ao --no-models

npm run dev -- --host
# phone, same Wi-Fi — the map surface (no physics):
# http://<host-ip>:5173/dispatch.html?src=build/district&at=2495,-1687
# ...or the game itself, which is what exercises collision streaming:
# http://<host-ip>:5173/?loader=http-dir&src=http://<host-ip>:3001/build/district
```

`--rect` is inclusive GTA **cell** coordinates, cell = `floor(worldXY / 250)`. **Los Santos sits at negative
GTA y**: `8,-8,11,-5` is x 2000…3000, y −2000…−1250 (Ganton/Idlewood); the whole of LS is about `1,-10,11,-3`.

`--no-ao` skips the ambient-occlusion bake (much the slowest stage) and `--no-models` skips vehicles and peds,
which a dispatch map does not draw. Add them back when the area is proven.

## On the phone itself (Termux)

Viable because **the converter's only external runtime dependencies are `meshoptimizer` and
`astc-encoder.js`** — everything else it needs is in this repo, and nothing in the chain compiles native
code. `astc-encoder.js` is wasm rather than a native addon, which is exactly why it was the encoder chosen
for `--textures astc`: an arm64 phone runs it as-is (the same reason the dev server does NOT run here — see
rolldown below). The 59 devDependencies (nx, rolldown,
oxlint, lightningcss) are dev tooling the conversion never touches, and their prebuilt binaries are
`linux-x64-gnu`, which is why a full `npm install` is the step most likely to complain on an arm64 phone.

**Two commands, and the second one is the only one repeated:**

```bash
pkg install nodejs-lts git
git clone <your fork> && cd opensa

npm run phone:setup                  # once: deps, tsx, the prebuilt app, and what is still missing
npm run phone                        # every run: convert if needed → check the pak → serve → print the URL
```

`npm run phone:setup` (`scripts/phone-setup.sh`) is idempotent: each step checks whether it is already done,
so re-running it after a failed install, a pulled commit or a reboot costs seconds and repeats nothing. It
holds a `termux-wake-lock` when Termux offers one — Android suspends a long job the moment the screen goes
off, and a convert is minutes to hours. It **installs only**; converting is `npm run phone`'s business,
because that is the expensive half and it must not happen by surprise.

What it does, and the two things it deliberately does NOT do:

```bash
HUSKY=0 npm install --omit=dev       # 173 packages instead of 1171 — the dev toolchain is never used here
npm i tsx                            # the TS runner; it is a devDependency, so --omit=dev skipped it
```

- **`HUSKY=0` rather than `npm pkg delete scripts.prepare`.** Both get past the `prepare` hook, but deleting
  the script edits `package.json`, which leaves the worktree dirty on the one machine where `git status` is
  hardest to read — and that edit eventually gets committed. `HUSKY=0` is husky's own opt-out and touches
  nothing.
- **Not `--ignore-scripts`.** esbuild installs its platform binary from a `postinstall`, so silencing scripts
  trades one break for a worse one.

**Do NOT pass `--omit=optional`.** It looks right — the flaky prebuilt binaries (nx, rolldown, oxlint) are
optional deps — but npm already filters those by `os`/`cpu`, so an arm64 phone never fetches the `linux-x64`
ones anyway. What `--omit=optional` *would* skip is `@esbuild/android-arm64`, which is exactly the binary
`tsx` needs to run a single line of TypeScript.

And do not reach for `--ignore-scripts` to get past a husky failure: esbuild installs its platform binary
from a `postinstall`, so silencing scripts trades one break for a worse one. Since 2026-08-08 the hook does
not fail at all — `prepare` is `husky || true`, because `--omit=dev` PRUNES husky and npm then runs a
`prepare` whose command no longer exists (`husky: not found`, exit 127, and the install dies after having
already pruned `tsx`). `HUSKY=0` does not help: it quiets husky, it does not stop npm from calling it.

Put the game's `data/`, `models/` **and `anim/`** under `game-src/original/`. `anim/` is not optional the
moment peds are converted: without `anim/ped.ifp` the pack falls back to the BIND POSE and says so
(`peds: BIND POSE (no ped.ifp — feet level will be wrong)`), and the player then stands at the wrong height —
the rest pack fine, so the only symptom is a character that looks planted wrong.

`npm run phone` then converts the pinned district by default — the same convert by hand, when the point is to
change one flag:

```bash
npx tsx tools/opensa-pack/src/cli.ts \
  --game ./game-src/original --out ./build/district \
  --textures astc --max-texture 256 --rect 9,-7,10,-6 --no-ao --no-models
```

The ASTC encode adds a stage to the run. Budget for it: ~315 K texels/s on a 4-core x64 box at the default
MEDIUM preset ([benchmark](../benchmarks/opensa-engine/2026-08-07-headless-astc-preset-knee.json)), so the
21.4 M texels of a 2x2 district are ~90 s there and several times that on a phone. It is the one stage
`--textures rgba8` does not pay — which is the trade: build time now, or four times the texture memory for
the whole run.

Serve it and open the console, both on the phone:

```bash
cd build/district && python3 -m http.server 8080
# browser: http://localhost:8080/<the dispatch html>?src=/&at=2495,-1687
```

### What to expect to go wrong

- **`npm install`** — the arm64/bionic mismatch on dev-tool binaries. `--omit=dev` is the answer (what
  `npm run phone:setup` passes); the conversion path needs none of them. **Not `--omit=optional`** — see
  above, it skips the one binary `tsx` needs.
- **Memory.** The full-map scripts run with `--max-old-space-size=12288`. A 2x2-cell district needs far less,
  but no number has been measured on a phone — start small and grow.
- **Disk.** The PC game is ~4.7 GB before the pak.
- **`python3 -m http.server` ignores `Range:`**, so the pak is fetched whole rather than streamed by cell. Fine
  for a district, not for a city — the runtime detects it and falls back on purpose.

### The mobile game's files will not do

GTA:SA for Android stores textures in the OpenGL/PVR Texture Native layout (PVRTC/ETC). The parser handles
D3D8/D3D9 only and **skips what it does not understand rather than failing**, so those dictionaries produce a
world with missing textures rather than an error. The PC files are what the converter reads. See
[links.md](../links.md).

## The district lever: convert only what the rect places

`packMapObjects` walks **every model the IDEs name** — about 14 000 on the stock game — because for a
full-map build that is the working set. For a district it is not: a 2×2-cell rect places a few hundred, and
the rest are parsed, planned and written for a world the pak does not contain. On a phone that is the
difference between a convert in minutes and one in hours, and it was the single slowest stage.

`--map-objects-in-rect` converts only the models the `--rect` actually places (`npm run phone` passes it;
`MAPOBJ=0` turns it off). It needs an explicit rect — without one the convert auto-fits to every cell with
content, and "what this rect places" is the whole catalogue anyway.

The cut is safe in the direction that matters: **a model left unconverted keeps its `.dff`**, so the runtime
parses one rather than failing to find it — the same contract `--vehicles` / `--peds` already rely on. What
it does not keep is a converted texture, so an unconverted model still carries its ORIGINAL (BC) dictionary
and would fail on a device without BC. Nothing outside the rect is placed in a district pak, which is why
this is keyed on **placement** rather than on a name list somebody maintains.

Two second-order effects, both in the safe direction: more models stay unconverted, so more dictionaries are
kept (`planTxdDeletions` may only drop one nothing unconverted still needs — the rect test deliberately runs
*after* a model registers as a user of its TXD), and the archives shrink less. The pack log says how many
were left: `… ; N not placed in the rect, left unconverted`.

## Build it once, then reuse it — and know what you are reusing

A convert costs minutes to hours on a phone, so the pak is built once and reused for dozens of runs.
`npm run phone` already skips the convert whenever `<OUT>/pak/manifest.json` exists; what makes that **safe**
is that the pak can be asked what it is.

Every pak records the recipe it was built from into its own `report.json`, under `build`: the rect, the
texture format, `--max-texture`, `--bake-collision`, `--no-ao`, the vehicle/ped subsets, the claimed
platforms, the build time and the commit. The format is recorded as `textures` (`astc` / `bc` / `rgba8`)
because the older `rgba8` boolean cannot tell an ASTC build from a BC one — it reads FALSE for both — and
those are the two sides of an A/B. Read it back at any time:

```bash
npx tsx scripts/debug/pak-recipe.ts build/phone/pak
```

This exists because the failure it prevents is **silent**. The knobs above are read only on the convert
branch, so with a pak already in place `RECT=8,-8,11,-5 npm run phone` used to serve the OLD district and say
nothing — on screen or in the log. The collision A/B is the same trap with higher stakes: its two sides differ
by one flag and nothing else, and a run attributed to the wrong side is worse than no run. `npm run phone` now
compares the request against the pak before serving it and stops on a mismatch, naming both sides:

```
the pak in ./build/phone/pak is not the one being asked for:
  rect: pak has 9,-7,10,-6, asked for 8,-8,11,-5
```

Two ways forward, and the script prints both: re-convert into the same folder (`REBUILD=1 npm run phone`), or
keep both paks and serve the other from its own (`OUT=./build/phone-ls npm run phone`). **Keeping both is
usually right** — a second district is another convert, and the A/B needs its two folders side by side
anyway, which is what `BAKE=0 OUT=./build/phone-plain` is for.

A pak built before recipes were recorded has no `build` block. It says so and is still served — an existing
pak keeps working — but it cannot be verified, and a benchmark row may not cite it without one
([benchmarks](../benchmarks/readme.md) require the build a run read). `REBUILD=1` makes it self-describing.

## Why the phone needs no assets of its own

The pak is built once, wherever there is a copy of the game, and then **served**. The runtime asks for byte
ranges (`Range: bytes=…`) and pulls only the cells the camera needs, which is why a 770 MB pak opens on a
phone at all. Any HTTP server the phone can reach will do — a desktop on the same Wi-Fi, a static host, or
Termux on the phone itself.
