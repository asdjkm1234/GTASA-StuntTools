/**
 * Emit `src/generated/patches.hpp` from [catalogue.ts](./catalogue.ts) via the SDK's renderer
 * (`@opensa/asi-sdk/render`). Run: `npm run gen -w @opensa/perfect-map-asi`. The C++ framework never
 * hard-codes an address; it reads these tables. A malformed catalogue is a hard error here (generate
 * time), not a garbage write at runtime.
 */

import { renderHeader } from '@opensa/asi-sdk/render';
import { SA_FINGERPRINT } from '@opensa/asi-sdk/sa-fingerprint';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CATALOGUE } from './catalogue';

function main(): void {
  const out = join(import.meta.dirname, '..', 'src', 'generated', 'patches.hpp');
  writeFileSync(out, renderHeader(CATALOGUE, SA_FINGERPRINT, { namespace: 'pm' }));
  console.log(`generated ${out} (${CATALOGUE.length} entries, ${SA_FINGERPRINT.anchors.length} fingerprint anchors)`);
}

if (import.meta.filename === process.argv[1]) {
  main();
}
