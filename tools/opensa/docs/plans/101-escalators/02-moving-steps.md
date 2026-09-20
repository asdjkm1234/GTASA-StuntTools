# 02 — The steps move

Part of [101 — Escalators in OpenSA](readme.md). Depends on [01](01-escalators-into-the-pak.md), and its
SHAPE is decided by [00](00-recover-sa-behaviour.md) — if SA's steps turn out to be a scrolling texture, most
of this file is replaced by one data row on the existing UV-animation lane (plan 099).

## Context

Written against the expensive shape (per-step objects moving along the path), because that is the honest
default until the research says otherwise. The path is `position → bottom → top → end`: a lower landing, an
incline, an upper landing, with `direction` selecting which way the steps travel.

## Decisions

1. **The step geometry comes from the game, not from us.** Whatever model SA uses for a step is what we
   instance; a box of our own would be visible as wrong the moment anyone looked at it.
2. **The visual is driven by a single phase per escalator**, advanced on the fixed step — one number, not a
   simulation. Steps are positions along a polyline, evenly spaced, wrapped.
3. **Distance behaviour is measured, not assumed.** An escalator you cannot reach does not need to animate.
   Whether the steps freeze, keep running or vanish beyond some distance is decided by what it costs — with
   six of them on the whole map, the answer may well be "always run, it is free".
4. **No new render lane if an existing one fits.** Clutter instancing and the rigid UV-anim lane both already
   exist; a third lane needs a reason beyond convenience.

## Tasks

- [ ] Re-scope this file against 00's answer before writing code.
- [ ] Instance the steps along the path with a per-escalator phase; wrap at the ends.
- [ ] Field check: the LS mall pair (`escl_la`) runs in the right direction, and the opposed pair runs
      opposite ways — the fixture that catches a sign error, since one model hosts two escalators with
      `direction` 1 and 0.
- [ ] Cost: frame ms with all resident escalators running vs frozen.

## Verification

- Steps move at the recovered speed, in the direction the entry declares, on all four models.
- No visible seam where a step wraps.
- Frame cost is inside the noise, or the distance rule from decision 3 is what keeps it there.

## Measurements / notes

_(record after implementation)_
