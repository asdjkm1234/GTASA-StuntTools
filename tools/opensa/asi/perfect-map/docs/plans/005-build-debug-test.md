# 005 — Build, debug & test harness

Part of the [perfect-map ASI chain](readme.md). Runs alongside 002–004 (the discipline they're tested WITH) and hardens it. Answers the user's explicit ask: _how to write, extend, maintain, and debug this_ — on a Mac, for a Windows target, with no Windows machine.

## Context

A blind binary patcher fails silently and remotely (it runs inside a Windows game under Wine on macOS). Without a deliberate harness, every bug is a mystery crash. This plan makes failures observable and most of the logic testable WITHOUT booting the game at all.

## Decisions

1. **Test pyramid, widest layer on macOS.** Most correctness lives in pure data, so test it natively:
   - **macOS unit tests (vitest, the tool's TS half)**: patch-catalogue parser, generated-constant correctness, fingerprint computation, original-byte tables. A test reads a real 1.0 US `gta_sa.exe` (path via env, not committed) and asserts every catalogue address holds its recorded original bytes — this catches an address rot without Wine.
   - **macOS byte-level C++ tests**: compile the patch-apply logic for the HOST (a small seam so `apply()` writes into a fake buffer, not live memory) and assert post-patch bytes. Relocation/accessor-repoint math verified against fixtures.
   - **Wine integration (slow, few)**: the validation ladder from 004 — actual boots. The only layer that needs the game.
2. **Logging is the primary debugger.** Flush-on-write log next to the exe (from 003): banner + build hash, fingerprint result, every patch decision with address+reason, and a final "N applied / M skipped" line. A crash's last log line points at the offending patch. This beats a live debugger for blind patches and works identically on the user's Wine setup.
3. **`winedbg` / x32dbg-under-Wine for the hard cases.** Document a repeatable recipe: run the game under `winedbg` with our ASI, break on our `DllMain`, step the first patch. Reserved for when logs aren't enough (e.g. an accessor we mis-repointed). Symbol map (below) makes it navigable.
4. **Ship a `.map`/symbol file** from the MinGW link (`-Wl,-Map`) so log addresses and debugger frames resolve to our function names. Kept as a build artifact, not shipped in the `.asi`.
5. **Deterministic, hashed builds.** `npm run build:asi` is reproducible (record `.asi` sha256); CI (macOS runner) builds it, runs the macOS test layers, and — if a Wine SA install is available in CI — a boot smoke; otherwise Wine stays a documented local step.
6. **Extending the tool is adding a catalogue row + a patch-table entry.** Document that flow end-to-end (RE a new limit → add to `patch-catalogue.md` → regen constants → add the apply fn → test ladder) so a future limit (or a second exe version, behind a new fingerprint) is a known procedure, not a re-derivation.

## Tasks

- [ ] macOS TS test layer: catalogue parser tests + the "real exe original-byte audit" test (env-gated path, skipped in CI if absent).
- [ ] Host-compilable C++ apply seam + byte-level tests (fake-buffer target); relocation-math fixtures.
- [ ] Logging finalized (flush-on-write, decision lines, summary); verify the last-line-before-crash property under a deliberately-broken patch.
- [ ] `winedbg` recipe documented + tried once on a real patch; `.map` symbol emission wired into the build.
- [ ] CI job (macOS): brew MinGW, `build:asi`, run macOS test layers, publish `.asi` + `.map` + sha256 as artifacts; Wine smoke if feasible, else documented manual step with exact commands.
- [ ] "How to extend / debug" doc section in the tool README (the add-a-limit procedure + the debug recipes).

## Verification

- A deliberately wrong address in the catalogue is caught by the macOS byte-audit test BEFORE any Wine run.
- A broken patch's failure is diagnosable from the log alone (last decision line = culprit) — demonstrated once.
- CI reproduces the exact shipped `.asi` hash.

## Measurements / notes

- test layer counts + coverage of patch logic: …
- CI build time / `.asi` hash: …
- winedbg recipe: …
