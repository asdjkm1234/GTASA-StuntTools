# Cutscene Converter

A standalone Windows app that puts modded cars into GTA:SA's cutscenes, for people who will never clone
this repo. One portable `.exe`, three steps, no prerequisites.

Plans: [001 architecture](docs/plans/001-architecture.md) · [002 implementation](docs/plans/002-implementation.md).

## It is a facade

The conversion is `@opensa/vehicle-cutscene`, unchanged and unforked. This app chooses folders, validates
them (`@opensa/validation`), runs the tool and explains the result. **No rule about SA data lives here** —
`src/main/convert-child.ts` is one line: it imports the tool's own CLI, so what the app runs and what a
command line runs cannot drift. `src/main/convert.test.ts` pins the argv, because the flags are the one
thing a facade can get wrong while looking like it works.

Two flags are always on and never shown: `--no-base-copy` (600 MB of output instead of 2 GB) and
`--self-contained-txd` (the user's game has no mod TXDs installed, so the txdp parent route cannot
resolve). A choice with exactly one correct answer is not a choice.

## Commands

| Command                                          | Does                                                         |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `npm run dev -w @opensa/cutscene-converter`      | Vite server + esbuild pass + Electron pointed at it          |
| `npm run build -w @opensa/cutscene-converter`    | The three bundles: ASI resource, main, renderer              |
| `npm run pack:win -w @opensa/cutscene-converter` | The portable `.exe` into `release/` (cross-built from macOS) |

`electron`'s postinstall is approved in the root `package.json` (`allowScripts`); without it npm 11 blocks
the binary download and nothing runs.

## Shape

```
src/main/       Electron main: window, IPC, folder pickers, the child-process runner, the validations
src/renderer/   React — three steps, verdicts, the tool's own output as the log
src/shared/     what both processes need (IPC types, the app name); neither imports the other
scripts/        the esbuild bundle, the dev loop, the ASI resource
```

The renderer has no Node: `contextIsolation` stays on and `src/main/preload.ts` is the only bridge.

## The plugin is embedded at BUILD time

`asi/perfect-cutscene/dist/perfect-cutscene.asi` is cross-compiled locally with mingw and is gitignored, so
the app can be built on a tree that does not carry it. **It never ships without it**: `npm run build:asi`
fails and names the command that produces the file. The binary's SHA1 is shown in the about line, so a bug
report identifies the plugin inside.

A converted fleet REQUIRES that plugin, which is also why the exe fingerprint is a hard gate at step 1: on
an exe the plugin does not recognise, the conversion looks fine and then loses the actors behind car glass,
in-game, hours later.

## Unsigned, on purpose

DECIDED (plan 001): no certificate. Windows SmartScreen shows "Windows protected your PC" on first run; the
tutorial explains "More info → Run anyway". Signing is a distribution decision with a recurring bill and can
be added later without touching a line of the app.
