# 001 — `@opensa/validation`: a shared answer to "can I proceed, and what do I tell the user?"

**Status: DONE 2026-08-17.** All six steps shipped; measured numbers under each. A new workspace package.
Its first consumer is
[`apps/cutscene-converter`](../../../../apps/cutscene-converter/docs/plans/001-architecture.md), which has
to tell a stranger — not us — why their folder is wrong, in words they can act on.

## The boundary, and it is the whole design

**This package holds the SHAPE of a verdict and generic file/path checks. It does NOT hold domain
knowledge.**

The temptation is to teach it "which cutscene slots exist" so it can answer "do these car mods cover
all the cutscenes?". That answer already exists, derived rather than listed: `vehicle-cutscene`'s
`census.ts` reads it out of `data/txdcut.ide` + `data/vehicles.ide` + `models/cutscene.img`, and
`matchMods` reports per-slot readiness. A second copy here would be a hardcoded list by another name,
and it would drift the first time R\* data or a mod folder convention surprises us — the failure this
project's "never a hardcoded list" rule exists to prevent.

So: **domain questions are ASKED of the tool that owns them; this package types the answer.** The same
rule applies to the exe fingerprint — `SA_FINGERPRINT` is `@opensa/asi-sdk`'s canonical constant and
is imported, never restated.

## What it provides

1. **A verdict type.** One discriminated union with three levels — `ok`, `warning`, `error` — each
   carrying: a stable `code`, a one-line `message` a non-developer can read, an optional `detail` for
   the log, and an optional `fix` ("what to do about it"). The `fix` field is the reason this package
   exists: an error a user cannot act on is a crash with extra steps.
2. **Generic checks**: does a path exist, is it a directory, is it writable, does it contain these
   named files, is a file's size/SHA what was expected. Nothing about SA.
3. **Composition**: run a list of checks, collect every verdict rather than stopping at the first
   (a user who picked two wrong folders should learn both at once), and report the worst level.

## The three checks the first consumer needs, and where each really lives

| Question | Answered by | Lives in |
| --- | --- | --- |
| Is this a GTA:SA install we can read? | the files the converter actually opens exist: `models/cutscene.img`, `models/gta3.img`, `models/generic/vehicle.txd`, `data/carcols.dat`, `data/vehicles.ide`, `data/txdcut.ide`, `anim/cuts.img` | generic checks, composed here |
| Is the exe one the ASI will patch? | size + SHA1 against `SA_FINGERPRINT` from `@opensa/asi-sdk` | generic file-hash check, constant imported |
| Do these car mods cover the cutscenes? | `vehicle-cutscene`'s census + `matchMods` | the TOOL; this package only shapes the verdict |

**A MODIFIED game is not an error.** The user's call, and it is right: what matters is whether we can
read what we need and patch what we patch. A game that differs from stock but supplies all of the
above proceeds. If a difference is worth mentioning at all it is a `warning` with a `detail`, never a
block — this tool is FOR people with modded games.

**A mod set that does not cover every cutscene is a `warning`, not an error.** Slots without a donor
keep their vanilla cutscene model, which is a correct and complete result; the user simply gets fewer
custom cars than they may expect. The verdict should name the uncovered slots, because "12 of 21
covered" without the list is not actionable.

**The exe fingerprint is the one that can be a silent trap.** The converted fleet REQUIRES
`perfect-cutscene.asi`, and the ASI refuses to apply to an exe it does not recognise. A conversion
onto an unsupported exe "succeeds" and then loses actors behind glass in-game. That has to be loud at
the point the game folder is chosen, not discovered later.

## Steps

- [x] **1. The package.** `packages/validation` in the root `workspaces`, `@opensa/validation`,
      exports per-module like its neighbours. No dependencies beyond `node:fs`/`node:path` — a
      validation package that drags in a parser is one nobody else can use. Verification: it builds,
      lints (note the repo's ESLint prefers `interface` over `type` and caps cognitive complexity at
      20), and the suite runs.
      **Done.** `node:crypto` joined `node:fs`/`node:path` (SHA1 for step 5) — still builtins only, no
      package dependency. `tsc --noEmit` clean, `eslint` clean, `knip` reports nothing new (its 833
      "unlisted dependencies" are the pre-existing monorepo-wide state, every workspace package
      resolving `@opensa/*` through the root symlinks rather than a `dependencies` block).
      **The tag is `type:tool`, not `type:engine`** — it reads `node:fs` and imports `@opensa/asi-sdk`
      (a `type:tool`), which `type:engine` may not do. The folder stays `packages/` as planned: that is
      where the vitest `packages/**/*.test.ts` include and the `packages/**/*.ts` coverage floor already
      reach, and moving to `tools/` would buy the naming consistency at the price of both. The one thing
      the split broke was the architecture diagram — `scripts/arch-graph.ts` derived the layer from the
      FOLDER, so it drew a `node:fs` package inside the runtime graph; it now reads `nx.tags` first and
      falls back to the folder only for an untagged package. Recorded in `docs/architecture/README.md`.
