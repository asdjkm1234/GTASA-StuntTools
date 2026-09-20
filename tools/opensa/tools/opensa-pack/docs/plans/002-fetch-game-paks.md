# 002 — Paks for fetch-mode games (gostown & co)

**Status: STUB — queued for AFTER the successful WebGPU migration (user decision 2026-07-17); the user
will refine the scope before work starts. Do not begin from this stub alone.**

## Why

The prod web app serves two loader modes (`apps/web/src/game-config.tsx`): **local** (the user picks
their own SA install — the pak comes from the pmb chain on the user's machine, [074/14](../../../../docs/plans/074-opensa-engine/14-pmb-integration.md))
and **fetch** (freeware total conversions like gostown — the app downloads prepared archives from
static hosting). The own engine renders from `.ospak`, so every fetch-mode game needs a **prepared,
hosted pak** — a one-time (per release) conversion this tool must own.

## Known question marks (to refine with the user)

- Conversion pipeline for a fetch game: what is the "game-ready set" input for gostown (it is not an
  SA install with mods — different data layout? full map or districts?).
- Hosting/delivery: the pak next to the existing `static/games/<game>-<version>/` archives; range-read
  serving is already in the engine loader (074/05) — verify the static host honours `Range`.
- Versioning: pak version tied to the game archive version; the app's game-config needs a pak URL per
  fetch game.
- Whether the three-WebGL archives stay hosted during the comparison window (C2 kills the three path).

## Non-goals (for now)

Everything about LOCAL installs — that is the pmb integration ([074/14](../../../../docs/plans/074-opensa-engine/14-pmb-integration.md)).
