import { zipSync } from 'fflate';
/** Include the existing recorder build in a published site; no game assets or toolchains. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = path.resolve(process.argv[2] ?? path.join(root, 'tools/opensa/dist-flight'));
const inputs = {
  'FlightRecorder.asi': path.join(root, 'recorder/build/FlightRecorder.asi'),
  '安装说明.txt': path.join(root, 'recorder/INSTALL.zh-CN.txt'),
};
if (Object.values(inputs).some((file) => !existsSync(file))) {
  console.log(
    'Recorder build missing; guide will display package-unavailable notice. Build recorder and rebuild site to include it.',
  );
} else {
  const entries = Object.fromEntries(Object.entries(inputs).map(([name, file]) => [name, readFileSync(file)]));
  // A fixed ZIP timestamp keeps identical recorder builds byte-identical across site builds.
  const bytes = zipSync(entries, { level: 9, mtime: new Date('2026-01-01T00:00:00Z') });
  const directory = path.join(dist, 'downloads');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'GTASA-FlightRecorder-v13.zip'), bytes);
  writeFileSync(
    path.join(directory, 'recorder-package.json'),
    JSON.stringify({
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      version: 13,
    }) + '\n',
  );
  console.log(`Recorder client package: ${bytes.length} bytes (2 files, CSV only)`);
}
