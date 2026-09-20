# timecyc `sunSize` → an angle

**What it is.** `const SUN_SIZE_TO_RAD = 0.0045` — `packages/engine/src/engine.ts`. Multiplies timecyc's
`sunSize` column (≈3–5) to get the sun disc's angular core radius in radians, ~1° at `sunSize` 4.

**What it stands in for.** Whatever the original renderer does with that column. SA's sun is a billboard
scaled in screen space by a chain of camera and timecyc terms; ours is an angular disc in the sky shader, so
there is no shared unit and the column had to be mapped to one.

**What it was judged on.** By eye, against the original — the comment says `prod-matched by eye` and that is
the whole basis. ~1° is also roughly the real sun's apparent diameter (0.53°, so this is about twice life
size), which is a sanity check rather than a derivation.

**What would retire it.** Reading the reversed source's own sun billboard sizing and expressing it in the
same angular terms. Nobody has looked: this is a case where the original's formula probably IS recoverable
and simply has not been dug out, which under `CLAUDE.md`'s rule makes the constant a debt rather than an
answer.

**Blast radius.** The sun disc and, through the bright-pass threshold, the godrays that feed off it
(`GODRAY_INTENSITY` 0.9, decay 0.93 — themselves tuned against the disc's HDR overshoot sitting at 3–6 while
lit world pixels stay under ~1.2). Growing the disc feeds more pixels into the rays; the two are not
independent.