- [x] **2. The verdict type + composition.** Levels, codes, `message`/`detail`/`fix`, collect-all.
      Verification: unit tests, negative cases first — the worst level wins, every failing check is
      reported, an empty list is `ok`.
      **Done** (`src/verdict.ts`, 8 tests). The union earns its keep: `fix` is REQUIRED on `ErrorVerdict`
      and optional on `WarningVerdict`, so "an error a user cannot act on" is a compile error rather
      than a review note.
- [x] **3. Generic checks.** Path exists / is a directory / is writable / contains named entries /
      file matches size + SHA1. Verification: real temp trees, not mocks — a check that has never seen
      a filesystem is not a check.
      **Done** (`src/checks.ts`, 15 tests over `mkdtemp` trees). `checkWritable` WRITES a probe file and
      removes it instead of reading permission bits: on Windows — where the first consumer ships — a
      read-only folder passes `access(W_OK)` and then fails on the first real write. Its negative test
      points at a path inside a non-existent parent rather than a `chmod`ed folder, because as root the
      chmod version would pass for the wrong reason.
- [x] **4. The game-folder composition.** The seven-file list above, expressed as data so a consumer
      can see WHICH file is missing. Verification: passes on `game-src/original`, and each of the
      seven produces its own error when removed from a temp copy.
      **Done** (`src/game-folder.ts`, 11 tests — `it.each(GAME_FILES)` covers the seven one at a time).
      A folder that does not exist returns ONE verdict, not eight: listing files that cannot be there is
      noise. Measured on the real tree: `game-src/original` → `ok`, 3 verdicts.
- [x] **5. The exe check.** Size + SHA1 against `SA_FINGERPRINT`, imported. Verification: passes on
      the accepted exe; a one-byte-different copy fails with the fingerprint in `detail`.
      **Done** (`src/sa-exe.ts`, 6 tests). The rejects run on temp files; the ACCEPT runs on the real exe,
      which is now a fixture (`copy('gta_sa.exe', 'gta_sa.exe')` in `scripts/test-fixtures.ts` — a stock
      game file, manifest line in the same change). Only that case can prove the gate OPENS for the build
      we ship to, and it is the one check whose failure surfaces hours later, in-game. Measured:
      `game-src/original/gta_sa.exe` = 14 383 616 B, sha1 `8c23ceff…3b8e3c00` — the accepted fingerprint.
      Whole gate (folder + 7 entries + a 14 MB SHA1) = **9 ms**.
- [x] **6. The coverage adapter.** A thin function that takes the tool's readiness report and turns it
      into verdicts (uncovered slots → one warning naming them; an unreadable mod folder → error). It
      lives HERE only if it stays free of slot knowledge; the moment it needs to know a slot name it
      belongs in the tool instead. Verification: fed a synthetic readiness report, not a real game.
      **Done** (`src/coverage.ts`, 6 tests on synthetic reports). It takes `{ id, ready, reason? }` items
      and a plural `label` from the caller — it never imports the tool's `SlotReadiness`, so it cannot
      learn what a slot is. An empty item list is its own warning (`coverage.nothing-to-check`): "All 0
      cutscene slots are covered" would be a lie told confidently.

## Measured

- **45 tests, 5 files, 171 ms** (`npx vitest run packages/validation`). Full suite 4 534 tests.
- `tsc --noEmit` and `eslint` clean across the repo.
- The whole first-consumer gate against the real game tree: **9 ms**, 3 verdicts, `ok`.
- Fixture corpus 127 → **128** entries (`+gta_sa.exe`, 14 MB in the generated, uncommitted
  `fixtures/original/`); regenerated from scratch with `npm run test:fixtures`.

## What the next consumer inherits

`apps/cutscene-converter` also needs `@opensa/vehicle-cutscene`, a `type:tool` — and `type:app` may depend
on apps and engine packages ONLY. So that app cannot be tagged `type:app`; it is an offline desktop tool by
layer whatever its folder says. Decide the tag when the app's plan 002 starts, not by discovering the lint
failure.

## Risks

- **Scope creep is the whole risk.** Every future "just add this one check" that needs to know about
  SA data is a request to move that check into the tool that owns the data. Say no here; the README
  should say it too.
- A verdict's `message` is user-facing English and will be read by people who did not write it. It is
  content, not a string constant — worth reviewing as copy when the app's UI lands.
