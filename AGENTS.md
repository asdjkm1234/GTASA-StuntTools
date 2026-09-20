# AGENTS — read `HANDOFF.md` first

This repository's engineering/handoff context lives in **[`HANDOFF.md`](HANDOFF.md)**. Read it before
planning or writing anything: it holds the environment facts, the build/run/test commands, the architecture,
and the **root causes of bugs already fixed** (Chrome WebGPU profile poisoning, GPU TDR from the append-only
texture array, camera mode/sign bugs, model orientation) so they are not reintroduced.

Non-negotiables (detail in HANDOFF.md):

- Run `npx tsc --noEmit -p tsconfig.json` in `tools/opensa` after app changes; it must be 0 errors.
- Rebuild/redeploy the replay with `tools/opensa/build-flight-replay.ps1`.
- Launch no browser you do not close: scripts must kill only the Chrome they started, and must use a FRESH
  throwaway profile. NEVER `taskkill /F` a reused Chrome profile — it corrupts that profile's WebGPU state.
- Keep `.ps1` files ASCII-only (PowerShell 5.1 reads BOM-less UTF-8 as ANSI and fails to parse).
- Do not distribute game assets. OpenSA is AGPL-3.0.
