import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ASI_NAME, requireAsi } from './asi-resource';

const OUT_DIR = join(dirname(import.meta.dirname), 'dist/asi');

try {
  const asi = requireAsi();
  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(asi.path, join(OUT_DIR, ASI_NAME));
  console.log(`cutscene-converter: embedded ${ASI_NAME} (${asi.bytes} B, sha1 ${asi.sha1})`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
