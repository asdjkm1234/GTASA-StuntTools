# 2 — Mobile texture formats: ASTC in the converter

**Direction changed 2026-08-06 (user decision): a DIRECT ASTC encode, not Basis/KTX2 + transcode.** The
universal concept is closed and recorded in
[postmortem/universal-texture-transcode.md](../../../postmortem/universal-texture-transcode.md) — it was not
measured away, it was decided away: one generation of loss instead of two, a target device that carries ASTC
natively, and nothing added to the pak worker at all. The price accepted is that one pak no longer serves
every GPU (desktop keeps BC, a phone gets ASTC).

**The encoder is chosen and tried**: `astc-encoder.js` (wasm bindings of ARM's astc-encoder, no native
binary — which is what lets it run in Termux on the phone as well as on a desktop). First measurement,
2026-08-06: ASTC 4x4 at MEDIUM costs **1.00 B/texel**, reached **PSNR 49.3 dB** (RGB 48.0, alpha 58.7) on a
synthetic with a hard alpha edge, 115 ms for 128x128 on one thread
([benchmark](../../../benchmarks/opensa-engine/2026-08-06-headless-astc-encoder-trial.json)). The package
also ships `computeErrorMetrics`, so the quality floor below is evaluated with the encoder's own metric
rather than one we wrote.

**Landed already**: `.ostex` carries the format (`OstexFormat.ASTC4x4`, minor 2), it demands
`texture-compression-astc` through the existing `OSTEX_FORMAT_FEATURE` map — so `requireWorldSupport` refuses
an ASTC world on a device without ASTC before a cell streams, with no new code — and `ostex-upload` maps it
to `astc-4x4-unorm-srgb`. Nothing else in the layout changed, because ASTC 4x4 shares BC's 4x4 block; the
writer's duplicate copy of the block table was removed in the same change (`ostexTightRowBytes`), since that
copy is exactly what a new format breaks.

## What it is worth, in bytes (measurable today)

`scripts/debug/texture-budget.ts` reads a pak's manifest and computes what its arrays cost the GPU — the
decoded pyramid, via the same `ostexLayerBytes` the runtime allocates against — plus what the SAME content
would cost in another format. That last column is this chain's whole case, and it does not need a phone or a
transcoder to be read:

| | per texel (mips included) |
| --- | --- |
| BC1 — what SA ships, desktop-only | 0.5 B |
| ASTC 4×4 / ETC2 RGBA8 / BC3 | 1 B |
| **RGBA8 — what a no-BC device gets today** | **4 B** |

So `--rgba8` is not "a bit heavier": it is **4× a BC3 payload and 8× BC1**, on every texture the world draws,
which is why a phone today buys a district with `--max-texture 256` and cannot buy the map at any cap. An
ASTC encode brings the mobile cost back to the desktop's.

**Confirmed on real content, 2026-08-06** — the user's own district pak, measured on the phone
([benchmark](../../../benchmarks/opensa-engine/2026-08-06-headless-district-texture-budget.json)): 21.4 M
texels over 663 layers cost **115.4 MB** resident as built (RGBA8), against **13.6 MB** in BC1 and
**27.2 MB** in ASTC 4×4. That is 8.5× and 4.2× on SA's own textures, so the multipliers above are the
content's, not the theory's. Extrapolating the recorded ~767 MB full-map texture floor by the same ratios:
roughly **6.5 GB in RGBA8, ~1.5 GB in ASTC** — which is the difference between "no" and "a decision".

## What makes this cheap, and what makes it expensive

Cheap: **`.ostex` is already the right shape.** One `texture2d_array`, every layer the same W×H×format, full
mip chain baked offline, premultiplied, 256-byte-aligned rows so `queue.writeTexture` consumes the payload
verbatim. Models use the same container (`tools/opensa-pack/src/model-ostex.ts` — "no new format was
needed"), so **one format change covers the world, the vehicles and the peds.** If a transcode stage outputs
that same aligned layout, then `beginOstexUpload`, the resumable upload drain, the alpha classification, the
render bundles and every shader are untouched.

Expensive: SA ships **DXT**, so a universal encode is a second generation of loss on the world's textures.
That is the concept's whole question. (Models are already re-encoded today — `model-ostex.ts` runs
`encodeDxt` over the dictionary — so for vehicles and peds this is not a new class of loss.)

## 01 — `.ostex` carries ASTC — **DONE 2026-08-06**

No major break was needed, which is the whole point of the cheaper design: a new format ID, its GPU feature,
its block size, its GPU format. Tested: it demands the ASTC feature and never the BC one, it costs exactly
what BC3 costs and a quarter of RGBA8, and it round-trips through the container.

Still open here: **other ASTC block sizes**. Only 4x4 is in, because 4x4 is BC's block and therefore free;
8x8 (0.25 B/texel, the quality/size lever a phone may well want) needs `ostexMipLayout` to stop assuming a
4x4 block — the tests say so rather than the layout silently producing wrong rows.

## 02 — The encode side (`opensa-pack`) — **CODE DONE 2026-08-07, the A/B still owed**

`opensa-pack --textures astc|bc|rgba8` (`--rgba8` is kept as the older spelling; the two are refused when
they DISAGREE rather than silently ranked). `bc` stays the default and keeps the DXT passthrough
byte-for-byte — the desktop-quality reference and the A/B partner.

