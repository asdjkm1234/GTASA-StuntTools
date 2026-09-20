/**
 * The ONE declared 2dfx carry-policy for LOD representations (plan 005). Before this, the
 * keep-set was spelled three times in three shapes — a corona survived all three paths, a roadsign two, an
 * undecoded type one, by accident rather than by decision.
 *
 * The policy says WHETHER a type rides onto a LOD, never what happens to its payload: `extract2dfxEntries` /
 * `build2dfxSection` keep their byte-verbatim contract and the spatial rewrite is `transform2dfxEntry`'s job.
 *
 * It is keyed by **target**, not by generator, because what decides the verdict is the host the output feeds:
 * `clone` is a per-object far copy for real SA (`sa-lod-generator`), `cell` is a baked cell for the OpenSA
 * engine (`opensa-lod-generator`). The living write-up, with the reasoning per row, is
 * `tools/lod-common/docs/2dfx-policy.md`.
 */

/** One row of the policy: a 2dfx entry type and its verdict per target. */
export interface Lod2dfxRule {
  cell: Lod2dfxVerdict;
  clone: Lod2dfxVerdict;
  /** gtamods' name for the type, for readable diagnostics. */
  name: string;
  /** Which space the entry's authored position is written in — see {@link Lod2dfxSpace}. */
  space: Lod2dfxSpace;
  type: number;
  /** Why the verdicts are what they are — the half of this table that is worth having. */
  why: string;
}

/**
 * The space a type's authored position is written in, measured over the stock corpus by
 * `scripts/debug/two-dfx-space.ts`. It decides WHICH transform a carry applies, which is a different question
 * from whether the entry rides at all: a `world` entry re-based by an instance transform lands a kilometre
 * from its post, and that is the failure plan 100's dead first attempt would have shipped.
 */
export type Lod2dfxSpace = 'model' | 'world';

/** Which host the LOD is being built for — see the module note on why this is not keyed by generator. */
export type Lod2dfxTarget = 'cell' | 'clone';

/**
 * What happens to a type on that target. `carry-rate-scaled` is `carry` until plan 07's `lod-common/03` implements the
 * thinning — it is recorded now so the intent is not lost in a generator's flag.
 */
export type Lod2dfxVerdict = 'carry' | 'carry-rate-scaled' | 'drop';

/**
 * A type with no row is DROPPED on every target. The stock corpus carries only the eight types below
 * (`scripts/debug/two-dfx-census.ts`), so this fallback changes nothing there — it is the rule for a type a
 * mod invents or Rockstar used somewhere we have not looked, and dropping an unknown effect at LOD range is
 * the conservative half of that trade.
 */
export const LOD_2DFX_UNLISTED: Lod2dfxVerdict = 'drop';

/**
 * The space assumed for a type with no row. Moot in practice — an unlisted type is
 * {@link LOD_2DFX_UNLISTED} on every target, so nothing carries it far enough to transform — but `model` is
 * the conservative reading: it keeps an unknown entry attached to the instance it was authored on.
 */
export const LOD_2DFX_UNLISTED_SPACE: Lod2dfxSpace = 'model';

/**
 * The policy. Entry counts in the `why` column are stock `original`, from `scripts/debug/two-dfx-census.ts`;
 * the `space` column is measured by `scripts/debug/two-dfx-space.ts` and is unanimous per type.
 */
export const LOD_2DFX_POLICY: readonly Lod2dfxRule[] = [
  {
    cell: 'carry',
    clone: 'carry',
    name: 'light',
    space: 'model',
    type: 0,
    why: 'Distant night city lights are why 2dfx rides a LOD at all (2203 entries / 327 models). The first type a baked cell ever carried.',
  },
  {
    cell: 'carry',
    clone: 'carry-rate-scaled',
    name: 'particle',
    space: 'model',
    type: 1,
    why: 'A chimney whose factory draws to 1000 u and whose plume stops at the HD boundary is the defect plan 100 exists to fix (64 / 43). `--strip-particles` stays the stock-target opt-out; how MANY a far view may run is the rate budget plan 07 owns.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'ped attractor',
    space: 'model',
    type: 3,
    why: 'Carried because the clone paths carry it today (916 / 266); nothing in our engine reads a ped attractor at any range, so `cell` has nothing to feed. A candidate for the first MEASURED clone-side drop, not an argued one.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'enter/exit',
    space: 'model',
    type: 6,
    why: 'As type 3 (78 / 71) — an interior marker on a far copy does nothing, but dropping it is a behaviour change that has to be measured by the generator plan, not assumed here.',
  },
  {
    cell: 'carry',
    clone: 'carry',
    name: 'roadsign',
    space: 'world',
    type: 7,
    why: 'The visible win of the whole chain (489 / 207): street-name text used to stop at the HD boundary and leave a blank plate out to 1000 u. Its position is WORLD (489/489), so a cell re-bases it by the cell origin and never by the instance transform.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'trigger point',
    space: 'model',
    type: 8,
    why: 'As type 3, and the rarest of them (33 / 7) — a trigger a far copy has no way to fire.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'cover point',
    space: 'model',
    type: 9,
    why: 'As type 3, and the bulk of the corpus by count (15 007 / 1210) — whatever it costs to carry, it costs it 15 000 times.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'escalator',
    space: 'model',
    type: 10,
    why: 'Five entries in four models, so it will never move an aggregate — verify it by looking at those four. `cell` stays `drop`, and NOT for a distance reason: our engine has no escalator code at all, so there is nothing to read one (plan 101 builds it).',
  },
];

const BY_TYPE = new Map(LOD_2DFX_POLICY.map((rule) => [rule.type, rule]));

/**
 * The entry types a target carries — the set `extract2dfxEntries` / `collectClumpEffects` filter by. A
 * `carry-rate-scaled` type is in the set: the scaling is applied to its payload, not to whether it rides.
 */
export function keepTypesFor(target: Lod2dfxTarget): ReadonlySet<number> {
  return new Set(LOD_2DFX_POLICY.filter((rule) => rule[target] !== 'drop').map((rule) => rule.type));
}

/**
 * The space one entry type's position is authored in — {@link LOD_2DFX_UNLISTED_SPACE} when the type has no
 * row. A carrier branches on THIS, not on the type, so a type declared later inherits the right transform.
 */
export function spaceOf(type: number): Lod2dfxSpace {
  return BY_TYPE.get(type)?.space ?? LOD_2DFX_UNLISTED_SPACE;
}

/** The verdict for one entry type on one target — {@link LOD_2DFX_UNLISTED} when the type has no row. */
export function verdictFor(type: number, target: Lod2dfxTarget): Lod2dfxVerdict {
  return BY_TYPE.get(type)?.[target] ?? LOD_2DFX_UNLISTED;
}
