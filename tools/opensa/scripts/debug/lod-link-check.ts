import { checkLodLinks, formatLodLink, LOD_LINK_MAX_DISTANCE } from '@opensa/tool-kit/lod-links';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { positionalArgs } from '../lib/game';

/**
 * **Does every LOD link still point at its own LOD?** Resolves every `lod` field in a game tree — text IPLs
 * and the binary streams inside `models/*.img` — and prints the ones whose target does not stand where its
 * owner stands. A link is a ROW INDEX, so any stage that drops or inserts an `inst` row re-points every link
 * past it at another valid row: no error, no missing file, just a building with no LOD (see
 * `docs/open-issues/ipl-row-removal-breaks-lod-links.md`, which is what this script was written for).
 *
 * Point it at a BUILT tree — the one a field run reads — and compare against the source tree to tell an
 * inherited quirk from something the build did:
 *
 *   npx tsx scripts/debug/lod-link-check.ts build/original/sa
 *   npx tsx scripts/debug/lod-link-check.ts game-src/original      # the baseline: 6 103 links, 0 broken
 *
 * The same check runs as a build guard on the finished `sa` tree (`perfect-map-builder`), so a fresh break
 * fails the build rather than reaching the field.
 */
const [dirArg, limitArg] = positionalArgs();
const root = dirArg ?? join('build', 'original', 'sa');
const limit = Number(limitArg ?? 40);
if (!existsSync(join(root, 'data', 'gta.dat'))) {
  console.error(`no data/gta.dat under ${root}`);
  console.error('usage: npx tsx scripts/debug/lod-link-check.ts [<game-dir>] [<max-lines>]');
  process.exit(1);
}

const report = checkLodLinks(root);
const bad = [...report.outOfRange, ...report.broken];
console.log(
  `${root}: ${report.checked} lod links · ${report.outOfRange.length} out of range · ` +
    `${report.broken.length} farther than ${LOD_LINK_MAX_DISTANCE} u from their owner`,
);
for (const link of bad.slice(0, limit)) {
  console.log(`  ${formatLodLink(link)}`);
}
if (bad.length > limit) {
  console.log(`  … and ${bad.length - limit} more (pass a larger <max-lines> to see them)`);
}
