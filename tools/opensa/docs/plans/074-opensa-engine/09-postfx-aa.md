# 074·09 — Post-FX & anti-aliasing

[← chain](readme.md) · prev: [08 dynamics](08-dynamics.md) · next: [10 integration](10-integration-flip.md)

> **PRIORITIZED 2026-07-15 (user): completing this plan is the next engineering block after the
> map-optimizer normals batch.** The "graphics transfer" audit (prod ACES + SSAO + tonemapping + modern
> pipeline vs 074) found the remaining real gap is HERE: ACES + bloom. **Look-verdict gate: no field
> judgments on plan 16 (vehicle paint), plan 17 (map lighting) or the concept/hd-realtime-lod-baked
> decision until ACES+bloom ship** — the prod look is calibrated against ACES, so every constant tuned
> against today's linear→sRGB output is suspect (the B5r "check the structure exists first" lesson).
> Expected one-time cost after landing: an env-constant re-judging round (sky/fog/moon tuned pre-tonemap).
> SSAO stays out (baked AO/skyVis answers) unless the HD-realtime concept is adopted — its doc owns that
> question.

The post chain re-imagined for a renderer that OWNS its targets. Headline change vs WebGL prod: **MSAA 4× replaces
SMAA** — simpler, better, and it's what unlocks alpha-to-coverage for the cutout world (the alpha fix's third leg).
SSAO is expected to be REPLACED by the baked skyVis channel (07) — it only returns if screenshots demand it.

## The chain (frame-graph passes, each timestamped)

```
scene (MSAA4, HDR RGBA16F) → resolve → bloom: threshold+downsample chain+upsample (dual filter)
→ god-rays: occlusion from resolved depth + radial blur toward sun screen-pos → composite
→ tonemap ACES + output-format conversion (the LAST pass writes the canvas)
```

- HDR target format decision (rgba16float vs bgra8+dither) — measure both; night bloom quality is the judge.
- God-rays: current look is the target (screenshot parity); the source is the sun disc occlusion from depth,
  not a separate godraysSource render (simpler than the WebGL plugin's approach). NOTE 2026-07-12: the sky
  already emits a STRUCTURED sun (hot disc ~0.5° + corona + circumsolar + haze, deliberately overshooting
  1.0) — today the sRGB output clips the core; this chain's HDR target turns that same overshoot into the
  bloom/god-rays energy source, no sky-side change needed.
- Tiers (the 072 idea, minimal here): render scale (0.75/1.0) + bloom quality + MSAA 2×/4× as the three knobs;
  wired to the same config surface prod uses.

## Tasks

- [x] **STAGE 1 PULLED FORWARD (2026-07-13, field round 3 of 074/06):** the scene renders into a LINEAR
      rgba16float offscreen (`SCENE_FORMAT`: MSAA + resolve; every scene pipeline + cell bundle retargeted)
      and a fullscreen `post` pipeline composites into the sRGB swapchain with brightness-threshold
      godrays (20-tap radial blur toward the sun's screen UV, decay 0.93, threshold 1.25, sunCorona tint;
      CPU gates: sun in front + above horizon + soft screen-edge fade). Occlusion is inherent — geometry
      leaves no bright pixels. Bloom/ACES/tier knobs still open below; the HDR A/B is settled (16f shipped).
- [ ] Target pool + resolve wiring in the graph (01 infra made real). ~~HDR format A/B~~ → 16f shipped.
- [x] **Bloom (2026-07-16, awaiting field + bench):** the prod `BloomEffect` mipmapBlur path ported
      1:1 — FULL-res luminance prefilter (`color × smoothstep(t, t+0.3, luma)`; threshold texel-wise
      BEFORE the chain so sub-pixel emitters survive) → 8 downsample mips (13-tap, out-of-frame taps
      zeroed) → 7 tent upsamples (`mix(support, tent, radius 0.7)`) → composite ×intensity into the post
      pass via prod's SCREEN blend (`dst + src − min(dst·src, 1)`), BEFORE ACES. 3 new pipelines
      (registry 20→23), chain targets rebuilt per resize (previous chain destroyed), bind groups + static
      per-level uniforms prebuilt — the steady frame writes ONE 32 B prefilter uniform. Env
      `bloomIntensity`/`bloomThreshold`; the shared driver runs the plan-071 night profile
      (`timeBandGrade`: 0.70 day → 0.38 deep night × `config.threshold/0.7`; overcast from the cloud
      profile). At intensity 0 the chain passes are SKIPPED (cost zero). A/B `?bloom=0|N` in all three
      hosts. **GPU timers grew a second span: `gpuPostMs` (bloom+composite) — the post pass was
      previously UNTIMED, so the ≤3 ms budget was unmeasurable; HUD + bench JSON (`gpuMs.post`) carry it.**
- [x] **ACES tonemap (2026-07-16, awaiting field + bench):** the EXACT prod curve — three's Stephen Hill
      fit as consumed by postprocessing's `ToneMappingEffect` (`ACESInputMat`/`RRTAndODTFit`/`ACESOutputMat`,
      `color/0.6`, exposure 1 — prod never sets `toneMappingExposure`) — applied at the END of the post
      pass (prod order: godrays → bloom → ACES; the sRGB swapchain view still encodes on write). Wiring:
      `Environment.tonemap` (default 1) → post uniform `params.x`; the shared env driver maps prod config
      (`graphics.toneMapping` && `toneMappingMode !== 'none'`; agx/neutral fall back to ACES — the engine
      ships one curve). A/B: `?aces=0` in the lab, the game host (folds into the live config) and the
      standalone page. Golden snapshot updated; driver tests cover on/off/'none'.
