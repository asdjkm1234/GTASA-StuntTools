import { fromCwd } from '@opensa/tool-kit/cli';
import { assertCarmodsModels } from '@opensa/vehicle-installer/tuning-parts';

/**
 * Does this game tree's `carmods.dat` name a model no IDE row defines? The real game crashes at boot on one
 * (`docs/gta-sa-original/carmods-unknown-part-crash.md`); the installer refuses to write one (plan 009). Run
 * this against a tree the installer did NOT write — the bottle, an older build — before booting it:
 *   npx tsx scripts/debug/carmods-check.ts build/original/sa
 *   npx tsx scripts/debug/carmods-check.ts "$HOME/Library/Application Support/CrossOver/Bottles/Win10/drive_c/GTA SA/GTA San Andreas"
 * Exit 1 with the offending lines, exit 0 with `ok`.
 */
const game = process.argv[2];
if (!game) throw new Error('usage: carmods-check.ts <game dir>');
try {
  assertCarmodsModels(fromCwd(game));
  console.log(`carmods-check: ok — every carmods.dat token of ${game} has an IDE row`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
