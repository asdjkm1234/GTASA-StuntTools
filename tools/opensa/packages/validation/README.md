# `@opensa/validation`

The shared answer to **"can I proceed, and what do I tell the user?"** — a verdict type, generic
file/path checks, and a way to run a list of them and collect everything rather than stopping at the
first failure.

Its first consumer is [`apps/cutscene-converter`](../../apps/cutscene-converter/docs/plans/001-architecture.md),
which has to tell a stranger why their folder is wrong in words they can act on. Plan:
[`docs/plans/001-validation-package.md`](./docs/plans/001-validation-package.md).

## The boundary, and it is the whole design

**This package holds the SHAPE of a verdict and generic checks. It does NOT hold domain knowledge.**

Every "just add this one check" that needs to know about SA data is a request to move that check into the
tool that owns the data. Say no here.

- "Do these car mods cover all the cutscenes?" is answered by `@opensa/vehicle-cutscene`'s census, derived
  from `data/txdcut.ide` + `data/vehicles.ide` + `models/cutscene.img`. `checkCoverage` takes that answer
  as opaque items with an `id` it only ever prints. The moment it needs to know what an id MEANS, the
  adapter belongs in the tool.
- The exe fingerprint is `@opensa/asi-sdk`'s `SA_FINGERPRINT`, imported and never restated.

The two SA-shaped compositions that do live here — `GAME_FILES` and `checkSaExe` — are lists of file names
and one imported constant, not knowledge derived from game data. That is the line.

## What it gives you

| Module        | Answers                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `verdict`     | The `ok` / `warning` / `error` union, `collect` / `runChecks` (worst level wins, nothing dropped), `isBlocked` |
| `checks`      | Generic: the path exists, is a directory, is writable, contains these entries, matches this size/SHA1          |
| `game-folder` | The files a consumer actually opens are all present — each missing one named separately                        |
| `sa-exe`      | Size + SHA1 against the only accepted `gta_sa.exe`                                                             |
| `coverage`    | A tool's readiness report → verdicts, naming what is uncovered                                                 |

## Two rules the types enforce

- **An `error` must carry a `fix`.** An error a user cannot act on is a crash with extra steps, so the
  compiler holds that requirement rather than a reviewer.
- **A run reports everything.** A user who picked two wrong folders should learn both at once.

## Two verdicts that are deliberately NOT errors

- **A modified game.** The check is "can we read what we need and patch what we patch", not "is this
  pristine" — the audience is people with modded games.
- **Incomplete coverage.** What has no donor keeps whatever it already had, which is a correct and
  complete result; the user simply gets fewer custom ones than they may expect. The warning names them,
  because "12 of 21 covered" without the list is not actionable.

The one that IS a hard block is the exe fingerprint: the plugin refuses an exe it does not recognise, and
a conversion onto an unsupported build looks fine and then loses actors behind car glass in-game.
