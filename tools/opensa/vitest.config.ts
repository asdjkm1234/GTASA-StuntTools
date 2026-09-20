import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      // Project-wide logic coverage (.ts). The .tsx UI is R3F/DOM glue, integration-tested in-browser, not here.
      exclude: [
        // --- Not logic (never counted anywhere) ---
        'apps/web/**/*.test.ts',
        'apps/web/**/index.ts',
        'apps/web/**/*.interface.ts',
        'packages/**/*.test.ts',
        'packages/**/index.ts',
        'packages/**/*.interface.ts',
        'packages/renderware/src/test-utils.ts',
        'packages/engine/src/test/**', // the fake GPUDevice — test infrastructure, not product code (plan 077)
        'apps/web/src/standalone/**', // dev-only viewer entry scripts

        // === COVERED BY THE PLAYWRIGHT E2E LANE (not by headless node units) ===
        // GL / DOM / app-loop glue: WebGL + browser only, so it's verified in `e2e/` (docs/development/e2e.md),
        // not here. RULE: anything excluded below MUST have e2e coverage on the Playwright lane — if you add a
        // file here, add/extend a spec in `e2e/` to exercise it. (See memory: gl-dom-coverage-exclusion.)
        'packages/game/src/input/keyboard/keyboard.ts', // DOM keyboard listeners
        'apps/web/src/ui/**', // DOM/style helpers (locations, debug-styles, hud font loading)
        'apps/web/src/asset-loader/asset-loader.ts', // fetch streaming + Cache Storage orchestration (e2e: asset-loader.spec.ts)
        'apps/web/src/asset-loader/cache-store.ts', // Cache Storage API wrapper (e2e: asset-loader.spec.ts)
      ],
      include: ['apps/web/**/*.ts', 'packages/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      // Floors sit a small buffer below the achieved numbers so an unrelated change can't silently erode
      // coverage. Branches sit lower by nature (error/edge paths). Re-armed 2026-07-18 against the plan-077
      // recovery (88.18% stmt / 78.57% branch / 90.72% func / 88.12% lines) after the renderer teardown
      // temporarily sank them — the engine is unit-tested through a fake GPUDevice, see plan 077.
      thresholds: { branches: 77, functions: 88, lines: 86, statements: 86 },
    },
    environment: 'node',
    globals: false,
    include: [
      'apps/web/**/*.test.ts',
      'apps/dispatch/**/*.test.ts',
      'apps/sa-map-viewer/**/*.test.ts',
      'apps/cutscene-converter/**/*.test.ts',
      'packages/**/*.test.ts',
      'tools/opensa-pack/**/*.test.ts',
      'tools/timecyc-builder/**/*.test.ts',
      'scripts/**/*.test.ts',
      'tools/map-optimizer/**/*.test.ts',
      'tools/opensa-lod-generator/**/*.test.ts',
      'tools/vehicle-optimizer/**/*.test.ts',
      'tools/tool-kit/**/*.test.ts',
      'tools/rw-codec/**/*.test.ts',
      'tools/lod-trees-generator/**/*.test.ts',
      'tools/map-placement/**/*.test.ts',
      'tools/lod-common/**/*.test.ts',
      'tools/sa-lod-generator/**/*.test.ts',
      'tools/sa-procobj-placement/**/*.test.ts',
      'tools/mod-installer/**/*.test.ts',
      'tools/img-splitter/**/*.test.ts',
      'tools/fetch-pack/**/*.test.ts',
      'tools/vehicle-installer/**/*.test.ts',
      'tools/add-vehicles/**/*.test.ts',
      'tools/vehicle-cutscene/**/*.test.ts',
      'tools/ped-installer/**/*.test.ts',
      'tools/perfect-map-builder/**/*.test.ts',
      'tools-debug/sa-int16-repro/**/*.test.ts',
      // Plain .js on purpose: the panel must boot on `node` alone, since its first job is to report a tree
      // too broken to run TypeScript (tools-debug/phone-console).
      'tools-debug/phone-console/**/*.test.mjs',
      'asi/**/*.test.ts',
      'cleo/**/*.test.ts',
    ],
  },
});
