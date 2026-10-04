# asi/sdk — the ASI authoring SDK

The common base for authoring `.asi` plugins against GTA:SA 1.0 US, extracted from
`asi/perfect-map`'s framework half. A plugin written on it supplies only: its typed catalogue
(addresses + expected bytes + provenance), its payload headers, its config knobs, and a thin
Makefile. Everything else — the exe fingerprint gate, byte-verify, adjuster coexistence (FLA/OLA),
hook shapes, logging, dry-run, the cross-compile toolchain — is this project.

`asi/` is a root category (outside `packages/` and `tools/`) because its projects AUTHOR runtime
content rather than building the map — the same rule that placed `cleo/`, whose `sdk` + consumers
split this project mirrors.

## Layout

- `gen/` — the TypeScript codegen library: catalogue interfaces, `renderHeader`/`validate`, the
  shared `SA_FINGERPRINT`. Consumed by each plugin's thin `gen/generate.ts`.
- `include/asi/` — the C++ framework headers (namespace `asi::`), included as `<asi/…>`.
- `src/` — `freestanding.cpp` (the `-nostdlib` CRT builtins), compiled into every plugin.
- `mk/` — the includable Makefile fragment (MinGW-w64 cross-compile, KERNEL32-only link line).
- `docs/` — [architecture](docs/architecture.md) (the standing design + Decided) and the
  [plan chain](docs/plans/readme.md) (001–005).

## Writing a plugin

`asi/perfect-map` is the worked example — copy its shape. What is yours:

1. **The subject matter** — `gen/catalogue.ts` (your `CatalogueEntry[]`: addresses, expected bytes,
   provenance) and `src/patches/*.hpp` (what your fixes actually do).
2. **The seam** (~180 lines, mostly boilerplate):
   - `gen/generate.ts` — calls `renderHeader(CATALOGUE, SA_FINGERPRINT, { namespace: '<ns>' })` and
     writes your `src/generated/patches.hpp`;
   - `src/apply.hpp` — your `asi::ApplyFn`, running the enabled fixes;
   - `src/identity.hpp` — your log filename and log tag, declared once;
   - `src/plugin.hpp` — one `constexpr asi::Plugin` (identity + generated tables + apply fn);
   - `src/config.hpp` — your own `#ifndef`-guarded payload flags (the framework's `ASI_APPLY` /
     `ASI_DEBUG` come from `<asi/config.hpp>`);
   - `src/dllmain.cpp` — hands the plugin to `asi::OnAttach`.
3. **The wiring**: `Makefile` (see below), a `package.json` with `gen` / `build:asi` /
   `build:verify` / `build:debug`, your directory added to the root `package.json` `workspaces`,
   and a `.gitignore` for `dist/` and `src/generated/`. Lint and tests need no config — the repo's
   globs already cover `asi/**`.

The Makefile is `PLUGIN_OUT`, `PLUGIN_SRC`, `PLUGIN_HDRS`, optionally `PLUGIN_DEFS` /
`PLUGIN_DEBUG_DEFS`, then `include ../sdk/mk/asi-plugin.mk`. **`PLUGIN_HDRS` must list every header
you own, `src/patches/*.hpp` included** — miss one and editing a payload does not trigger a rebuild,
which looks exactly like a patch that did not work.

Two rules the framework enforces for you, and one it cannot: every site is **named**, never
re-declared (its bytes and address come from your generated table, so `VerifySitesOrDefer` and the
write agree by construction); a fix that cannot verify **defers** rather than writing. What it
cannot check is that your site names still exist in the catalogue after a rename — mirror
perfect-map's `gen/generate.test.ts`, which asserts exactly that.

## Consumers

- [`asi/perfect-map`](../perfect-map/README.md) — the first; its migration is the SDK's
  conformance proof.
- [`asi/perfect-cutscene`](../perfect-cutscene/README.md) — the second, and the SDK's real
  greenfield test: written straight onto it (plan 001 step 1), no framework change needed.
- `asi/city-life` — the named second (roadmap 0.5.0), which will bring the per-frame tick and
  runtime `.ini` extension points when it arrives.

## Build

The SDK builds nothing by itself — a consumer's Makefile includes `mk/asi-plugin.mk` and runs
`make` (verify-only / dry-run), `make APPLY=1` (shipping), `make DEBUG=1` (verbose). Prereq:
`brew install mingw-w64`. The TS half is exercised by the repo-wide vitest run
(`asi/**/*.test.ts`).
