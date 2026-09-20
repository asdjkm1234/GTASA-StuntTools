# Concepts

**Concepts we still have to verify.** A concept is an exploratory design doc for a large, not-yet-committed
direction: research + an honest go/no-go *before any code*. It is the second stage of the documentation
lifecycle (see [docs/README.md](../README.md)) — an [idea](../ideas/README.md) becomes a concept when we
start to seriously vet it.

> **Before writing one, check [`docs/restrictions/`](../restrictions/README.md).** It holds the rules a
> design has to satisfy — layer boundaries, format ceilings, engine splits, what is decided at build time and
> cannot be re-taken at runtime — and says for each whether a violation is caught or is SILENT. A doc that
> violates one is not ambitious; it is a doc that gets rewritten after the first build.

Every concept has exactly two exits:

```
concept  →  docs/plans/       — it survived the go/no-go, we build it (the research record MOVES into the plan)
         ↘  docs/postmortem/  — it died; we record WHY so we never re-run the same dead-end
```

So this folder holds only **live explorations**. A resolved concept never stays here: a validated one moves
its research record into its `docs/plans/<n>-…/` folder, and a killed one moves to
[docs/postmortem/](../postmortem/README.md).

## Live

- ~~universal-texture-transcode~~ — CLOSED 2026-08-06, replaced by a direct ASTC encode; the record is in [postmortem/universal-texture-transcode.md](../postmortem/universal-texture-transcode.md).
  device's format at load (Basis/KTX2), so a phone can open the real map. Direction decided 2026-08-04;
  the open question is whether the quality survives a second generation of loss on SA's DXT. Gate on
  [plan 200 chain 2](../plans/200-platform-reach/2-universal-textures/readme.md).
- **[go-backend](go-backend.md)** — Go for the dispatch backend, opened 2026-08-26. Recommendation up front:
  do not rewrite PCAD's working Node server (~4.1k lines, real users, and [202](../plans/202-pcad-dispatch/readme.md)
  says the dull half is behind us), and do not close the door either — the one shape that pays is the
  dispatcher's READ path as a greenfield service that validates the existing JWT and can be deleted. The
  throughput argument does not apply: ~37 position messages/s at 150 units. Graduates only on a measurement,
  a written event contract, and somebody willing to maintain a second toolchain on a phone.
- **[webgl2-fallback-backend](webgl2-fallback-backend.md)** — a second rendering backend for devices with no
  WebGPU adapter. In scope by decision; carries its own counter-case (the reach window is closing, the tax is
  permanent). Gate on
  [plan 200 chain 5](../plans/200-platform-reach/5-webgl2-fallback/readme.md).

## Graduated to plans

- **webgpu-migration** → [docs/plans/073-webgpu-migration-threejs/concept/](../plans/073-webgpu-migration-threejs/concept/README.md) —
  the research record of the three-WebGPU attempt (spikes, Babylon comparison, upstream issue draft, the full
  phase-1 chronology). The chain itself **FAILED on three.js's side**; see the
  [073 readme](../plans/073-webgpu-migration-threejs/readme.md) for the verdict.
- **opensa-engine** → [docs/plans/074-opensa-engine/00-concept.md](../plans/074-opensa-engine/00-concept.md) —
  the own-framework concept (own WebGPU renderer + native formats, 60 fps target), now the
  [074 chain](../plans/074-opensa-engine/readme.md).

## Died (moved to postmortem)

- **modern-cell tooling** → [docs/postmortem/modern-cell-tooling.md](../postmortem/modern-cell-tooling.md) —
  the modern-cell tooling experiment produced no measurable perf/quality gain (code parked on
  `backup/tooling-experiment`). It DID produce the diagnosis that the engine was CPU-bound on draw-call
  submission — the thread that led, through the failed webgpu-migration (073), to the own engine (074).
