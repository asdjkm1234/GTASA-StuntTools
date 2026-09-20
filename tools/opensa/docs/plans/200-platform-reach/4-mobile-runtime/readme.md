# 4 — Mobile runtime: from "it loads" to "it plays"

Chain 2 makes the world loadable on a phone. This chain decides whether it is playable. It runs **after**
chain 1 has produced a measured budget, because everything here spends one.

The only phone data that exists: **41 fps, 162 draws, 37 MB resident, 38/144 cells** — a synthetic block city
at 360×800 CSS px, DPR 2, on a Mali-G51. The real map will be an order of magnitude more of everything.

## 01 — Resolution policy (and the restriction it must beat first)

> The one perf knob is `?scale=`. There is no quality tier ladder and there will not be one: the 2026-07-21
> ladder run proved a ~2 ms resolution-independent pass floor, so a tier below that buys nothing. A plan
> proposing quality presets has to beat that measurement first.
> — [restrictions/gpu-and-shaders.md](../../../restrictions/gpu-and-shaders.md#the-one-perf-knob-is-scale)

**That run was taken on an M3 Pro.** A 2 ms floor on a desktop GPU says nothing about a Mali-G51 rendering
720×1600, where the frame is fill-bound by construction. So this step's first act is to **re-take the ladder
on the phone**, and only then to design.

- If the mobile floor is *not* resolution-independent, the restriction is amended in the same change with
  the mobile measurement beside the desktop one. It is not violated quietly, and it is not deleted.
- The DPR cap is `dprCap = 2` today (`configureCanvas`). On a 360×800 phone that is 720×1600 — the single
  biggest fill lever available, and it must be derived from the budget rather than typed in.

## 02 — Streaming rings and residency against the measured ceiling

- Ring counts, LOD distances and fog cut derive from chain 1/04's ceiling and its pressure signal.
- The parked lever that becomes relevant here:
  [per-ring texture laziness](../../../performance/deferred-optimizations/per-ring-texture-laziness.md)
  — held in reserve on desktop because the win sat under the ~767 MB world-array floor. On a phone that floor
  *is* the problem, so re-price it.
- Fog is not cosmetic on this path: the engine culls a cell entirely past `fogCutDistance`, so the fog
  distance and the ring budget are the same decision made twice.

## 03 — Fill rate: the parked foliage lever, re-priced

[Foliage fill](../../../performance/deferred-optimizations/foliage-fill.md) is *parked by decision* on
desktop — the 07-21 case was 13.72 → 7.63 ms, and 73 % of it traced to a single placement-only mod that was
deleted instead. The finding underneath is what matters here: **the cost is per-pixel, not per-triangle** —
triangles fell 18 % while the pass fell 44 %, and draw counts did not move at all.

A phone is a fill-rate machine with a fraction of the desktop's. Re-price the lever there; the desktop
verdict does not transfer, and neither does the desktop's reason for parking it.

## 04 — Touch, and a UI that fits 360 CSS px

- The controls exist ([`docs/features/mobile-controls.md`](../../../features/mobile-controls.md)); what
  they have never had is a frame-time row on a real device with a real world behind them.
- The shell, the HUD and the debug chrome are desktop-shaped. What survives on a phone, what collapses, and
  what is simply off.

## 05 — Getting an adapter at all

The 08-04 device returned a **null adapter** by default and only produced one after `#enable-unsafe-webgpu`
and a browser restart — the **blocklist**, not the Vulkan path, since `featureLevel: 'compatibility'` also
produced an adapter. Chromium's Android 12+ rule turned out to be about the default, not a hard ceiling.

- Support the compatibility adapter path explicitly, and know what its reduced limits cost us (the 08-04
  device reported `core-features-and-limits`, so core limits applied — do not assume that everywhere).
  **Still open, deliberately**: the 08-04 record does not say a compatibility ask succeeds where the default
  fails — both were taken behind the same enabled flag — so a fallback ask would be a guess dressed as reach.
  It waits for a device that refuses the default request and answers the compatibility one.
- **DONE 2026-08-05 — the shell says which of the two it is.** `probeWebGpu` reports `no-api` / `no-adapter`
  / `ok` instead of a boolean, and the sorry screen picks the message from it. "This browser does not support
  WebGPU" was FALSE on the one device we have measured: a Mali-G51 on Chromium 148 has WebGPU and is refused
  an ADAPTER by the driver blocklist, and telling that reader to install a recent Chrome is both wrong and
  unactionable. A thrown request counts as a refused adapter — the API answered, so it exists.

## 06 — Secure context, or the phone re-downloads the world every visit

Over plain `http://` — which is exactly how a phone reaches a dev machine on a LAN IP — `caches` is
undefined and **every cache operation silently no-ops**. Nothing breaks; the assets just download again.
Either the phone path is served over https, or the shell says the cache is off.

**DONE 2026-08-05 — the shell says it.** `cacheStorageStatus()` (loaders) reports availability *and the
reason*, the fetch loader logs one line before the first byte, and the preloader carries a standing note
under the rotating status: *"This download will not be kept — …"*. The reason discriminates on
`isSecureContext`, because "serve it over https" is the wrong instruction for a secure context that simply
has no Cache Storage API. Only the `fetch` loader says it — a picked folder and a served dir are read where
they are and never wanted a cache.

What this does NOT do is make the phone path secure. It makes the cost visible at the moment it is paid,
which is the difference between a measurement that includes an unintended download and one that says so.

## Acceptance

- A recorded field verdict from someone **driving on a phone**, not a bench number.
- A frame-time row with its adapter, DPR, viewport, pak and platform field — the row the 08-04 capture could
  not produce.
- Every knob this chain adds traces to a measurement or to `adapter.limits`. No device table.
