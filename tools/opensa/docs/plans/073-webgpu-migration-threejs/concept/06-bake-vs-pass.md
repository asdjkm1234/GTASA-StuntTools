# 06 — Decision: bake into format vs shade in material vs fullscreen pass

A fixed decision (not just discussion) for how each visual effect is realized under the WebGPU/TSL renderer. The
guiding rule is the physical one:

> A **material** shades one surface point — it has **no access** to neighbouring pixels, the whole frame, or the
> scene depth buffer. So anything that combines multiple screen pixels **must** be a post-scene pass. Anything
> that's a property of the surface can live in the material, and anything precomputable can be baked into the
> asset (our own `.cell` format) and just read.

## The three buckets

### A) Baked into the format — read in the TSL material (no runtime compute, no pass)

Precomputed per-vertex / per-texel channels our own format carries; the material samples them.

| Channel                          | Replaces                               | Notes                                                                      |
| -------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| **Ambient occlusion** (`skyVis`) | the screen-space **SSAO pass**         | biggest win — removes a whole fullscreen pass; cheaper and stable          |
| **Emissive mask**                | runtime luma-delta heuristic           | marks lit windows; also the source that **bloom** picks up                 |
| **Night vertex colours**         | —                                      | already baked (day/night prelit)                                           |
| **Static sun-shadow** (optional) | part of CSM on the **far static** ring | baked soft shadow for distant static geometry; dynamic near stays live CSM |

These are exactly the channels the parked modern-cell tooling already prototyped — if we return to that work, this
is where it plugs into the new renderer.

### B) Shaded per-surface in the TSL material (computed live, but in-material — not a pass)

Per-surface lighting/shading that varies with sun/time — computed in the world material's node graph:

- **Direct sun term** (N·L × sun colour)
- **CSM shadow sampling** (sample the cascade maps three renders — the _sampling_ is in-material)
- **Unified fog** (distance fog blended in-material — already how we do it)
- **Day/night balance**, **window/beam glow** (emissive drive)

### C) Stays a fullscreen TSL pass (screen-space — needs the whole rendered frame)

Physically cannot be a material; realized as WebGPU/TSL post passes after the scene:

| Effect            | Why it must be a pass                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **Bloom**         | blurs a neighbourhood of the rendered image                                                    |
| **God-rays**      | radial blur in screen space from the sun's screen position                                     |
| **Anti-aliasing** | edge detection on the final image — or replace with WebGPU **MSAA** (may remove the SMAA pass) |
| **Tone mapping**  | applied once as the final output step                                                          |

## Net effect on the port

Versus a 1:1 re-port of the WebGL `postprocessing` chain, this **shrinks the fullscreen-pass set**:

- **SSAO** → gone (bucket A, baked AO).
- **SMAA** → likely gone (bucket C, replaced by MSAA).
- Remaining passes: **bloom, god-rays, tone mapping** (+ MSAA in the renderer).

Fewer passes = less TSL post-FX to write and verify, less per-frame GPU cost, and it plays directly to the
own-format advantage (bake once, read cheaply).