- [ ] God-rays; dusk bench-scene parity shots.
- [ ] A2C enablement on cutout pipelines + the coverage-preserved mips (03) verified together at distance
      (the foliage-thinning test).
- [x] **Tier knobs (2026-07-16, awaiting bench rows):** three knobs on the prod config surface —
      `graphics.renderScale` (0.5–1, LIVE: scene targets sized `canvas × scale`, the post pass upscales
      to the swapchain; `?scale=0.75`), `graphics.msaa` (2 or 4, BOOT-baked — pipelines + cell bundles
      carry the sample count; `?msaa=2`), and `Engine.bloomLevels` (2–8 mip levels, live; `?bloomq=5`,
      URL-only debug surface for now). Side fix: `ensureTargets` now DESTROYS the previous scene targets
      on rebuild — with live scale changes the old per-resize leak would have been real memory.
- [x] Tier ledger rows (2026-07-16, series 09·tiers): **scale 0.75 = −16…−25 % world GPU / −20 % post —
      THE tier lever.** bloomq Δ ≈ −0.05 ms (mips 6–8 are tiny). **USER VERDICT (same day): msaa is the
      worst option (WebGPU allows sampleCount 1|4 only — 2 failed every pipeline; visually identical) and
      bloomq is indistinguishable from scale 0.75 — BOTH KNOBS REMOVED from the code entirely.** The tier
      surface is ONE knob: `graphics.renderScale` / `?scale=` (default 1.0; 0.75 = the perf tier). MSAA
      stays hard-fixed at 4 (`MSAA_SAMPLES` — A2C needs it); bloom levels hard-fixed at 8 (prod chain).
- [ ] Ledger: full-chain post ms at 2× retina (budget: ≤ 3 ms).

## Prod post-chain spec (extracted 2026-07-16 — the porting reference)

- Composer: HalfFloat frame buffer; pass order `godrays(SCREEN) → bloom(SCREEN) → ACES → SMAA`
  (SMAA replaced by our MSAA4; SSAO replaced by baked channels).
- ACES: three's `ACESFilmicToneMapping` — `color *= exposure/0.6` (exposure 1), `ACESInputMat` (sRGB→AP1),
  `RRTAndODTFit(v) = (v(v+0.0245786)−0.000090537) / (v(0.983729v+0.4329510)+0.238081)`, `ACESOutputMat`,
  saturate.
- Bloom (postprocessing `BloomEffect`, `mipmapBlur: true`): FULL-res luminance prefilter
  `color × smoothstep(threshold, threshold+0.3, luminance)` → 8 downsample levels (13-tap: 4 inner ×0.125 +
  9 outer/centre ×0.05556) → 7 upsample levels (9-tap tent 1-2-1/16, `mix(support, tent, radius=0.7)`) →
  composite `bloomTex × intensity(0.7)`, SCREEN blend `dst + src − min(dst·src, 1)`.
- Night threshold profile (plan 071 `timeBandGrade`): threshold = 0.70 day → 0.38 deep night over
  `night = 1 − smoothstep(−0.105, 0.09, sunSin)`, scaled by `config.bloom.threshold / 0.7`.
- Godrays (prod `GodRaysEffect`): decay 0.92, density/exposure/weight from `sky` config, 60 samples,
  half-res, SCREEN. Our stage-1 additive composite is the field-accepted equivalent — kept.

## Measurement ledger

(per pass ms; full chain; tier deltas)

- 2026-07-16 ACES benched (series row 09·ACES): **≈ FREE, accepted** — GPU pass deltas vs the PRE-ACES
  baseline are mixed-sign inside noise (ls-noon −0.01 · sf +0.14 · lv-night −0.10 · country +0.18 ·
  ocean +0.14 · ls-rain −0.04 ms), all six scenes vsync 120 Hz. Field A/B day/dusk/night: day+dusk
  clearly richer (deeper sky, washout gone); night NOTABLY darker — expected (ACES compresses the low
  end; prod's night look leans on the 0.38 bloom threshold: lamps/windows/neon bloom back). Look verdict
  stays deferred until bloom lands; env constants (sky/fog/moon) re-judge afterwards.
- 2026-07-16 bloom benched (series row 09·bloom): **frame budget ACCEPTED** — all six scenes vsync 120 Hz,
  p95 ≤9.3 identical to the ACES row, world-pass deltas noise. **The first `gpuMs.post` column was an
  artifact**: on Apple/Metal a pass's BEGIN timestamp fires at its vertex-stage start, and TBDR overlaps
  that with the previous pass's fragments — the begin→end post span swallowed most of the frame
  (`?bloom=0` showed "post 5.24 ms" for a lone composite; noon post == world pass exactly). Fix shipped
  the same day: `lastPostMs = postEnd − worldEnd` (post fragments serialize behind the scene resolve, so
  end−end IS the chain's added tail). Corrected post numbers owed on the next sweep — THAT row judges the
  ≤3 ms budget. Field: night lamps/windows glow softly, day sky clean, no smear — the look-verdict gate
  LIFTS: ACES + bloom are both live, the env-constant re-judging round is open.
- 2026-07-16 corrected-post sweep (series row 09·post-fix): **≤3 ms budget PASSED — full post chain
  (godrays + full-res prefilter + 8 down + 7 up + composite + ACES) = 1.05–1.25 ms at 2× retina**, nearly
  scene-independent; world pass unchanged, all six scenes vsync 120 Hz. Step 2 bloom CLOSED.
