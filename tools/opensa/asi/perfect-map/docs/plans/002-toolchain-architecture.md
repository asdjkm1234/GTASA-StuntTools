# 002 — Toolchain & project architecture

Part of the [perfect-map ASI chain](readme.md). Depends on [001](001-reverse-engineering.md) (we need to know it's function-hooks + raw patches before choosing a hook lib). Delivers a **buildable, empty-but-loading ASI**: cross-compiles on macOS, loads under Wine, logs "hello", patches nothing yet.

> **Historical record — the framework this plan built now lives in [`asi/sdk`](../../../sdk/README.md)**
> (namespace `asi::`, headers in `asi/sdk/include/asi/`, build rules in `asi/sdk/mk/asi-plugin.mk`),
> extracted 2026-08-06 by the [asi/sdk chain](../../../sdk/docs/plans/readme.md). Paths to
> `log/mem/hook/fingerprint/coexistence/patch_table.hpp` and `freestanding.cpp` below are where they
> were WHEN THIS SHIPPED; the text is left unedited on purpose. `asi/perfect-map` keeps only its
> catalogue, payloads, config knobs and a thin Makefile.

## Context

This is the repo's FIRST native/C++ artifact — everything else is TypeScript/Nx. It must fit the monorepo conventions (an `asi/perfect-map/` package) while carrying a C++ build that produces a Win32 PE DLL from macOS with no Windows machine and no MSVC. The user tests everything under Wine already.

## Decisions

1. **Cross-compiler: MinGW-w64 `i686-w64-mingw32-g++` (primary), Zig `zig cc` as fallback.** SA is 32-bit (PF is i386) so the target is `i686`. MinGW-w64 is the community-proven path (FLA/PF-class DLLs), installs via Homebrew, fully headless. Zig cross-compiles i386-windows with zero toolchain install and is a great fallback if MinGW linking of the C++ runtime gets fiddly — evaluate both in task 1, pin one, document the other.
2. **Static-link the C++ runtime** (`-static -static-libgcc -static-libstdc++`) so the `.asi` has no MinGW DLL dependencies — it must drop into a game folder and just work.
3. **Hook/patch lib: injector.hpp** (thelink2012, permissive license — freely reusable, unlike ProperFixes; the same lib PF/FLA use). Header-only, MinGW-compatible. **NOT plugin-sdk** — we do pure memory patches, not RW/CLEO glue; plugin-sdk's weight buys us nothing here. If injector.hpp fights MinGW, fall back to a ~200-line self-authored subset (`WriteMemory`, `MakeCALL/JMP`, `ReadMemory`, VirtualProtect wrappers) — fully transparent and debuggable, which is a maintainability plus we may take anyway.
4. **Bare `DllMain` ASI entrypoint** — no ASI framework. On `DLL_PROCESS_ATTACH`: fingerprint the exe (003), apply the patch table (003/004), log. That's the whole lifecycle.
5. **Repo layout** mirrors other tools but with a native sub-build:

   ```
   asi/perfect-map/
     src/            # C++ (dllmain.cpp, patches/, engine addresses, fingerprint, log)
     third_party/    # injector.hpp (vendored, pinned commit)
     build/          # CMake or a plain Makefile driving i686-w64-mingw32-g++
     test/           # macOS-side byte-level unit tests (plan 005)
     docs/plans/     # promoted from this ideas chain when work starts
     package.json    # npm scripts wrap the native build (`npm run build:asi`) for monorepo consistency
     readme.md
   ```

6. **Build driver: CMake with a MinGW toolchain file** (portable, IDE-friendly) OR a plain Makefile (fewer moving parts). Pick by which the maintainer prefers to debug; wrap it behind an `npm run` script so it's invoked like every other tool in the repo. The generator's TS side (patch-table codegen, 003) stays in the Nx/vitest world; the C++ side is compiled by the wrapped native build.
7. **The "tool" is two halves**: (a) the C++ ASI source, and (b) a TypeScript generator that emits the patch table / fingerprint constants from `001`'s `patch-catalogue.md` (so the addresses have ONE source of truth, machine-checked, not hand-copied into C++). Decide the codegen boundary here; implement in 003.

## Tasks

- [x] Evaluate MinGW-w64 vs Zig: **MinGW-w64 pinned** (GCC 16.1.0, `brew install mingw-w64`); Zig fallback command documented. Built a loading i686 Win32 DLL (below).
- [x] `asi/perfect-map/` package scaffold: `package.json` (`build:asi`/`clean`), `.gitignore`, README with macOS setup; registered in root workspaces.
- [~] Vendor injector.hpp under `third_party/` with license + compile smoke. **Deferred to 003** (the empty ASI needs no hooks; injector lands when the patch framework does).
- [x] Minimal `dllmain.cpp`: `DllMain` → open `perfect-map-asi.log` next to the exe, write a banner (+ build date/time), return. **KERNEL32-only** import table (objdump-verified) — no CRT/MinGW DLL deps.
- [ ] Wine load test: drop the `.asi` into the Wine SA install, boot, confirm the banner in the log. **⏳ user (Wine).**
- [x] Makefile finalized; `npm run build:asi` produces `perfect-map.asi` deterministically (3,072 B; see measurements).
- [ ] Decide + document the TS-generator ↔ C++ boundary (how `patch-catalogue.md` becomes compiled constants). **→ 003.**

## Verification

- `npm run build:asi` on a clean macOS + brew MinGW produces a loadable PE32 DLL; import table shows only KERNEL32/USER32 (no MinGW runtime DLLs).
- Wine boot writes the banner log — the ASI loads into the real game process.

## Measurements / notes

### Scaffold (2026-07-09)

- **Toolchain: MinGW-w64 via Homebrew** — `i686-w64-mingw32-g++ (GCC) 16.1.0`. `brew install mingw-w64`.
  (Zig fallback not needed; MinGW built cleanly first try — command to try if MinGW ever breaks:
  `zig cc -target x86-windows-gnu -shared`.)
- **Build driver: plain Makefile** (chosen over CMake — one DLL, fewest moving parts), wrapped by
  `npm run build:asi` (`make`) / `npm run clean`. Output `dist/perfect-map.asi`.
- **Key link flags:** `-shared -nostdlib -Wl,--entry,_DllMain@12 -lkernel32`. `-nostdlib` + a raw `DllMain`
  entry (no CRT startup) is what gets the import table down to **KERNEL32 only** — a default `-static` build
  still pulled `api-ms-win-crt-*.dll` (UCRT), which is absent on XP-era Windows SA runs on.
- **Built `.asi`:** PE32 DLL i386, **3,072 bytes**, imports **KERNEL32.dll only** (CloseHandle, CreateFileA,
  DisableThreadLibraryCalls, GetModuleFileNameA, WriteFile, lstrcatA). `DllMain` on attach writes a banner to
  `perfect-map-asi.log` next to the host exe. Verified via `objdump -p/-x` (import table) + `strings`.
- **Wine load test (⏳ user):** drop `dist/perfect-map.asi` into the SA install's ASI-loader folder, boot, expect
  `perfect-map-asi.log` next to `gta_sa.exe` containing `[perfect-map] loaded — built …`.
