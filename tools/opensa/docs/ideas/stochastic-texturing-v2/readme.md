# Stochastic texturing v2 — turn the dormant de-tiler on for good

**Status: IDEA, unscheduled (2026-08-17).** The feature EXISTS: plan
[074·12](../../plans/074-opensa-engine/12-stochastic-texturing.md) shipped the skygfx-style 3-tap
tiling-and-blend end to end (converter list → layer bit 15 → WGSL `stochasticTexel`) and it sits
**default OFF** (`Environment.stochastic = 0`, `?stoch=1` A/B) after two field rounds killed it. This doc is
what it would take to switch it on and leave it on — written now because session 17 read the reference
implementation down to its compiled shaders and found the install RUNS it on 306 textures, which gives us
the one thing the July rounds never had: a ground-truth render of the same asset, on the same install, that
the user already lives with.

Nothing about this is in `docs/postmortem/`: the July history is a plan ledger, not a death — the direction
was parked (`docs/improvements/stochastic-texturing.md`, WebGL era) and then shipped-but-disabled. Plan 073
never touched it. Read the 074·12 ledger before this doc; nothing there is repeated except the verdicts.

## Where it stands, in two verdicts

| round (2026-07-12) | what broke | what it says |
| --- | --- | --- |
| 3 — the skygfx texdb merged in | sidewalk grass strips scrambled to random patches, pavement oil stains ghost-smeared, beach dot-grid + steep-face UVs striped | tiling-and-blend is honest only on **uniform noise**; STRUCTURED content is destroyed by construction (features jump per lattice cell). List trimmed to grass/dirt/gravel (30 names) |
| 4 — the curated list alone | street-level grazing views smear high-contrast listed textures into **dashes** along the anisotropic footprint (bridge-road screen) | even the honest set fails at grazing angles → default OFF |

Both were judged against nothing: no reference render existed for "what should this look like".

## What is new since July (session 17)

- **The reference install runs the same algorithm on the same textures.** The JuniorDjjr fork's
  `StochasticSamplerPS.hlsl` is byte-for-byte the math our `stochasticTexel` ports (skew `3.464`, `hash2D2D`,
  barycentric 3-tap, explicit `ddx/ddy`, `×1.2` UV pre-scale in the callers), it is ON in the bottle
  (`stochasticTexturing=1`), and its list is the 306 `stochastic=1` names of `models/texdb.txt` — INCLUDING
  structured content (metals, wood, plaster) that our round 3 rejected. The user has flown that install for
  weeks; the fork's look on those textures is field-accepted by default. Facts in
  [`gta-sa-original/skygfx-fork-building-pipe.md`](../../gta-sa-original/skygfx-fork-building-pipe.md).
- **So the July failures are not the algorithm's — they are the difference between two renderers of the
  same algorithm.** That difference is measurable and short: (1) the fork samples through SA's D3D9 sampler
  state; **our world sampler declares no anisotropy at all** (`grep anisotrop packages/engine/src` → nothing)
  — at grazing angles an isotropic mip footprint is already a smear along one axis, and three hashed taps of a
  smear are the "dashes" round 4 saw. (2) The fork's PS multiplies by the vertex colour and nothing else;
  ours composes with baked AO/skyVis, prelit and the sun — a wash in the blend bands is more visible under
  our lighting. (3) The fork also de-tiles its DETAIL layer (`simpleDetailStochasticPS`); we have no detail
  maps, so a texture that reads fine there because its detail layer carries the high frequency may read
  flat here. Each of these is one A/B, and the bottle is the reference.
- **The instrument exists**: `scripts/debug/model-lab.ts` + `img-patch.ts` swap one model into the built
  `sa` tree in seconds, and the headless harness shoots our engine at a chosen spot — a same-texture,
  same-camera pair (fork vs ours) is an afternoon, not a plan.

## What v2 would build

### 1. Measure before touching the shader — the reference pair

Pick three spots the July screens already named (an LS lawn, the bridge road at street level, the beach),
shoot each in the bottle with `stochasticTexturing=1` / `=0` and in our engine with `?stoch=1` / `=0`, same
camera. Score the pairs two ways: **eye** (his), and a **tile-repeat autocorrelation** of the ground region
(does the period peak vanish equally in both) plus a **contrast ratio** in the blend bands (fork vs ours).
This decides whether v2 is a sampler fix, a lighting-composition fix, or a method change — nothing below is
started before this table exists.

### 2. The sampler (probable first fix, cheapest)

An anisotropic world sampler (`maxAnisotropy` 8–16, measured — SA's own state at the fork's draw is what
to match) is a one-line change with a bench row. If the grazing dashes go, round 4 was never about the
method. Gate: the ≤ +0.5 ms GPU p95 of 074·12 still holds (aniso is per-tap, ×3 on flagged pixels only).

### 3. Contrast preservation without a LUT (Mikkelsen 2022, hex tiling)

