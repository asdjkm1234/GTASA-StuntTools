import { DISTRICTS, PINNED_DISTRICT } from '../apps/dispatch/src/world/districts';

/**
 * The measurement district's numbers, for a shell script to read.
 *
 * `npm run phone` needs a pak rect and a spawn; the console needs an opening point; the inventory report
 * needs the district's NAME. Until they came from one table they could disagree, and one of them did: the
 * first real mobile capture was taken on Ganton while 201/1-01's pinned district is the centre of Los
 * Santos, which nothing said until the row was being filed. This is that table, read out loud.
 *
 * Run: `npx tsx scripts/district.ts [name]` — with no name, lists what there is and which one is pinned.
 * With one, prints `RECT SPAWN AT` on a single line, for `read` to split.
 */
const name = process.argv[2];

if (name === undefined) {
  for (const [key, district] of Object.entries(DISTRICTS)) {
    const pin = key === PINNED_DISTRICT ? ' (PINNED by 201/1-01)' : '';
    console.log(
      `${key}${pin}\n  rect ${district.cells.join(',')} · opens at ${district.at.join(',')}\n  ${district.note}`,
    );
  }
  process.exit(0);
}

const district = DISTRICTS[name];
if (!district) {
  console.error(`unknown district '${name}' — known: ${Object.keys(DISTRICTS).join(', ')}`);
  process.exit(1);
}

console.log(`${district.cells.join(',')} ${district.spawn.join(',')} ${district.at.join(',')}`);
