/**
 * Dev loop: a Vite server for the renderer, one esbuild pass for the main process, then Electron pointed at
 * the server. Restarting Electron re-runs this script — the main bundle is small enough that watching it
 * would buy less than it costs in moving parts.
 */
import electron from 'electron';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { createServer } from 'vite';

import { DEV_SERVER_URL_ENV } from '../src/shared/app-info';
import { buildMain } from './main-bundle';

// In a plain Node process (not Electron's) the module resolves to the executable's PATH, not the API.
const ELECTRON_BIN = electron as unknown as string;
const APP_DIR = dirname(import.meta.dirname);

async function main(): Promise<void> {
  const server = await createServer({ configFile: `${APP_DIR}/vite.config.ts` });
  await server.listen();

  const url = server.resolvedUrls?.local[0];

  if (!url) {
    throw new Error('cutscene-converter: the vite dev server reported no local url');
  }

  await buildMain();

  const child = spawn(ELECTRON_BIN, [APP_DIR], {
    env: { ...process.env, [DEV_SERVER_URL_ENV]: url },
    stdio: 'inherit',
  });

  child.on('close', () => {
    void server.close().then(() => process.exit(0));
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
