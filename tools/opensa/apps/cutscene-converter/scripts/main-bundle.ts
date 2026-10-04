import { build } from 'esbuild';
import { dirname, join } from 'node:path';

import { readBuildStamp } from './build-stamp';

const APP_DIR = dirname(import.meta.dirname);

/** `main` boots the window, `preload` is the bridge, `convert-child` IS the tool's CLI (forked per run). */
const ENTRIES = ['src/main/main.ts', 'src/main/preload.ts', 'src/main/convert-child.ts'];

/**
 * Bundle the Node halves into CommonJS. Electron's main runs as CJS, and the converter is pure JS
 * (`node:*` + `@opensa/*`, no native dependencies), so it inlines here with no rebuild-for-Electron step —
 * which is also why the packaged app ships no `node_modules` at all.
 */
export async function buildMain(): Promise<void> {
  await build({
    bundle: true,
    define: { __BUILD_COMMIT__: JSON.stringify(readBuildStamp()) },
    entryPoints: ENTRIES.map((entry) => join(APP_DIR, entry)),
    external: ['electron'],
    format: 'cjs',
    outdir: join(APP_DIR, 'dist/main'),
    outExtension: { '.js': '.cjs' },
    platform: 'node',
    sourcemap: true,
    target: 'node20',
  });
}
