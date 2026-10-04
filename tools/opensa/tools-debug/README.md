# tools-debug

Debug / reproduction harnesses — tools that exist to **investigate and reproduce engine bugs**, not to ship in
a build. Kept out of `tools/` (the map-build pipeline) so the production toolchain stays clean. Each is a normal
workspace (`tsx`-run CLI + unit tests), registered in the root `package.json`, `vitest.config.ts`, and
`eslint.config.ts`.

## Tools

- **[`bench-harness`](./bench-harness)** — headless field-check harness for the own-engine game: boots via
  `?loader=http-dir&src=<served build>` (the real load path, no fake picker — plan 079 phase 3) over
  `serve-static`'s `/build` mount + Playwright WebGPU boot — runs the in-game bench sweeps, soak runs and
  boot-gate checks without a human at the screen. Guide:
  [docs/development/benchmarks.md](../docs/development/benchmarks.md). (Plain node scripts, not a
  workspace — they drive a browser, they don't ship.)
- **[`phone-console`](./phone-console)** — the field-run panel for the phone the work is done on: one page
  (`npm run panel`, installable to the home screen) that runs the rituals `scripts/phone.sh` already knows,
  says why a run will not start BEFORE it is started, and files what the run measures into
  `docs/benchmarks/` with the conditions it can prove. Plain dependency-free `.mjs` on purpose — it has to
  boot on a tree too broken to run TypeScript, because saying so is its first job. Plans:
  [`phone-console/docs/plans/`](./phone-console/docs/plans/).
- **[`sa-int16-repro`](./sa-int16-repro)** — the row-count dial that reproduces SA's int16 building-pool
  truncation (the "ghost barriers" bug) on demand. The pass/fail **oracle** for the
  [perfect-map ASI project](../asi/perfect-map/docs/plans/readme.md). Full plan:
  [`sa-int16-repro/docs/reproducing-the-int16-bug.md`](./sa-int16-repro/docs/reproducing-the-int16-bug.md).
