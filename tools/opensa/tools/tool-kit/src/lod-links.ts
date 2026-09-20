import type { IplInstance } from '@opensa/renderware/parsers/text/types';

import { datChildUrl, iplBasename } from '@opensa/renderware/archive/resolve-paths';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { openArchiveIndex } from './archive/layout';

/**
 * **Does every LOD link still point at its own LOD?**
 *
 * A text IPL's `lod` field is a ROW INDEX into the area's `inst` section, and the area's binary streams index
 * into that same space — so a stage that drops or inserts a row silently re-points every link past it at a
 * different, perfectly valid row. Nothing else in the build can see that: the row counts stay plausible, every
 * row stays well-formed, and the game simply draws no LOD (or an unrelated one) where the map was authored to
 * have one. `docs/open-issues/ipl-row-removal-breaks-lod-links.md` is the field report that cost a session.
 *
 * The test is POSITIONAL because a LOD stands where its owner stands — the one invariant that needs neither a
 * baseline tree nor a naming convention. Stock SA holds it for 6 095 of its 6 103 links to within a metre; the
 * eight it breaks are shared LODs covering a CLUSTER of buildings, and those are named in {@link SHARED_LODS}
 * rather than papered over with a bigger radius. What it does NOT catch: a shift that lands the link on a row
 * within the radius — still wrong, still invisible here. Nothing cheap catches that, so the radius is the
 * floor of what this guarantees, not the whole class.
 */

/** Owner→target model pairs stock itself places far apart — one LOD standing in for a cluster. Lowercased. */
const SHARED_LODS: ReadonlySet<string> = new Set([
  'conhoos2|lod_conhoos3',
  'conhoos4|lod_conhoos3',
  'conhoos5|lod_conhoos3',
  'gard_sfw01|lodxbld4_sfw73',
  'laxrf_cargotop|lodcargoshp03d',
  'mall_03_sfs|lod_sfs014roof',
  'projects01_lax|lodjects01_lax',
  'traintrax01c_sfs|lod_trax_sfse10',
]);

/** How far a LOD may sit from its owner (XY, game units) before the link counts as broken. */
export const LOD_LINK_MAX_DISTANCE = 20;

/** One resolved link: who points where, and how far apart the two ended up. */
export interface LodLink {
  /** XY distance owner→target in game units; `Infinity` when the index resolves to nothing. */
  readonly distance: number;
  /** The IPL the OWNER came from — a text file name, or a `<area>_streamN.ipl` archive entry. */
  readonly from: string;
  /** The `lod` cell's value: the target's row index in the area's text IPL. */
  readonly lod: number;
  readonly ownerModel: string;
  readonly ownerPosition: readonly number[];
  /** Absent when the index is past the end of the area's `inst` section. */
  readonly targetModel?: string;
  readonly targetPosition?: readonly number[];
}

export interface LodLinkReport {
  /** Links whose target sits farther than {@link LOD_LINK_MAX_DISTANCE} from the owner, worst first. */
  readonly broken: LodLink[];
  /** How many links were resolved. */
  readonly checked: number;
  /** Links whose index is past the end of the area's `inst` section — always a defect. */
  readonly outOfRange: LodLink[];
}

/** What the check needs of an owner row — a text `inst` row or a stream record with its model name attached. */
interface LinkOwner {
  lod: number;
  modelName: string;
  position: readonly number[];
}

/** Resolve every `lod` link in a game tree: its text IPLs and the binary streams in its `models/*.img`. */
export function checkLodLinks(gameDir: string): LodLinkReport {
  const dat = parseGtaDat(readFileSync(join(gameDir, 'data', 'gta.dat'), 'utf8'));
  const modelOf = readCatalog(gameDir, dat.ide);
  const areas = readAreas(gameDir, dat.ipl);
  const index = openArchiveIndex(gameDir);
  const broken: LodLink[] = [];
  const outOfRange: LodLink[] = [];
  let checked = 0;

  for (const [area, { file, rows }] of areas) {
    for (const [from, owners] of [[file, rows] as const, ...streamsOf(index, area, modelOf)]) {
      for (const owner of owners) {
        if (owner.lod < 0) {
          continue;
        }
        checked += 1;
        const link = resolveLink(from, owner, rows[owner.lod]);
        if (link) {
          (link.targetModel === undefined ? outOfRange : broken).push(link);
        }
      }
    }
  }
  broken.sort((a, b) => b.distance - a.distance);

  return { broken, checked, outOfRange };
}

