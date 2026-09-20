import { cleanLines, sectionedParse } from '@opensa/renderware/parsers/text/text-lines';

/**
 * Which archive an entry belongs in. `map` is both a bucket and the FALLBACK — it keeps `gta3.img`, the
 * archive the game loads unconditionally, so anything we cannot place confidently still loads exactly as it
 * does today.
 */
export type Bucket = 'map' | 'peds' | 'vehicles' | 'weapons';

/** One IDE row's claim on an archive entry: `admiral.dff` / `admiral.txd` → `vehicles`. */
export interface Claim {
  bucket: Bucket;
  /** Lowercased entry name WITH extension, as it appears in the archive directory. */
  name: string;
}

export interface Classification {
  /** Lowercased entry name → the archive it goes to. Every input entry appears exactly once. */
  bucketOf: Map<string, Bucket>;
  /** Entries two different buckets claimed — resolved to `map`, listed so the ambiguity is visible. */
  contested: string[];
  /** Entries no IDE row claimed — resolved to `map`. A growing list is how a classifier goes wrong quietly. */
  unclaimed: string[];
}

/**
 * The IDE sections that declare a MODEL, and the bucket each one implies.
 *
 * **This is the whole rule, and it is authored data rather than a roster in our code**
 * (`docs/restrictions/assets-and-data.md`): a model's bucket is decided by the section its own IDE row sits
 * in, so a mod that adds a car to `cars` gets the vehicle bucket without anything here changing.
 *
 * Sections deliberately absent: `txdp` declares a texture PARENT relationship rather than a model, `2dfx`
 * attaches an effect to a model already declared elsewhere, and `path` places nothing.
 *
 * **`weap` is the source for weapons, not `weapon.dat`** — that file is the stats table and addresses a
 * weapon by numeric `modelId`, so reading it would mean resolving those ids back through this very section.
 */
const SECTION_BUCKET: Readonly<Record<string, Bucket>> = {
  anim: 'map',
  cars: 'vehicles',
  hier: 'map',
  objs: 'map',
  peds: 'peds',
  tobj: 'map',
  weap: 'weapons',
};

/**
 * The IDE files whose every row is a VEHICLE row, whatever section it sits in.
 *
 * `veh_mods.ide` declares the mod shop's upgrade parts as plain `objs` rows — authored as objects, owned by
 * the car they bolt onto. The file they are in is what says so, and it is a better answer than the one this
 * used to ask `carmods.dat` for: a part on no `mods` line, in no `link` pair and in no `wheel` row was
 * classified as MAP, and `slamvan`'s two bonnets (`bnt_lr_slv1`/`2`, the only stock parts no shop offers)
 * are exactly that — they claimed the slamvan's own dictionary for the map bucket, it stayed in `gta3.img`
 * as CONTESTED, and the mod's copy in the vehicle archive lost to it: a car with no textures at all
 * (`docs/open-issues/mod-file-shadowed-by-its-stock-twin.md`, plan 103).
 */
const VEHICLE_IDE_FILES: readonly string[] = ['vehicles.ide', 'veh_mods.ide'];

/** Every model name the `cars` section of a roster declares, lowercased — {@link paintjobClaims}' input. */
export function carModels(text: string): Set<string> {
  const cars = new Set<string>();
  sectionedParse(cleanLines(text), {
    cars: (row): void => {
      const model = row[1]?.toLowerCase();
      if (model) {
        cars.add(model);
      }
    },
  });

  return cars;
}

/**
 * Read one IDE file's claims. Every model-declaring section shares the same first two columns — `id, model,
 * txd, …` — so one row shape covers all of them, and a row that is missing either name contributes nothing
 * rather than claiming an empty string.
 *
 * `bucket` overrides the section's own answer — see {@link isVehicleIde}.
 */
export function claimsFromIde(text: string, bucket?: Bucket): Claim[] {
  const claims: Claim[] = [];
  const handlers: Record<string, (row: string[]) => void> = {};
  for (const [section, sectionBucket] of Object.entries(SECTION_BUCKET)) {
    handlers[section] = (row): void => {
      const model = row[1]?.toLowerCase();
      const txd = row[2]?.toLowerCase();
      const rowBucket = bucket ?? sectionBucket;
      if (model) {
        claims.push({ bucket: rowBucket, name: `${model}.dff` });
      }
      if (txd) {
        claims.push({ bucket: rowBucket, name: `${txd}.txd` });
      }
    };
  }
  sectionedParse(cleanLines(text), handlers);

  return claims;
}

/**
 * Place every entry of an archive into a bucket.
 *
 * Two resolutions, and both are deliberate rather than defensive:
 *
 * - **Contested** (claimed by more than one bucket — a texture dictionary shared between a car and a map
 *   object, say) goes to `map`. It is safe because the game resolves an entry by NAME across every
 *   registered archive, so where a shared dictionary physically sits changes nothing about who can read it;
 *   the split is about file size and ownership, never about visibility.
 * - **Unclaimed** (`.col` / `.ipl` / `.ifp` / `.dat`, and any model no IDE declares) also stays in `map`,
 *   which is where it lives today. Both lists are returned rather than swallowed: the counts are the
 *   classifier's own error bars.
 */
export function classifyEntries(entries: readonly string[], claims: readonly Claim[]): Classification {
  const claimed = new Map<string, 'contested' | Bucket>();
  for (const { bucket, name } of claims) {
    const existing = claimed.get(name);
    claimed.set(name, existing === undefined || existing === bucket ? bucket : 'contested');
  }

  const bucketOf = new Map<string, Bucket>();
  const contested: string[] = [];
  const unclaimed: string[] = [];
  for (const entry of entries) {
    const name = entry.toLowerCase();
    const claim = claimed.get(name);
    if (claim === undefined) {
      unclaimed.push(name);
    } else if (claim === 'contested') {
      contested.push(name);
    }
    bucketOf.set(name, claim === undefined || claim === 'contested' ? 'map' : claim);
  }

  return { bucketOf, contested, unclaimed };
}

/** Whether an IDE path is one of {@link VEHICLE_IDE_FILES} — every row of it claims for `vehicles`. */
export function isVehicleIde(path: string): boolean {
  const file = path.toLowerCase().split(/[/\\]/).pop() ?? '';

  return VEHICLE_IDE_FILES.includes(file);
}

/**
 * A car's PAINTJOB dictionaries, claimed by name: `<car>1.txd`, `<car>2.txd`, … for every car the roster
 * knows. No IDE row names them — the game finds them by the convention alone — so without this all 36 of
 * the stock ones (13 cars: eleven with 3, `broadway` with 2, `camper` with 1) stay behind as UNCLAIMED
 * while the mod's copies go to the vehicle archive, and twelve cars quietly wear stock paintjobs.
 *
 * Derived from the entries the archive actually holds, so a mod that adds a fourth paintjob is claimed too.
 */
export function paintjobClaims(entries: readonly string[], cars: ReadonlySet<string>): Claim[] {
  const claims: Claim[] = [];
  for (const entry of entries) {
    const name = entry.toLowerCase();
    const car = /^([^.]*[^.\d])\d+\.txd$/.exec(name)?.[1];
    if (car !== undefined && cars.has(car)) {
      claims.push({ bucket: 'vehicles', name });
    }
  }

  return claims;
}
