# 073/01 — Upstream contribution (three.js)

**Priority: P0 (cheap, compounding).** Our WebGPU mode runs on `patches/three+0.185.1.patch`; every three upgrade
means re-applying it. Landing the fixes upstream deletes that liability and helps every streamed-scene user.

## Context

- Ready-to-file text: [upstream-issue-draft.md](concept/upstream-issue-draft.md).
- The patch carries FOUR pieces: (1) `needsRefresh` reorder (firstInit → static/bundle → hasNode), (2) stale-version
  sync inside static bundles, (3) replay heartbeat (first renderObject per bundle), (4) `?bundledebug` logging.

## Tasks

- [~] Split the patch: `bundledebug` logging OUT of the production patch (keep locally as a second optional patch
      or drop — logs served their purpose). Production patch = fixes (1)(2)(3) only.
- [~] File the issue from the draft (user's GitHub account); attach the r185 measurements (30→5 ms, field 13 ms).
- [~] Offer the PR; if maintainers engage, port our build-file patch to proper `src/` changes + a minimal
      streamed-scene example (the `webgpu-stream-compile` harness is a good seed).
- [~] Track the `referenceBuffer()` refactor thread — it obsoletes plan 08 if it lands.

## Done

Issue filed and linked here; production patch minimal; upgrade path for future three versions documented (re-run
`webgpu-spike` + `webgpu-stream-compile` harnesses after any bump).

> **MOOT 2026-07-18 — three, our patch, and both harnesses are gone from the tree** (plan 074/13,
> phases 3 and 7): the project ships its own WebGPU renderer, so there is no three version left to bump
> and no patch left to upstream. The open tasks above are retained as a record of the intent, not as
> work. If the upstream PR is ever revived, the harnesses must be rebuilt from the measurements in
> [`concept/phase-0-spike-checklist.md`](concept/phase-0-spike-checklist.md) and
> [`concept/phase-1-findings.md`](concept/phase-1-findings.md), which carry every number they produced.
