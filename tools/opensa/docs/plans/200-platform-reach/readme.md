# 200 — Platform reach: the world on a phone, and the frame off the main thread

**The lead chain of the cycle** (priority set 2026-08-04). Everything else in 0.5.0 makes the world richer;
this one makes it *reachable* — and pays for the richness by taking the hitches off the main thread.

The one-line problem: **a phone can boot the engine and cannot open the world.** `initDevice` stopped
demanding BC on 2026-08-04, so a Mali-G51 gets a device and renders `?demo=1` at 41 fps — and then the first
real world texture throws by name, because a pak built from SA assets is BC throughout and no mobile GPU has
BC. That is not a performance problem and not a browser problem. It is a **build-time content decision**
([restrictions/assets-and-data.md](../../restrictions/assets-and-data.md#a-worlds-texture-format-decides-which-gpus-can-display-it)),
and no runtime relaxation can undo it.

## The four decisions this chain is built on

Taken 2026-08-04 with the user, and every step below inherits them:

| Decision | What it rules in | What it rules out |
| --- | --- | --- |
| **Mobile reach first** | The phone is the target that orders the work | Desktop-only polish leads the cycle |
| **Universal textures** (Basis/KTX2 + transcode at load) | One pak, every GPU family | Per-target pak variants as the primary path |
| **WebGL2 fallback in scope** | A second backend, concept-gated, last | "WebGPU or nothing" as the permanent floor |
| **Boldness: workers + COOP/COEP + a pak-format break** | Moving heavy work off the main thread, changing `.ostex`/`.oscell` | Changing what a **mod author's** files must mean — that line stays where [project-goals](../../project-goals.md#the-line-we-do-not-cross) put it |

## The evidence this chain is answering

Every number below is already in the record; none of it is new work to find.

| What | Measured | Where |
| --- | --- | --- |
| Phone, synthetic world | 41 fps, 162 draws, 37 MB resident — Mali-G51, 360×800 @ DPR 2 | [benchmarks, mobile row](../../benchmarks/index.md#mobile) |
| Phone, real world | **impossible** — no BC; `--rgba8` costs 4–8× texture memory | [edge-cases/browser-runtime.md](../../edge-cases/browser-runtime.md#mobile-gpus-no-bc-so-no-sa-built-pak) |
| Desktop field drive, populated map | 1004 slow frames, p50 21.3 ms · **GPU pass mean 15.64 ms against a CPU render of 0.1–0.6 ms** | [091 populated drive](../../benchmarks/index.md) |
| Cold entry into a district | first frame `cell-collision-read` **235 ms**, then ~20 frames of 110–170 ms while cells stream 0 → 95 | 093 sweep |
| Named spike costs | COL parse **9.6–78.3 ms**, Rapier bodies **5.6–28.1 ms**, `.osm` parse worst **20.5 ms** per new type | [plan 091](../../plans/091-frame-time-attribution/readme.md) |
| Boot frame | **576.1 ms** | 091 |

Read together they say two things. On the desktop the engine is **GPU-bound in steady state and
main-thread-bound in transients** — the CPU render is a rounding error, so there is nothing to win in the
render loop and everything to win in what happens *beside* it. On a phone neither number has been taken yet,
because the content will not load. **So the order is: make the world loadable, then measure, then spend.**

## The chains, in execution order

| # | Chain | Why here | Gate |
| --- | --- | --- | --- |
| 1 | [Device truth](1-device-truth/readme.md) | Nothing may be optimised for a device we cannot measure. Also closes a restriction that is caught by **nothing** today | — |
| 2 | [Mobile texture formats (ASTC)](2-universal-textures/readme.md) | The single blocker between a phone and the real map | ungated since 2026-08-06 — the universal concept was replaced by a direct ASTC encode ([postmortem](../../postmortem/universal-texture-transcode.md)) |
| 3 | [Off the main thread](3-off-main-thread/readme.md) | The hitches are all one shape: heavy work in the frame. A phone's CPU makes each of them 3–5× worse | — |
| 4 | [Mobile runtime](4-mobile-runtime/readme.md) | Resolution, residency, fill, touch — the things that decide whether "it loads" becomes "it plays" | partly (see 4/01) |
| 5 | [WebGL2 fallback](5-webgl2-fallback/readme.md) | Real reach, real permanent cost. Last, and only if the concept survives | [concept](../../concepts/webgl2-fallback-backend.md) |

## Status

| Step | State |
| --- | --- |
| 1/01 the world's demand, read from the manifest | **SHIPPED 2026-08-04** — `ospakRequiredFeatures` + `requireWorldSupport` refuse a world before a cell streams, naming the world instead of one texture; the shell's gate stopped demanding BC, so a phone is no longer told its browser lacks WebGPU |
| 1/01 the build declares its platforms | **SHIPPED 2026-08-04** — `platformDemand` over the pak's arrays **∪** every model's `TEXS`; reported on every run (log + `report.json` `platforms`), enforced by `--platforms desktop\|mobile` |
| — the defect that gate found | **FIXED 2026-08-04** — `--rgba8` converted the WORLD only; a car is not in the pak, so every vehicle and ped stayed BC and a mobile district threw at the first spawn. Threaded to every class that ships its own dictionary |
| 1/02 mobile bench schema | **SHIPPED 2026-08-04** — a mobile row records the adapter's features **and** what it is missing (no `timestamp-query` ⇒ no `gpuMs` column at all), `featureLevel`, DPR, and the pak's platform field; mobile and desktop rows are declared non-comparable |
| 1/03 emulation gate + capture ritual | **SHIPPED 2026-08-04** — `device.test.ts` boots `initDevice` against a simulated mobile adapter whose `requestDevice` rejects an absent feature the way a browser does; **verified by reintroducing the defect** (2 of 6 fail). The capture ritual and the flag-is-not-reach rule are in [development/mobile-pak.md](../../development/mobile-pak.md) |
| 1/04 the device-derived budget | **INPUT HALF SHIPPED 2026-08-04** — `describeDevice` / `engine.deviceReport`, emitted as `[bench] device` once per sweep, so a capture carries the adapter facts a budget would have to be derived FROM. **The budget itself is NOT built**, deliberately: WebGPU exposes no VRAM, so any ceiling written before a device has been measured is a fitted constant with no residual. It waits on a phone |
| 3/01 bake collision into the pak | **PART SHIPPED 2026-08-04** — the `.oscol` container and the bake, with the runtime's own `toModelColliders` as the bake's test oracle; the pak entry kind and `--bake-collision` now write it. The 250-vs-256 grid trap is now a recorded restriction |
| 3/01 the runtime read | **SHIPPED 2026-08-05** — `PakCollisionSource` (same pak worker, `collision-` keys, de-duped reads) → `bakedModelColliders` → the adapter, which asks `has()` before it awaits so an unbaked cell keeps the COL path *synchronous* (the "no span here" rule depends on it). The whole loop — regions → bake → container → runtime read — is tested against `toModelColliders`, and a bake keyed on the wrong grid is now REFUSED at construction instead of felt in the field. **Not measured**: no field capture yet |
| 3/01 the breakable gate, baked | **SHIPPED 2026-08-05** — `.oscol` **v2** carries the per-placement instance keys, so the runtime stops parsing a DFF per model to ask what shatters (the last archive read the collision path had). Presence = breakable, absence = not, and a v1 file is REFUSED rather than read as unbreakable — a bake whose breakability is unknown must not ship a world where bins quietly stop smashing. Enforced by a test that counts archive reads on a baked cell (zero). What remains on the COL index is the procobj scatter, parked as a performance lever |
| 3/01 made testable | **SHIPPED 2026-08-05** — `perfect-map-builder --bake-collision` (off by default, so the same tree gives both sides of the A/B), the shatter gate memoized per model in the converter (the LRU is 512 clumps against a map of thousands — without it a full-map bake re-parses DFFs per cell), `scripts/debug/dump-cell-collision.ts` to read the bake out of the pak bytes, and a writer→runtime round-trip test that needs no game assets |
| 3/02 collider builds, budgeted | **SHIPPED 2026-08-04, UNMEASURED** — a worker cannot take this (Rapier's bodies live in the main thread's wasm heap), so the spike is sliced under a per-frame allowance instead, the way the texture upload was. A cell is not `loaded` until whole, and an abandoned build removes exactly what it created |
| 4/05 the shell's message when the adapter is refused | **SHIPPED 2026-08-05** — `probeWebGpu` answers `no-api` / `no-adapter` / `ok`, and the sorry screen says which. The old single message told a phone that HAS WebGPU that its browser lacks it; on the one device measured, the API is present and the driver blocklist refuses the adapter. The compatibility-adapter FALLBACK is deliberately not taken: the 08-04 record does not show it succeeding where the default fails, so it would be a guess dressed as reach |
| 4/06 the cache that silently is not there | **SHIPPED 2026-08-05** — `cacheStorageStatus()` reports availability AND the reason, the fetch loader logs it once before the first byte, and the preloader carries the standing note. A phone on a LAN IP re-downloads the whole game every visit and nothing said so — including in the captures, where the numbers then include a download nobody intended |
| 4/05 + 4/06 in a browser | **SHIPPED 2026-08-05** — `e2e/shell.spec.ts` simulates both phone states (no `caches` + insecure context; `requestAdapter` → null) and asserts what the shell says. Simulated deliberately: a dev machine is a secure context with an unblocked GPU, so these two states have no other way to be seen — and a silent state is the kind nobody notices has regressed |
| 2/01 `.ostex` carries ASTC 4x4 | **SHIPPED 2026-08-06** — format id, GPU feature (`texture-compression-astc`, so `requireWorldSupport` refuses an ASTC world on a device without it with no new code), `astc-4x4-unorm-srgb`, and the writer's duplicate block table removed. ASTC 4x4 shares BC's block, so no layout changed. Encoder chosen and tried: `astc-encoder.js` (wasm, runs in Termux too) — **1.00 B/texel, PSNR 49.3 dB, 115 ms per 128x128 at MEDIUM** |
| 2/02 the encode side | NEXT — `--textures=astc|bc|rgba8` in opensa-pack, encode cost on the pack's worker pool, and the two-paks-one-switch A/B |
| chain 5 | pending (waits on its concept) |
| chain 4, the rest | waits on a phone: 4/01–04 all spend a budget that has not been measured |

**Not yet measured, and owed:** every number in this plan so far is a build/CI fact. Nothing here has been
run on the phone, and the bundle's headline claim stays unproven until chain 2/05.

## The rules this bundle imposes on its own steps

Three, and they are the ones this project has already paid to learn:

- **Derive from what the device reports, never from a device table.** The standing rule against hardcoding a
  value for a named car applies verbatim to hardware: "Mali → 0.6 scale" is the same mistake as
  "comet → stiffer springs". A budget derives from `adapter.limits`, from the feature set, and from a
  measured pressure signal — because tomorrow the slot holds a different phone.
- **A capture states what it was configured with.** The mobile row already fails this: it carries no pak
  build (there was no pak). Every run this chain produces records adapter features, `featureLevel`, DPR,
  the pak's platform field, and the transcode target.
- **Two paks from the same tree with one switch flipped.** Plan 092 shipped without that run and its `pass`
  column is unreadable for it. The texture chain is *exactly* the same trap and must not repeat it.

## What lands outside this folder when a step ships

Named here so no step "forgets" the same-change rule:

- **A contract** (`docs/contracts/`) — the pak manifest's new platform/texture field is a name that carries
  behaviour, and a build that spells it wrong is silent by nature.
- **A restriction** (`docs/restrictions/`) — if 3/04 lands `crossOriginIsolated`, "the game may only be
  embedded where COOP/COEP can be set" becomes a structural rule, not a note.
- **An edge-case amendment** — `browser-runtime.md`'s "no BC, so no SA-built pak" section is *retired* by
  chain 2 and must be rewritten rather than left standing.
- **A restriction amendment** — `gpu-and-shaders.md` says the one perf knob is `?scale=` and there will be no
  quality ladder, because the 2026-07-21 ladder run found a ~2 ms resolution-independent floor. **That run
  was taken on an M3 Pro.** Chain 4/01 re-takes it on a phone; if the mobile floor is not
  resolution-independent, the restriction is amended in the same change — it is not violated quietly.
- **`docs/hacks/`** — the transcode chain will want at least one fitted quality knob. It gets a file.

## The five questions ([project-goals](../../project-goals.md#the-check-when-a-plan-is-written))

1. **Which authored data, read as the author meant it?** None of it changes meaning. Textures keep their
   authored pixels (the question the concept must answer is *how much of them survives a re-encode*), and
   collision keeps the COL's surface types through the bake — a baked collider that loses `SAND` or the
   surface id is a data regression however fast it loads.
2. **What does the original do, and why is that not our answer?** SA never had this problem: one platform,
   one texture format, one thread. There is nothing to port here — this is entirely "our engine, our
   formats", directive 2.
3. **What is better, and what says so?** Nothing is claimed until chain 1 can measure it. The bundle's
   headline claim — *the real map, on a phone* — is binary and field-verifiable.
4. **Cost per frame when the world is busy?** Per chain: transcode is off-frame (worker) with the upload
   staying on the applied ≤1.5 ms/frame drain; the worker moves must not add a frame of latency to the
   collider handover; the mobile budget is set by 1/04 before anything spends it.
5. **What contract does a mod author keep?** All of it. `.ostex` and `.oscell` are *our* formats — a break
   there costs a re-pack, not a mod rewrite. No mod-facing name, folder rule or data row changes in this
   bundle.

## Acceptance for the bundle

- A phone loads a **real district of the real map** (not `?demo=1`, not a synthetic city) and drives it, with
  a recorded field verdict and a benchmark row that names its adapter and its pak.
- The desktop shows **no regression** on the eight-scene sweep — the whole bundle is neutral-or-better there
  or it is not done.
- The 091 slow-frame census on a cold district entry loses its main-thread contributors: no
  `cell-collision-read` above the frame budget, no per-type `.osm` parse on a visible frame.
- A build that cannot run on a platform we ship to **fails the build**, not the first texture upload.
