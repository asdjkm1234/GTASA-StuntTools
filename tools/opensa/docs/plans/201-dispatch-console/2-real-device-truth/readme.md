# 201/2 — Real device truth: the trimmed console, a real district, real hardware

Second rather than first, and deliberately so. Dropping bytes that are never read needs no device to justify
it — but the **tuning** half of the profile (rings, resolution, residency) may not aim at a device nobody has
measured, and the first real mobile row in this repo should be a row of *the thing we intend to ship*.

The stakes beyond this chain: [200/1-04](../../200-platform-reach/1-device-truth/readme.md) refused to write
a residency ceiling because WebGPU exposes no VRAM and a number invented before a device is measured is a
fitted constant with no residual. This chain is what unblocks it.

## Steps

### 01 — A phone-sized district pak

Built with the [chain-1 profile](../1-the-map-profile/readme.md) and `opensa-pack --rgba8` (which converts
the model dictionaries too, since 2026-08-04 — a car is not in the pak), over the **district pinned in
[1/01](../1-the-map-profile/readme.md)** — not a fresh one, or the before/after stops being an A/B. Record the exact
invocation, and what `--platforms mobile` reports
(`tools/opensa-pack/src/platforms.ts`, `docs/development/mobile-pak.md`).

**Owes:** bytes and cell count, **profiled against unprofiled**, so chain 1's claim is visible on the artifact
that actually ships. Record which pak build every later run reads (standing rule).

### 02 — Serve it from the shareable build

The console inlines to a single file **for `?demo=1` only**. The pak worker is emitted as a separate
`assets/pak-worker-*.js` chunk which `?demo=1` never constructs, so the gap stayed invisible until a real pak
was streamed on a phone and the console 404'd on the worker with the manifest already fetched
([features/dispatch-console.md](../../../features/dispatch-console.md#verification)).

Close it: a real `?src=` must stream from the built artifact, at the path the bundle's own code names.

**Owes:** the console streaming a real pak out of the built artifact, and a note in the feature doc replacing
the known-gap paragraph.

**DONE 2026-08-27, and the artifact is reproducible now — which was half the defect.** There was no
single-file BUILD in this repo: the shareable console had been made by hand, so the thing that broke was
also the thing nobody could rebuild or fix. `npm run build:share:dispatch`
(`apps/dispatch/vite.share.config.ts`) emits **one `dist-share/dispatch.html`, 655 kB raw / 217 kB gzip**,
and it streams a real `?src=`.

**The seam is the fix, not the inlining.** `setupStreaming` takes a `StreamingHost` whose `createWorker` the
host may supply; absent, the engine builds the worker from a module-relative URL exactly as before, so every
ordinary build is unchanged (the multi-file dispatch chunk moves **135.85 → 136.06 kB**, +215 B, and
`assets/pak-worker-*.js` stays a 31.3 kB chunk beside it). The share entry `src/share.tsx` is the one host
that carries the worker inside itself (`?worker&inline`) and hands the constructor over. It is still a
worker — pak bytes still never touch the main thread — it is just carried rather than fetched.

**Two guards, because the failure was silent for months in two different ways.** The build refuses to emit
an artifact whose MARKUP points at anything beside it, and — after the beside-the-entry worker module is
aliased out of this build entirely — it refuses one whose CODE names any chunk it does not carry. That
second guard is the one that matters: a worker is not loaded by a tag, so an artifact can look perfectly
self-contained and still fetch a file that is not there. **Verified in both directions**: with
`?worker&inline` the build emits one file; with it removed the build FAILS by name
(*"share build would FETCH 'assets/pak-worker-*.js' … Inline it at its import"*).

**Not verified here, and stated rather than implied:** the artifact was not opened against a real pak in
this container — headless Chromium here exposes no `navigator.gpu` (probed: `--enable-unsafe-swiftshader`,
`--use-webgpu-adapter=swiftshader`, `--headless=new`; all report no WebGPU), so the 3D boot cannot run and
would fall back to plan mode, which streams no pak at all. What is proven is what a build can prove: the
file fetches nothing beside itself and carries the worker's code. **The field half rides with
[2/03](#03--the-field-run)**, on the device that has both a GPU and a pak.

### 03 — The field run

A real phone, the 01 district, panned and zoomed the way an operator does — not a static frame, and not a
synthetic city. This is the run the whole chain exists to produce.

**Owes:** a row in `docs/benchmarks/` under the **mobile schema**
([200/1-02](../../200-platform-reach/1-device-truth/readme.md)) — adapter features *and what is missing*, no
`gpuMs` column when there is no `timestamp-query`, `featureLevel`, DPR, CSS px, and the pak's platform field.
Numbers: fps p50 **and p95** (the synthetic row has no p95, so it cannot see a hitch), cells visible/total,
draws, resident MB, and the cold-entry cost the desktop measures at 235 ms.

Record the row **before** analysing it (standing rule), and state plainly that mobile and desktop rows are
not comparable.

### 04 — The residency ceiling, derived

Not written — **derived from 03**. The rule the ceiling has to satisfy: it comes from what the device did,
not from a per-device table, and it says what it was measured over.

**Owes:** the ceiling, and it is handed back to
[200/1-04](../../200-platform-reach/1-device-truth/readme.md) with the row it came from.

## Verification

- The row exists, in the mobile schema, and names the pak build it read.
- A second run on the same device reproduces the band; a single capture is not a measurement.
- The claim "a real district, driven on a real phone" is either true with a row behind it or is not made.
