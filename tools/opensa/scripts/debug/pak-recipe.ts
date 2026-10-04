import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What is this pak, and is it the one being asked for? (201 chain 2 / the phone workflow.)
 *
 * A pak costs minutes to hours on a phone, so it is built once and reused for dozens of runs — and the
 * failure that makes reuse dangerous is silent: asking for a different rect, or the other side of the
 * collision A/B, while a pak already sits in the output folder gets the OLD one served, with nothing on
 * screen or in the log saying so. `report.json`'s `build` block (written since opensa-pack recorded its
 * recipe) is what makes the folder answerable, and this script is how it is read back.
 *
 * Run: `npx tsx scripts/debug/pak-recipe.ts <pakDir> [--expect key=value ...]`
 *
 * With no `--expect` it prints the recipe. With them it compares and exits 1 on the first difference, naming
 * both sides — which is what `npm run phone` gates on. A pak built before recipes were recorded has no block
 * to check: that is reported, and does NOT fail, so an existing pak keeps working.
 */
const args = process.argv.slice(2);
const expectations = new Map<string, string>();
const rest: string[] = [];

for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === '--expect') {
    const pair = args[index + 1] ?? '';
    const eq = pair.indexOf('=');
    if (eq < 1) {
      console.error(`bad --expect '${pair}' (want key=value)`);
      process.exit(2);
    }
    expectations.set(pair.slice(0, eq), pair.slice(eq + 1));
    index += 1;
  } else {
    rest.push(value);
  }
}

const pakDir = rest[0] ?? 'build/phone/pak';
const reportPath = join(pakDir, 'report.json');

if (!existsSync(reportPath)) {
  console.error(`no ${reportPath} — is ${pakDir} a pak directory?`);
  process.exit(2);
}

interface Recipe {
  ao?: boolean;
  appVersion?: null | string;
  at?: string;
  bakeCollision?: boolean;
  commit?: null | string;
  game?: string;
  /** Since 2026-08-27 (201/6-01). A pak built before it always carried both tiers, so its absence reads
   *  `false` rather than "not recorded" — see the `shown` row below for why that distinction is load-bearing. */
  lodOnly?: boolean;
  mapObjectsInRect?: boolean;
  maxTexture?: number;
  models?: boolean;
  peds?: null | string[];
  platforms?: null | string[];
  rect?: null | number[];
  rgba8?: boolean;
  /** Since 2026-08-08. A pak built before it carries only `rgba8`, which cannot tell ASTC from BC — both
   *  record false — so the fallback below reads what that boolean COULD say and nothing more. */
  textures?: string;
  vehicles?: null | string[];
}

const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { build?: Recipe };
const build = report.build;

if (build === undefined) {
  console.log(`${pakDir}: built before recipes were recorded — cannot say which rect or flags made it.`);
  console.log('REBUILD=1 npm run phone makes it self-describing (a phone convert is minutes to hours).');
  process.exit(0);
}

/** The keys whose value is a SET of names: the same subset in a different order is the same pak, so both
 *  sides are sorted before comparing. `rect` is NOT one of them — its four numbers are positional, and
 *  sorting them would make two different districts compare equal. */
const SET_KEYS = new Set(['peds', 'platforms', 'vehicles']);

/** `null` = everything, which is what `all` means on the command line. */
const norm = (key: string, value: boolean | null | number | readonly string[] | string | undefined): string => {
  if (value === null || value === undefined) {
    return key === 'rect' ? 'auto' : 'all';
  }
  const text = Array.isArray(value) ? value.join(',') : String(value);

  return SET_KEYS.has(key) && text !== 'all' ? text.split(',').sort().join(',') : text;
};

