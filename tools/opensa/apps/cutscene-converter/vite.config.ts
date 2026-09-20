import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

import { readAsi, requireAsi } from './scripts/asi-resource';
import { readBuildStamp } from './scripts/build-stamp';

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

/**
 * The RENDERER build only. The main process is bundled by esbuild (`scripts/main-bundle.ts`) because it is
 * plain Node — the converter it forks has zero native dependencies, which is what makes this app cheap.
 *
 * `base: './'` matters: a packaged build loads `dist/renderer/index.html` over `file://`, where an
 * absolute `/assets/...` resolves to the filesystem root and the window comes up blank.
 */
export default defineConfig(({ command }) => {
  // A BUILD without the plugin is a shipped lie, so it fails here (see scripts/asi-resource.ts). A dev
  // server without it is just a tree where the mingw build has not been run — the about screen says so.
  const asi = command === 'build' ? requireAsi() : readAsi();

  return {
    base: './',
    build: { emptyOutDir: true, outDir: 'dist/renderer' },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __ASI_BYTES__: JSON.stringify(asi?.bytes ?? 0),
      __ASI_SHA1__: JSON.stringify(asi?.sha1 ?? ''),
      __BUILD_COMMIT__: JSON.stringify(readBuildStamp()),
    },
    plugins: [react()],
    root: import.meta.dirname,
  };
});
