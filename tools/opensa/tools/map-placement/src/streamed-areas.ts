import { type BinaryIplInstance, encodeBinaryIpl } from './ipl-binary-write';

/** One HD instance + the LOD def attached at its transform — a row pair in a streamed area. */
export interface LinkedPair {
  /** HD instance — goes into the area's binary stream, `lod` linked to its LOD row. */
  readonly hd: {
    readonly id: number;
    readonly interior: number;
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
  };
  /** Default true: the LOD becomes a PERMANENT text row and the HD's `lod` field links to it (SA hides the
   *  LOD while the HD is streamed in — needed for tall models whose LOD would poke out of the HD). False:
   *  BOTH rows go into the binary stream unlinked (`lod` -1) — the LOD simply has the longer draw distance
   *  and hides inside the HD up close. Prefer false wherever the double-draw is invisible: every text row
   *  eats into SA's int16 building-pool index budget (`IplDef::firstBuilding/lastBuilding` — permanent
   *  entities above pool index 32,767 wrap negative and corrupt CIplStore stream-out ranges). */
  readonly linked?: boolean;
  /** LOD def placed at the HD's transform. */
  readonly lod: { readonly id: number; readonly model: string };
}

/** Boot loads a text IPL **plus all its binary streams** through one static buffer (`gpLoadedBuildings`,
 *  `CFileLoader::LoadScene` + `CIplStore::SetupRelatedIpls`), so an area's text rows and its binary rows share
 *  one budget. Stock sizes it 4096.
 *
 *  A linked area costs **2 entries per pair** — one text row + one HD stream record — so 2000 pairs = 4000
 *  entries, under stock with margin. **This is the number that shipped for a year, and it is back after a
 *  crash:** on 2026-08-10 it was raised to 4800 on the strength of the 9 627-row text IPL ProperFixes is
 *  measured running, and the game died on the first area at ~8 520 mixed entries. PF's file has **zero binary
 *  streams**; its number is not a budget for this path. `AREA_MAX_ROWS` in `permanent-areas.ts` is where that
 *  number legitimately applies, because that path emits text rows alone.
 *
 *  Since plan 014 the only caller is lod-trees' overflow areas, which is exactly why this stayed wrong quietly:
 *  the layer that crashed had moved off it, and 467 rows was nowhere near the raised cap. */
export const AREA_MAX_PAIRS = 2000;

/** Instances per binary stream file — vanilla-sized tiles so position streaming stays fine-grained. */
export const STREAM_MAX_INST = 512;

/**
 * Emit HD+LOD pairs **vanilla-style**: per spatial area, a small text IPL (`<areaBase><i>.ipl`, registered in
 * gta.dat) holding the permanent LOD rows, plus binary `<areaBase><i>_stream<k>.ipl` streams (shipped inside
 * the IMG) holding the HD instances, each `lod` field indexing its LOD row in the area's text IPL. Mass
 * instances in ONE text IPL overflow SA's per-file static buffer (the "ghost barriers" corruption — lod-procobj
 * plan 007); binary streams instead flow through `CIplStore` position streaming — the exact mechanism the stock
 * map ships 35k+ instances with.
 *
 * **Linked and unlinked pairs are split into SEPARATE areas** (plan 002). A text IPL carrying `inst` rows costs
 * one of SA's 40 `IplEntityIndexArrays` slots, and that array is REAL — the field crashed on slot 40 twice on
 * 2026-08-10, `EntityIpl = unlimited` notwithstanding. Splitting on position alone scattered the linked pairs
 * across every area, so 28 % of the pairs were spending 100 % of the slots: 47 areas for 25 560 rows. Grouped by
 * link, only the linked areas carry rows (~6 of them), and an unlinked area's text IPL is emitted with an EMPTY
 * `inst` section — the file and its `gta.dat` line still have to exist, because that is how
 * `CIplStore::SetupRelatedIpls` finds its `_stream<k>` companions.
 *
 * `instBearingFiles` is what the slot budget is spent on, returned rather than re-derived by a reader of the
 * emitted files: plan 007 wrote its slot budget into prose and nothing re-read it when the density fix took
 * areas 8 → 46.
 */
