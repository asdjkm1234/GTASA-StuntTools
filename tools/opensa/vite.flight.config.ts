// Focused build: only the flight replay entry, so building it does not depend on the other viewers.
// Workspace packages (`@opensa/*`) resolve through npm workspaces + their package.json exports, exactly as
// they do for the main `vite.config.ts` build.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: 'dist-flight',
    rollupOptions: {
      input: { flightReplay: resolve(__dirname, 'flight-replay.html') },
    },
    target: 'es2022',
  },
  define: {
    __APP_BUILD__: JSON.stringify('flight-replay'),
    __APP_VERSION__: JSON.stringify('0.4.0'),
    __DEBUGGER_HIDE__: JSON.stringify(true),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  logLevel: 'info',
});