const shown: [string, string][] = [
  ['rect', norm('rect', build.rect ? build.rect.join(',') : null)],
  // An older pak has no `textures`, and `rgba8` is the only thing it can be derived from. Deriving it beats
  // reporting "not recorded": `npm run phone` gates reuse on this key, and a pak that cannot answer it would
  // be refused on every run — including the district convert that costs hours.
  ['textures', norm('textures', build.textures ?? (build.rgba8 === true ? 'rgba8' : 'bc'))],
  ['rgba8', norm('rgba8', build.rgba8)],
  // Derived when absent, for the same reason `textures` is: `npm run phone` expects this key on EVERY run
  // (`scripts/phone.sh`), so a pak that cannot answer it is refused always rather than never — which is what
  // happened between 2026-08-27 and 2026-08-28, when the recipe field landed and this list did not grow with
  // it. A pak built before `--lod-only` existed carried both tiers by construction, so `false` is a fact.
  ['lodOnly', norm('lodOnly', build.lodOnly ?? false)],
  ['maxTexture', norm('maxTexture', build.maxTexture)],
  ['mapObjectsInRect', norm('mapObjectsInRect', build.mapObjectsInRect)],
  ['bakeCollision', norm('bakeCollision', build.bakeCollision)],
  ['ao', norm('ao', build.ao)],
  ['models', norm('models', build.models)],
  ['vehicles', norm('vehicles', build.vehicles)],
  ['peds', norm('peds', build.peds)],
  ['platforms', norm('platforms', build.platforms)],
];

if (expectations.size === 0) {
  console.log(`${pakDir} — ${build.game ?? '?'} · built ${build.at ?? '?'}${build.commit ? ` · ${build.commit}` : ''}`);
  for (const [key, value] of shown) {
    console.log(`  ${key.padEnd(14)} ${value}`);
  }
  process.exit(0);
}

/**
 * The `npm run phone` knob that sets each recipe key, so a mismatch can say how to ASK for what the pak is.
 *
 * Without it the message named the difference and left the reader to remember which env var moves it — which
 * cost a round-trip on 2026-08-09, when a pak built `rgba8` was asked for as `astc` (the default) and the
 * answer was one variable nobody was reminded of.
 */
const KNOBS: Readonly<Record<string, string>> = {
  bakeCollision: 'BAKE',
  lodOnly: 'LODONLY',
  mapObjectsInRect: 'MAPOBJ',
  models: 'MODELS',
  peds: 'PEDS',
  rect: 'RECT',
  textures: 'TEXTURES',
  vehicles: 'VEHICLES',
};

const actual = new Map(shown);
const differences: string[] = [];
/** `KNOB=value` for every difference whose key has one — the command that would match this pak. */
const asks: string[] = [];

for (const [key, want] of expectations) {
  const got = actual.get(key);
  if (got === undefined) {
    differences.push(`  ${key}: not recorded in this pak`);
  } else if (norm(key, want) !== got) {
    differences.push(`  ${key}: pak has ${got}, asked for ${norm(key, want)}`);
    const knob = KNOBS[key];
    if (knob) {
      // `bakeCollision` and `lodOnly` read true/false in the recipe and 1/0 on the command line.
      const isBooleanKnob = key === 'bakeCollision' || key === 'lodOnly';
      asks.push(`${knob}=${isBooleanKnob ? (got === 'true' ? '1' : '0') : got}`);
    }
  }
}

if (differences.length > 0) {
  console.error(`the pak in ${pakDir} is not the one being asked for:`);
  for (const line of differences) {
    console.error(line);
  }
  if (asks.length > 0) {
    console.error('');
    console.error(`to ask for the pak that IS here: ${asks.join(' ')} npm run phone`);
  }
  process.exit(1);
}

// `textures` and `models` are on this line because they are the two the operator cannot see any other way
// and the two that silently make a reused pak the wrong one. 2026-08-25: a run that believed it was serving
// an rgba8 build reused an ASTC pak from a fortnight earlier, and this line — which named the game, the rect
// and the collision side — said "matches the request" without ever printing the format. It matched, correctly;
// it just did not say what it matched AS, and the texture budget that would have shown it prints further up
// where a long convert's output has already scrolled it away.
console.log(
  `pak matches the request — ${build.game ?? '?'} · rect ${actual.get('rect')} · ` +
    `textures=${actual.get('textures')} · models=${actual.get('models')} · ` +
    `bake-collision=${actual.get('bakeCollision')} · built ${build.at ?? '?'}${build.commit ? ` · ${build.commit}` : ''}`,
);
