# 009 — 2dfx emitter-lifecycle patch

Part of the [perfect-map ASI chain](readme.md), Phase 2. Depends on [008](008-2dfx-emitter-re.md) (the confirmed mechanism + catalogue rows), [007](007-2dfx-reproduce.md) (the repro fixture + detection oracle), and Phase 1's [003](003-patch-framework.md) (the patch framework) / [005](005-build-debug-test.md) (the test harness). Implements the fix in OUR asi so particle 2dfx can ride LODs without the leak.

## Context

008 pins the mechanism (missing/incomplete effect-destroy path for LOD-cloned emitters, and/or a bounded fx pool that overruns under many-simultaneous-emitters pressure) and produces two-source-cited catalogue rows. This plan turns those rows into patch-table entries — declared, byte-verified, conflict-guarded, logged — exactly like the limit patches in Phase 1's [004](004-limit-patches.md). Nothing new in the framework; this is a second payload on it.

## Decisions

1. **Prefer the real lifecycle fix over a pool bump.** Per 008's "fix vs mask" finding: restore/complete the effect-destroy path so emitters actually UNLOAD when a LOD leaves range. Enlarging a pool only delays the crash and leaves the far-view emitter storm fully active. A pool relocation is a fallback (or complement) only if the lifecycle can't be cleanly restored via a hook.
2. **Implemented as patch-table entries** (from 003): each site has `expectedOriginalBytes` + `apply` + `conflictsWith` (any FLA/OLA or PF-owned overlap → skip + log). A per-fix enable flag for bring-up bisection (same pattern as 004).
3. **Hook, not raw-write, for the logic change.** A missing destroy call is naturally an injector function-hook on the entity stream-out / `DestroyEffects` path (mirror the SA convention: pair every `CreateEffects` with `DestroyEffects`). Raw byte edits reserved for any bound/pointer change on a pool relocation fallback.
4. **Compose with the limit patches, don't fight them.** This fix touches the effect/fx subsystem, disjoint from the IplDef/array zones of Phase 1 — verify no address overlap; both payloads live in the same table, gated independently.
5. **Correctness bar = emitters unload, not just "no crash".** Acceptance requires the effect/pool count returning to baseline as LODs stream out (measured, via 007's detection oracle), not merely surviving the new-game load.

## Tasks

- [x] Implement the fix as a patch entry from 008's catalogue row #6: null-guard `FxSystem_c::Stop` (0x4AA390) + `Play` (0x4AA2F0) against a null `m_SystemBP`. `src/patches/fx2dfx.hpp` (`ApplyFx2dfx`), byte-verified originals, verify-and-defer if any hook already owns the fx zone. Catalogue site `fx-emitter-uaf` added to `gen/catalogue.ts` → regenerated `patches.hpp`. **No lifecycle-repair or pool-bump needed** — see the design note below.
- [x] Per-fix enable flag `PM_FIX_FX2DFX` (default 1); `apply.hpp` calls `ApplyFx2dfx` alongside `ApplyInt16` (fx zone disjoint from adjusters → always apply). Both `make` and `make APPLY=1` build clean; gen tests green (8/8).
- [x] Host-side check: the guard trampoline's emitted bytes disassemble to the intended `mov eax,[ecx+8]; test; jnz→prologue; ret` (capstone-verified); original entry bytes verified against the real exe.
- [ ] **Wine validation (USER)** with the 007 `--keep-particles` fixture: (a) new game no longer crashes at `0x004AA3A1`; (b) up-close HD emitters (fire/smoke/fountains) still animate; (c) a stock/unmodded game still boots (guard inert when no dead system is ever hit).
- [ ] Regression (USER): full `make APPLY=1` asi (int16 + fx2dfx) boots clean with OLA/FLA present; the two payloads touch disjoint zones (0x404Bxx/0x1563730 vs 0x4AA2F0/0x4AA390).
- [ ] Update the tool README's patch list + the "extend" section: this is the worked example of adding a second engine fix on the framework.

## Verification

- The 007 repro that crashes on stock 1.0 boots clean with OUR asi (no ProperFixes) — the standing goal for this class met with our own code.
- Emitters demonstrably UNLOAD (count/memory returns to baseline), not just "crash delayed".
- Normal HD effects and a stock game are unaffected; each fix independently toggleable via its flag.

## Measurements / notes

### Implemented (2026-07-09) — null-blueprint guard, and why that IS the real fix

008's RE made the shape obvious and _smaller_ than "restore a missing destroy". The reap path is fine (particles
are recycled to the pool by `DestroyFxSystem`); `DestroyEntityFx` (0x4A1280) already `RemoveItem`s **and**
`operator delete`s the entity-fx node on every stream-out **regardless** of the `Kill()`. So there is no lingering
node/emitter leak to repair — the sole defect is that `Kill()→Stop()` **dereferences the already-reaped system** in
between (`mov cl,[m_SystemBP(null)+0x1B]` → AV 0x004AA3A1). A reaped system has `m_SystemBP == null` (the dtor
zeroed it), and `Stop`/`Play` on it have nothing to do. Guarding that deref:

- **is correct, not a mask** — no pool was enlarged, no behaviour delayed; the emitter still unloads via the normal
  node-delete, we only stop the dead-system touch. Meets decision #1 ("real lifecycle fix over a pool bump") and #5
  ("emitters unload, not just no-crash") — they already unload; we remove the crash on the redundant Kill.
- **minimal blast radius** — two 5-byte entry hooks in the isolated fx subsystem; disjoint from Phase-1's
  IplStore/HOODLUM zones and from anything FLA/OLA patch.

`Stop` covers the crash path (`Kill` 0x4AA3F0 just calls `Stop` then writes a state byte to the not-yet-reused
block — benign once `Stop` no-ops). `Play` guarded for the symmetric dead-system-Play path.

- fix implemented: **null-blueprint guard hook** (neither lifecycle-repair nor pool-relocation was required — the
  RE showed the node already deletes correctly).
- per-site original/patched bytes: `Stop` @0x4AA390 `56 8B F1 8B 46 08` → entry `jmp` to a guard stub
  (`mov eax,[ecx+8]; test eax,eax; jnz→prologue; ret`), continuation 0x4AA396. `Play` @0x4AA2F0
  `51 56 8B F1 80 7E 50 02` → same stub shape, continuation 0x4AA2F8. Guard stub capstone-verified. Cross-ref
  patch-catalogue row #6.
- emitter behaviour over a new-game load (before/after): _pending the user's Wine run with the 007 fixture._