The modern answer to round 3's "washed / greyed blend bands" that does NOT need per-texture Gaussianization
or extra textures: **hex-tiling with variance-preserving weights** — blend weights `w_i` are sharpened by an
exponent (`w^k`, k≈3–7, a shader knob) and renormalised, and the result is contrast-corrected in a
decorrelated colour space so the mean AND variance of the input survive. Three taps, works on compressed
textures, ships in Unity HDRP. It fits our shape exactly: the flag stays per vertex (bit 15), the knobs are
UBO scalars (**shader-owned — a look parameter tuned per field round may not be baked**,
`restrictions/build-vs-runtime.md`), the sampler stays `textureSampleGrad` in uniform control flow
(`restrictions/gpu-and-shaders.md`). It does not fix feature scrambling — nothing in this family does — so
selection (below) still decides what is on the list.

### 4. Histogram-preserving (Heitz–Neyret 2018) as a converter STAGE — only if 3 is not enough

The 074·12 "later" task: Gaussianize each flagged texture **per mip level** offline, store the inverse
histogram as a 256×1 LUT per channel per texture (a LUT row in a small array texture; format bucket already
allows arbitrary layer payloads), sample the 3 taps in Gaussian space, blend with variance-preserving
weights, LUT back. Highest quality on the widest set; cost = one converter stage, one extra bind, one tap.
Kept as the escalation, not the start — the fork ships without it and is accepted.

### 5. Selection: derive from pixels, gate by list

The July list is names. `restrictions/assets-and-data.md` says a curated list may **gate** a derived rule
and never **carry** it — and every slot is a mod target: a mod that replaces `grass` with a painted-lines
texture must not be scrambled because of its NAME. So the converter classifies each candidate texture from
its own texels — **periodicity** (autocorrelation peak strength × the observed UV span from
`stochastic-candidates.ts`) says "it tiles visibly", and a **structure score** (gradient-orientation
anisotropy, feature entropy, presence of long straight edges) says "it is uniform noise, not a design" —
and only a texture that passes BOTH is flagged; `data/stochastic.txt` becomes an override in either
direction (force on / force off) with the reason on the line. The skygfx texdb stays a reference input, and
its 306 names get scored the same way — the analyzer's disagreement with the fork's list is the first thing
to read. **A generated list says it is generated and how to regenerate it** (same restriction).

### 6. Default-on criteria (the acceptance the plan would carry)

Macro-repetition gone on ground planes at the aerial camera; no seam / mip artefacts up close; **the
grazing-angle spot added to the field checklist** and clean; no structured texture scrambled in three
districts; ≤ +0.5 ms GPU p95 at 2× retina; the reference pair within eye-tolerance of the fork's look — or
better, and DEMONSTRATED (`project-goals.md`: better is measured or field-accepted, never assumed).

## Restrictions this design already satisfies (checked 2026-08-17)

- WGSL: grads at the top, `textureSampleGrad` on every path, flag through the layer u16 (not a flat varying
  that switches whole triangles beyond what the data means) — the v1 shape stays.
- Build vs runtime: the FLAG is baked (an anchor); every look knob (weight exponent, contrast, aniso, the
  toggle) is shader/UBO — no re-pack per iteration.
- Curated list gates, texels decide; a name is never a correction.
- Assets: texture sizes stay asset-driven; the LUT (if 4 is taken) derives its rows from the texture, never
  from a fixed slot.
- The one perf knob stays `?scale=`; this feature has its own gate, not a tier.

## Open questions

- Is SA's D3D9 sampler at the fork's building draw anisotropic at all (the fork sets none itself)? If not,
  the grazing difference is elsewhere — the reference pair answers it before we guess.
- The fork's `×1.2` UV pre-scale: cosmetic period tweak or a fix for a seam class? Ours copies it; measure
  with it off once.
- Round 4's "high-contrast listed textures" — was the contrast wash the eye's real complaint, i.e. does 3
  alone retire it, or is 4 unavoidable for that set?
- Does de-tiling belong on the LOD cells too, or does the far field's mip convergence already hide the
  period (074·12 said the deep mips converge to the mean — that is the method's own far-field answer)?

## Dead ends already ruled out — do not re-derive

- Runtime UV-span gating as the selector (heavy tiling is the SA norm: 649 of 1 527 geometries span 4–8) —
  `docs/improvements/stochastic-texturing.md`.
- Per-material shader swaps the way the fork does it — our batcher merges layers; the flag rides the vertex.
- Merging the fork's full texdb as the default list — round 3.

## Links

074·12 plan · `docs/improvements/stochastic-texturing.md` · `gta-sa-original/skygfx-fork-building-pipe.md` ·
Heitz & Neyret 2018 "High-Performance By-Example Noise using a Histogram-Preserving Blending Operator" ·
Burley 2019 "On Histogram-Preserving Blending for Randomized Texture Tiling" (JCGT) · Mikkelsen 2022
"Practical Real-Time Hex-Tiling" (JCGT) · <https://github.com/JuniorDjjr/skygfx>