**The encode is a pass over a FINISHED `.ostex`, not a change to the planner** (`astc-encode.ts`), and that
one decision is what kept the diff small:

- The alpha pipeline is untouched by construction. Premultiply, dilate, classify, `cutoutRef` and the mip
  chain have all already run when the encoder sees the bytes, so an ASTC build is exactly an `--rgba8` build
  with one more stage — there is no ordering left to get wrong, and the 1 422 cutout layers cannot move.
- **One transform covers every producer.** The world's arrays and every model dictionary end up in the same
  container, so the world half hooks into `convertDistrict`'s array loop and the models' half is one pass
  over the bundles (`ModelBundles.retexture`) — vehicles, peds, clutter, anim objects and map objects all
  come along without their writers knowing the format changed. It runs BEFORE `platformDemand` reads the
  formats, so the build's platform line reports what the archives will actually carry.
- The two switches are tied together in ONE place (`packGameDir`: `forceRgba8 = textures !== 'bc'`), because
  the encoder needs decoded layers. A BC payload reaching the encoder is refused rather than re-encoded — it
  would mean the wiring came apart, and re-encoding it would be a second generation of loss nobody asked for.
- The mip chain is **truncated**, not reinterpreted: RGBA8 mips run to 1x1 and ASTC's stop at the 4x4 block.
- The `.ostex` `format` byte AND the pak manifest's entry meta are both rewritten; `texture-budget.ts` and
  the runtime's feature check read the manifest, and one that still said RGBA8 would describe a pak that no
  longer exists.

Settings, measured rather than assumed
([benchmark](../../../benchmarks/opensa-engine/2026-08-07-headless-astc-preset-knee.json)): **MEDIUM** is the
knee (+3.07 dB over FAST for 1.35x the time; THOROUGH adds 0.30 dB for 1.41x again) and **astcenc's own
thread pool** is worth taking (2.38x one thread on 4 cores, bit-identical output). Both are the encoder's
defaults. Profile is `LDR_SRGB` because the upload format is `astc-4x4-unorm-srgb`, and `USE_APLHA_WEIGHT`
is deliberately OFF — it weights RGB error by alpha, which is right for straight alpha and wrong for a
premultiplied payload.

Encode cost, extrapolated from the same trial: ~315 K texels/s on 4 cores at MEDIUM, so the 21.4 M texels of
the 08-06 district are ~90 s on that box. On the phone it will be several times that — measured, not guessed,
is the point of the run below.

**Still owed here — the run this chain owes:** two paks from the same tree with only `--textures` flipped
(`astc` vs `bc`), on real game assets. This container has none, so it belongs on the machine that has them.
Plan 092 shipped without its equivalent and its `pass` column is unreadable for it; this chain does not
repeat that. What the A/B has to produce: the texture budget of both paks, the encode's wall time as a share
of the convert, and the field's own verdict on the desktop pak's look.

**Also still open:** the encode runs on the pack's main thread, one array at a time. The pack has a worker
pool and this stage is embarrassingly parallel per layer — the moment the A/B says the encode is a real
share of a district's build, that is the first thing to pull.

## 03 — ~~The transcode side (worker)~~ — DROPPED with the universal direction

There is no runtime transcode any more: an ASTC payload uploads verbatim exactly as a BC one does, so the
upload path, its ≤1.5 ms/frame drain and every render bundle are untouched. This is the largest single saving
of the change — the worker gains nothing to do and nothing to starve.

What replaces it is a BUILD-side question: which target a build is for. `--platforms mobile` already fails a
pack whose content a phone cannot display, and it reads `OSTEX_FORMAT_FEATURE`, so it covers ASTC the day the
encoder writes it.

## 04 — Models, and the single-mip decision

`model-ostex.ts` writes a **single level** — no mips. On a phone that is a texture-cache and aliasing
decision, not just a size one, and vehicles are the assets a player looks at from a metre away.

- Re-price mips for model dictionaries on the mobile target.
- Cross-check the parked lever: [one texture array per vehicle, at its largest texture's
  size](../../../performance/applied/vehicle-texture-array-buckets.md) — 220 → 34 MB by
  buckets, ~24 → 3.5 MB VRAM per type. On a phone that lever is likely to stop being optional; if this chain
  pulls it, it moves to `performance/applied/` with its before/after.

## 05 — The map on a phone

The end of the chain and the bundle's headline: a **real district** of the real map, universal-encoded,
loaded and driven on the Mali row's device.

- The benchmarks index already names this debt: the mobile first-light row "is owed a successor on a real
  `--rgba8` district". This step pays it with a universal pak instead.
- **Same change:** rewrite `browser-runtime.md`'s "Mobile GPUs: no BC, so no SA-built pak" section — it
  describes a limitation this chain removes, and `edge-cases/` holds current limitations only.

## Acceptance

- One pak, produced once, loads on a BC desktop and a no-BC phone.
- Desktop quality: no visible regression at the field's own judgement, with the concept's PSNR/SSIM floor met
  on the full texture set.
- Desktop performance: the eight-scene sweep neutral-or-better against a same-tree `--textures=bc` pak.
- Phone: a district loads, drives, and produces a benchmark row that names its adapter, its DPR and its pak.