/** One line per link, for a guard's error text or a script's output. */
export function formatLodLink(link: LodLink): string {
  const at = (position: readonly number[]): string => position.map((value) => value.toFixed(1)).join(', ');
  const target =
    link.targetModel && link.targetPosition
      ? `${link.targetModel} @ (${at(link.targetPosition)}), ${link.distance.toFixed(1)} u away`
      : 'nothing — the index is past the end of the section';

  return `${link.ownerModel} @ (${at(link.ownerPosition)}) [${link.from}] lod=${link.lod} → ${target}`;
}

/** Area key shared by a text IPL and its streams: `countrye.ipl` & `countrye_stream3.ipl` → `countrye`. */
function areaKey(name: string): string {
  return (name.split(/[\\/]/).pop() ?? name)
    .replace(/_stream\d+\.ipl$/i, '')
    .replace(/\.ipl$/i, '')
    .toLowerCase();
}

/** The `inst` rows of every text IPL the gta.dat lists, keyed by area — the index space every link points into. */
function readAreas(gameDir: string, iplPaths: readonly string[]): Map<string, { file: string; rows: IplInstance[] }> {
  const areas = new Map<string, { file: string; rows: IplInstance[] }>();
  for (const iplPath of iplPaths) {
    const file = datChildUrl(gameDir, iplPath);
    if (iplPath.toLowerCase().endsWith('.zon') || !existsSync(file)) {
      continue;
    }
    const name = `${iplBasename(iplPath)}.ipl`;
    areas.set(areaKey(name), { file: name, rows: parseIpl(readFileSync(file, 'utf8')) });
  }

  return areas;
}

/** Model names by id, from every IDE the gta.dat lists — the binary streams carry ids only. */
function readCatalog(gameDir: string, idePaths: readonly string[]): Map<number, string> {
  const names = new Map<number, string>();
  for (const idePath of idePaths) {
    const file = datChildUrl(gameDir, idePath);
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      names.set(def.id, def.modelName);
    }
  }

  return names;
}

/** The link as a finding, or null when it resolves to a target close enough to be its owner's own LOD. */
function resolveLink(from: string, owner: LinkOwner, target: IplInstance | undefined): LodLink | null {
  const base = { from, lod: owner.lod, ownerModel: owner.modelName, ownerPosition: owner.position };
  if (!target) {
    return { ...base, distance: Infinity };
  }
  const distance = Math.hypot(owner.position[0] - target.position[0], owner.position[1] - target.position[1]);
  if (distance <= LOD_LINK_MAX_DISTANCE) {
    return null;
  }
  if (SHARED_LODS.has(`${owner.modelName.toLowerCase()}|${target.modelName.toLowerCase()}`)) {
    return null;
  }

  return { ...base, distance, targetModel: target.modelName, targetPosition: target.position };
}

/** The area's binary streams, each record carrying the model name its id resolves to. */
function streamsOf(
  index: { get: (name: string) => ArrayBuffer | null; names: string[] },
  area: string,
  modelOf: ReadonlyMap<number, string>,
): [string, LinkOwner[]][] {
  const streams: [string, LinkOwner[]][] = [];
  for (const entry of index.names) {
    const buffer = /_stream\d+\.ipl$/i.test(entry) && areaKey(entry) === area ? index.get(entry) : null;
    if (buffer) {
      streams.push([
        entry,
        parseBinaryIpl(buffer).map((inst) => ({ ...inst, modelName: modelOf.get(inst.id) ?? `id ${inst.id}` })),
      ]);
    }
  }

  return streams;
}
