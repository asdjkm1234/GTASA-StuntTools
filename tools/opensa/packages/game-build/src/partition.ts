import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';

/** One file to pack: its bare lowercased name (`cj.dff`) + which img to read it from. */
export interface Entry {
  name: string;
  source: Source;
}

/** The four build groups (asset buckets) the build emits — the runtime loaders/VFS fetch + store by these. */
export type GroupName = 'data' | 'models' | 'others' | 'textures';

/** A placed model's dff + txd base names (lowercased, no extension) + its IDE draw distance. */
export interface ModelRef {
  /** The `anim` row's IFP name (lowercased) — set only for `anim` defs, whose DFF frame hierarchy PLACES their
   *  atomics (the engine's weld composes it; a plain `objs` clump ignores its frames). Absent otherwise. */
  anim?: string;
  /** The def's draw distance (world units; the max when the IDE row carries several) — 0 when absent. */
  drawDistance: number;
  model: string;
  txd: string;
}

/** The img-sourced output buckets (loose files are grouped separately by {@link looseGroup}). */
export interface Partition {
  /** Referenced `.dff` geometry + every `.col` collision (collision pairs with the geometry). */
  models: Entry[];
  /** Placement/anim/data world files (ipl/ifp/dat) — packed in the others group. */
  others: Entry[];
  /** Referenced `.txd` textures. */
  textures: Entry[];
}

/** Unique referenced model + txd base names (lowercased), placed in the map. */
export interface PlacedRefs {
  models: string[];
  txds: string[];
}

/** Which model archive a file's bytes come from: gta3.img (primary) or gta_int.img (override). */
export type Source = 'gta3' | 'gta_int';

/** Collision taken wholesale from the model archives into the models bucket (it pairs with the geometry). */
const MODEL_WORLD_EXTENSIONS = ['.col'] as const;

/** Placement/anim/data taken wholesale from the model archives into the others bucket. */
const OTHER_WORLD_EXTENSIONS = ['.ipl', '.ifp', '.dat'] as const;

/**
 * id → model/txd refs from one IDE's drawable, **placed** sections: `objs`/anim (`parseIde`) AND `tobj`
 * (`parseTimedObjects`). tobj (time-of-day) models — lit-window / neon night overlays — are placed like any
 * other but parsed separately, so the build must include them too; omitting them drops every tobj model from
 * the archive (they vanish in-game).
 */
export function ideRefs(ideText: string): Map<number, ModelRef> {
  const refs = new Map<number, ModelRef>();
  for (const def of [...parseIde(ideText), ...parseTimedObjects(ideText)]) {
    refs.set(def.id, {
      ...(def.anim !== undefined ? { anim: def.anim } : {}),
      drawDistance: def.drawDistance,
      model: def.modelName.toLowerCase(),
      txd: def.txdName.toLowerCase(),
    });
  }

  return refs;
}

/**
 * The group a loose file (keyed by its lowercased relative path) is packed into: everything under `data/`
 * goes to `data`; otherwise by extension — geometry → models, dictionaries → textures, the rest
 * (ifp/gxt) → others. `.osm`/`.ostex` are our optimized twins of `.dff`/`.txd` and belong in the same
 * groups (opensa-pack 003).
 */
export function looseGroup(name: string): GroupName {
  if (name.startsWith('data/')) {
    return 'data';
  }
  if (name.endsWith('.dff') || name.endsWith('.osm')) {
    return 'models';
  }
  if (name.endsWith('.txd') || name.endsWith('.ostex')) {
    return 'textures';
  }

  return 'others';
}

/**
 * Split img-sourced entries into three buckets:
 * - models: each referenced model as `.osm` if opensa-pack converted it, else `.dff` (gta3 → gta_int),
 *   plus every `.col` from gta3.img AND the override archives (a TC keeps its collision in its own img);
 * - others: every placement/anim/data file (ipl/ifp/dat) from the same archives;
 * - textures: the stock `.txd` of whatever stayed unoptimized (a converted model carries its dictionary
 *   inside its own `.osm`).
 *
 * Anything present in neither img is dropped. Missing OUR extensions here is the same class of bug as the
 * procobj miss (plans 19/20): a converted asset the local loader never ingests is a silent no-render, not
 * an error. Loose files are grouped by {@link looseGroup}.
 */
export function partitionEntries(refs: PlacedRefs, gta3: ReadonlySet<string>, gtaInt: ReadonlySet<string>): Partition {
  const models: Entry[] = [];
  const others: Entry[] = [];
  const textures: Entry[] = [];
  const seen = new Set<string>();
  /** Take one file into a bucket if either img holds it; false when it exists nowhere. */
  const take = (name: string, bucket: Entry[]): boolean => {
    if (seen.has(name)) {
      return true;
    }
    const source = resolveSource(name, gta3, gtaInt);
    if (!source) {
      return false;
    }
    bucket.push({ name, source });
    seen.add(name);

    return true;
  };

  for (const base of refs.models) {
    // Our optimized model first (opensa-pack 003). It carries its own dictionary in a `TEXS` section, so
    // unlike the stock pair it is a SINGLE entry — a VER2 name caps at 23 bytes and `<model>.ostex` did not
    // fit 457 of the ~14 900 stock models.
    if (!take(`${base}.osm`, models)) {
      take(`${base}.dff`, models);
    }
  }
  // The stock dictionaries for whatever stayed unoptimized. A converted model's `.txd` is gone from the
  // archives, so this simply finds nothing for it.
  for (const base of refs.txds) {
    take(`${base}.txd`, textures);
  }
  for (const name of gta3) {
    if (MODEL_WORLD_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      models.push({ name, source: 'gta3' });
    } else if (OTHER_WORLD_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      others.push({ name, source: 'gta3' });
    }
  }
  // The override archives carry the same world files for a TC — gostown keeps ALL its collision (53 .col
  // libraries) and binary IPL streams in gostown6.img, not gta3.img; sweeping only gta3 shipped a world
  // with no physics (plan 086 phase 4 field find). gta3 wins a name collision.
  for (const name of gtaInt) {
    if (gta3.has(name)) {
      continue;
    }
    if (MODEL_WORLD_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      models.push({ name, source: 'gta_int' });
    } else if (OTHER_WORLD_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      others.push({ name, source: 'gta_int' });
    }
  }

  return { models, others, textures };
}

/** Resolve placed instance ids to the unique set of referenced model + txd base names via the IDE id map. */
export function placedModels(instanceIds: Iterable<number>, ideById: ReadonlyMap<number, ModelRef>): PlacedRefs {
  const models = new Set<string>();
  const txds = new Set<string>();
  for (const id of instanceIds) {
    const ref = ideById.get(id);
    if (ref) {
      models.add(ref.model);
      txds.add(ref.txd);
    }
  }

  return { models: [...models], txds: [...txds] };
}

/** Where a bare file name lives: gta3.img first, then gta_int.img (override), else null (drop). */
export function resolveSource(name: string, gta3: ReadonlySet<string>, gtaInt: ReadonlySet<string>): null | Source {
  if (gta3.has(name)) {
    return 'gta3';
  }
  if (gtaInt.has(name)) {
    return 'gta_int';
  }

  return null;
}
