# 5 — WebGL2 fallback: maximum reach, permanent tax

**Gate: [concepts/webgl2-fallback-backend.md](../../../concepts/webgl2-fallback-backend.md).** In scope
by decision (2026-08-04); last in the bundle, and the only chain here that may still be refused on its own
evidence.

## The concern, stated once

The engine's own contract says the opposite of this chain:

> Fails LOUDLY with a specific message — the prod app keeps the three-WebGL path for unsupported browsers;
> **the engine never soft-degrades.**
> — `packages/engine/src/core/device.ts`

And that three-WebGL path no longer exists: `three` was deleted in plan 074/13. So this is not "restore the
fallback", it is **write a second backend for our own engine and keep it correct forever** — a permanent tax
on every shader and every pipeline change, against a reach window that is closing on its own (Chrome on
Android has had WebGPU since 121, Safari since iOS 26).

That is the argument the concept has to answer with numbers. Recorded here so the chain carries its own
counter-case; the decision to include it stands.

## What the concept must settle before any step runs

1. **How much reach, actually?** Not "browsers without WebGPU" in the abstract — the share of *this project's*
   target devices, measured, that get a WebGL2 context and no WebGPU adapter. The 08-04 phone is the
   cautionary case: it looked WebGPU-incapable and was merely blocklisted.
2. **What is the shader strategy?** There is no in-browser WGSL→GLSL path we control. The realistic answer is
   a **build-time** cross-compile with a fixed WGSL subset, which means the subset becomes a rule every future
   shader obeys — including the ones that already sit at the limits (15 of 16 inter-stage locations on the
   rigid path; `sampleCount` 1 or 4 with A2C needing 4).
3. **What is allowed to be missing?** A fallback that must match the WebGPU path feature-for-feature is not a
   fallback, it is a rewrite. Name the subset up front: which passes, which lighting, which effects.
4. **What does it cost per change, forever?** The honest unit is "extra work per future rendering plan", and
   0.5.0 has a lot of those queued (weather, rain, city life).

## The steps, if it survives

- **01** The backend seam: what the engine calls that is device-agnostic, and where WebGPU-specific concepts
  (render bundles, bind groups, the resumable `writeTexture` drain) stop being expressible.
- **02** Build-time shader cross-compile + the WGSL subset rule, recorded in `docs/restrictions/` in the same
  change — a subset that lives only in a tool is one the next shader silently breaks.
- **03** The declared feature subset: what a compat run does not draw, and how the shell tells the player.
- **04** Texture path: chain 2's universal payload already transcodes per device, which is most of the work —
  a WebGL2 target picks S3TC/ETC/ASTC through the same selection.
- **05** A compat acceptance scene set + its own benchmark family, never compared to the WebGPU rows.

## Acceptance

- A named device that could not run OpenSA before runs it, with a field verdict.
- The subset is written down before it is implemented, and the shell is honest about it.
- No WebGPU-path regression — the fallback may cost the *project* time; it may not cost the primary path a
  millisecond.
