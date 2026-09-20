/**
 * The plugin ships beside the three files the tool writes: a converted fleet without it loses its actors
 * behind car glass, so "the output folder" means all four or none.
 */
import { app } from 'electron';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

const ASI_NAME = 'perfect-cutscene.asi';

export function copyAsiInto(outPath: string): void {
  copyFileSync(asiSource(), join(outPath, ASI_NAME));
}

/** Packaged: beside the exe (electron-builder `extraResources`). Dev: what `npm run build:asi` produced. */
function asiSource(): string {
  return app.isPackaged ? join(process.resourcesPath, ASI_NAME) : join(__dirname, '..', 'asi', ASI_NAME);
}
