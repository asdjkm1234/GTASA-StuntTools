import { checkDefinitionOrder, formatLateDefinition } from '@opensa/tool-kit/dat-order';

/**
 * **Does any `inst` row of a tree place a model whose IDE `gta.dat` lists LATER?**
 *
 * The game reads `gta.dat` top to bottom, so such a row loads against an id that does not exist yet and is
 * refused — visible only with `modloader.asi` off, because modloader supplies the same mod IDEs itself, early.
 * The build guard (`assertDefinitionOrder`) fails on exactly this report; this script is how you look at a tree
 * without running a build, including one the guard has never seen.
 *
 * Usage: `npx tsx scripts/debug/dat-order-check.ts [<game-dir>…]` (default: the built `sa` tree and stock).
 * Stock reports zero, so any finding is ours.
 */
const dirs = process.argv.slice(2);

for (const dir of dirs.length > 0 ? dirs : ['build/original/sa', 'game-src/original']) {
  const report = checkDefinitionOrder(dir);
  const rows = report.late.reduce((sum, row) => sum + row.count, 0);
  console.log(
    `\n${dir}: ${report.checked} text inst rows — ${rows} placed before their definition (${report.late.length} ids)`,
  );
  for (const row of report.late) {
    console.log(`  ${formatLateDefinition(row)}`);
  }
}