export function buildLinkedAreas(
  pairs: readonly LinkedPair[],
  areaBase: string,
): { datLines: string[]; files: [string, string][]; imgFiles: [string, Uint8Array][]; instBearingFiles: number } {
  const datLines: string[] = [];
  const files: [string, string][] = [];
  const imgFiles: [string, Uint8Array][] = [];
  let instBearingFiles = 0;
  let index = 0;

  const emitArea = (area: readonly LinkedPair[]): void => {
    const areaName = `${areaBase}${index}`;
    index += 1;
    const lodRows: string[] = [];
    const hdInstances: BinaryIplInstance[] = [];
    for (const { hd, linked, lod } of area) {
      if (isLinked({ hd, linked, lod })) {
        const t = [...hd.position, ...hd.rotation].join(', ');
        hdInstances.push({ ...hd, lod: lodRows.length });
        lodRows.push(`${lod.id}, ${lod.model}, ${hd.interior}, ${t}, -1`);
      } else {
        hdInstances.push({ ...hd, lod: -1 });
        hdInstances.push({ id: lod.id, interior: hd.interior, lod: -1, position: hd.position, rotation: hd.rotation });
      }
    }
    if (lodRows.length > 0) {
      instBearingFiles += 1;
    }

    datLines.push(`IPL DATA\\MAPS\\${areaName}.IPL`);
    files.push([
      `${areaName}.ipl`,
      ['# Generated by @opensa/map-placement — streamed area (LOD layer)', 'inst', ...lodRows, 'end', ''].join('\r\n'),
    ]);
    splitByMedian(hdInstances, STREAM_MAX_INST, (inst) => inst.position).forEach((tile, k) => {
      const stream = `${areaName}_stream${k}.ipl`;
      if (stream.length > 23) {
        throw new Error(`IMG VER2 caps entry names at 23 bytes: ${stream} — use a shorter areaBase`);
      }
      imgFiles.push([stream, encodeBinaryIpl(tile)]);
    });
  };

  // Linked first, so the slot-bearing areas keep the low indexes — a stable, greppable ordering.
  for (const family of [pairs.filter(isLinked), pairs.filter((pair) => !isLinked(pair))]) {
    if (family.length === 0) {
      continue;
    }
    splitByMedian(family, AREA_MAX_PAIRS, (pair) => pair.hd.position).forEach(emitArea);
  }

  return { datLines, files, imgFiles, instBearingFiles };
}

/** A pair whose LOD becomes a permanent text row (the default) — see {@link LinkedPair.linked}. */
export function isLinked(pair: LinkedPair): boolean {
  return pair.linked ?? true;
}

/** Recursive median split on the longest XY axis until each leaf holds ≤ `max` items. Deterministic and
 *  spatially coherent — leaves are rectangles, so stream/area bounding boxes stay tight. */
export function splitByMedian<T>(items: readonly T[], max: number, posOf: (item: T) => readonly number[]): T[][] {
  return splitIntoLeaves(items, Math.ceil(items.length / max), posOf);
}

/** Split into EXACTLY `leaves` spatial rectangles of near-equal size (±1 item around N/leaves). Halving until
 *  ≤max would waste 4096-buffer slots: 15,283 pairs at max 2000 halve into 16 leaves of ~955 — this packs
 *  them into 8 of ~1910, and every text-IPL slot saved counts against SA's 40-slot `IplEntityIndexArrays`. */
function splitIntoLeaves<T>(items: readonly T[], leaves: number, posOf: (item: T) => readonly number[]): T[][] {
  if (leaves <= 1) {
    return [[...items]];
  }
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const item of items) {
    const [x, y] = posOf(item);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const axis = maxX - minX >= maxY - minY ? 0 : 1;
  const sorted = [...items].sort((a, b) => posOf(a)[axis] - posOf(b)[axis]);
  const leftLeaves = Math.ceil(leaves / 2);
  const cut = Math.round((sorted.length * leftLeaves) / leaves);

  return [
    ...splitIntoLeaves(sorted.slice(0, cut), leftLeaves, posOf),
    ...splitIntoLeaves(sorted.slice(cut), leaves - leftLeaves, posOf),
  ];
}
