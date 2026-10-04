import type { TextureSource } from '@opensa/lod-common/texture-source';
import type { IplTransform } from '@opensa/map-placement/ipl-text-retransform';

import { createBudgetedDecimate } from '@opensa/lod-common/budgeted-decimate';
import { buildClumpMesh } from '@opensa/lod-common/build-mesh';
import { collectClumpEffects } from '@opensa/lod-common/clump-effects';
import { encodeLodDff } from '@opensa/lod-common/encode-dff';
import { encodeHalvedTxd } from '@opensa/lod-common/encode-txd';
import { resolveFrom } from '@opensa/lod-common/texture-source';
import { lodView } from '@opensa/lod-common/view';
import { patchGtaDat } from '@opensa/map-placement/ide';
import { retransformTextIpl } from '@opensa/map-placement/ipl-text-retransform';
import { editIdeTxd } from '@opensa/map-placement/retxd';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { build2dfxSection } from '@opensa/rw-codec/dff';
import { editArchive, writeImgFile } from '@opensa/tool-kit/archive/img';
import { copyGameDir, guardOut } from '@opensa/tool-kit/game-dir';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LodLink } from '../../core/types';
import type { Archives } from './io';

import { perObjectLinks } from '../../core/report';
import { cloneKeepTypes, stripCloneTo } from './clone-2dfx';
import { fillMissingLods } from './fill-holes';
import { areaKey, walk } from './resolve';

export interface BuildInput {
  archives: Archives;
  /** Budget-checked QEM for the clones (mean pixel-diff fraction per model); 0 = pure verbatim clones. */
  decimateBudget: number;
  gameDir: string;
  /** Power-of-two downscale steps for the clone TXDs (1 = ½ each side; from `texScale`). */
  halvings: number;
  /** Draw distance for the generated hole-fill LODs (plan 003). */
  holeLodDraw: number;
  /** Curated HD models (lowercased) with no LOD to give a generated far-LOD (plan 003). */
  holeModels: ReadonlySet<string>;
  /** Keep particle 2dfx on the clones — **default true** since plan 010; `--strip-particles` is the stock-target
   *  opt-out. See {@link LodConfig.keepParticles} and `lod-common`'s 2dfx policy (type 1). */
  keepParticles: boolean;
  links: readonly LodLink[];
  outDir: string;
  /**
   * Every clone dictionary carries EVERY texture its models name, with no `txdp` parent (**default false**).
   *
   * Tried as a fix on 2026-08-16 and REJECTED by the field: it changed nothing about the missing/untextured
   * LODs and cost 45.9 MiB against the partition's 10.4 MB. Kept as a flag because it is the one shape that
   * needs no parent at all, should the chain ever be proven at fault.
   */
  selfContainedTxd: boolean;
  source: TextureSource;
}

export interface BuildStats {
  clonedLods: number;
  /** Clones that took the decimated mesh path (within the pixel budget); the rest stay verbatim byte-copies. */
  decimatedLods: number;
  filledHoles: number;
  filledInstances: number;
  generatedTxds: number;
  /** Clones of multi-atomic HDs (`anim` clumps) merged into ONE atomic without decimation — a LOD row is an
   *  atomic model, and SA keeps exactly one atomic of it. See {@link cloneLodDff}. */
  mergedLods: number;
  missingHd: number;
  missingTxd: number;
  /** Textures moved into the shared `salodpar.txd` txdp parent (used by ≥ 2 source atlases). */
  parentTextures: number;
  retransformedLods: number;
  skippedHoles: number;
  skippedShared: number;
}

/**
 * One clone's DFF bytes (plan 003, Phase 5). With a decimator, the HD mesh is QEM-decimated under the pixel
 * budget and re-encoded — night prelit and tinted materials ride the mesh path, and the HD's 2dfx entries are
 * transplanted byte-for-byte with frame-transformed positions, in the set `cloneKeepTypes` resolves (plan
 * 100/05: emitters included by default). When the budget rejects every target (or decimation is off), the
 * clone stays the **verbatim byte-copy** — keeping plugins the mesh path can't carry (e.g. breakable) at zero
 * risk — with the same set applied subtractively.
 *
 * One HD shape can NEVER be copied verbatim: a clump with several atomics (stock ships 34, every one an `anim`
 * row — rotating signs, windmills, oil derricks, the Burger Shot's burger). A LOD row is an `objs` atomic
 * model, and SA's `CFileLoader::SetRelatedModelInfoCB` → `CAtomicModelInfo::SetAtomic` keeps exactly ONE
 * atomic of whatever clump it reads (the last visited, re-framed at the origin) — the byte-copy of
 * `burger01_LAw` showed only its 5 m burger sign, at the building's origin: the field's "LOD absent". Such an
 * HD always takes the mesh path — its atomics merged into one geometry with the frame transforms baked, the
 * rest-pose the animation starts from — even when the budget keeps every triangle.
 *
 * Exported for its tests: the 2dfx set a clone carries is this function's decision, and nothing else in the
 * package can be asked what it made of a real model's entries.
 */
export function cloneLodDff(
  hdDff: Uint8Array,
  link: LodLink,
  decimate: null | ReturnType<typeof createBudgetedDecimate>,
  textures: TextureSource,
  stats: BuildStats,
  keepParticles: boolean,
): Uint8Array {
  const keep = cloneKeepTypes(keepParticles);
  const clump = parseDff(toArrayBuffer(hdDff));
  const multiAtomic = clump.atomics.length > 1;
  if (decimate !== null || multiAtomic) {
    const mesh = buildClumpMesh(clump);
    const ctx = { textures, view: lodView(link.hdDrawDistance || 300) };
    const decimated = decimate === null ? mesh : decimate(mesh, ctx);
    if (decimated !== mesh || multiAtomic) {
      if (decimated !== mesh) {
        stats.decimatedLods += 1;
      } else {
        stats.mergedLods += 1;
      }
      // One pass over the policy's set, so emitters ride by default and keep their AUTHORED order among the
      // coronas — the old two-pass shape (everything-but-particles, then particles appended) reordered them.
      const effects = build2dfxSection(collectClumpEffects(hdDff, clump, keep));

      return encodeLodDff(decimated, link.lodModel, { textures, ...(effects ? { effects } : {}) });
    }
  }

  // Verbatim: SUBTRACTIVE, never re-encoded — see `stripCloneTo`.
  return stripCloneTo(hdDff, keep);
}

/**
 * The clone TXD name for a source HD atlas, generating + packing it (`texScale` DXT, deduped) on first use —
 * the hole-fill path (atlases the Phase-1 partition didn't cover get a full standalone TXD, no txdp line).
 * Returns `null` if the source TXD is missing.
 */
export function ensureCloneTxd(
  hdTxd: string,
  input: BuildInput,
  img: ReturnType<typeof editArchive>,
  hdTxdToClone: Map<string, string>,
): null | string {
  const existing = hdTxdToClone.get(hdTxd);
  if (existing) {
    return existing;
  }
  const bytes = hdTxd ? input.archives.get(`${hdTxd}.txd`) : null;
  if (!bytes) {
    return null; // no source atlas → the LOD it would serve stays stock
  }
  const names = parseTxd(bytes).textures.map((texture) => texture.name);
  const cloneName = `salod${String(hdTxdToClone.size).padStart(4, '0')}`;
  img.set(`${cloneName}.txd`, encodeHalvedTxd(names, atlasView(input.source, hdTxd), input.halvings, 'gamma'));
  hdTxdToClone.set(hdTxd, cloneName);

  return cloneName;
}

/**
 * Emit the drop-in Phase-1 build (plan 002): mirror `gameDir` → `outDir`, then in the copied `models/gta3.img`
 * replace each **per-object** LOD's `.dff` with its HD model's bytes **verbatim** (no re-encode — a known-good SA
 * clone, no format-gotcha risk — or a budget-decimated re-encode, see {@link cloneLodDff}) and add the
 * `txdp`-partitioned clone TXDs (plan 006: one shared `salodpar.txd` parent + a slim `salodNNNN` child per
 * source atlas, DXT + mips at `texScale`). Finally retarget those LODs' IDE `txd` column to the clone TXD and
 * register the `txdp` IDE. Ids, names and every IPL `lod` link are left untouched, so the map linkage never
 * moves. Shared (multi-HD) LODs are left stock — Phase 1 covers only the 1:1 majority.
 */
export function writeBuild(input: BuildInput): BuildStats {
  const perObject = perObjectLinks(input.links);
  const skippedShared = distinctLods(input.links) - distinctLods(perObject);

  // WIPE, then mirror — the chain's `copyGameDir` convention, and here it is a correctness rule rather than
  // tidiness: `<out>/sa` outlives a build, so anything an earlier run wrote and this one does not would
  // SURVIVE into the tree a field run reads. Found 2026-08-16 with 23 mod IPLs still sitting in `data/maps`
  // from a failed run, unreferenced by gta.dat — harmless that time, and the same mechanism keeps a stale
  // model alive next time (`tools/mod-installer/docs/plans/013-slot-fold-across-hosts.md`).
  guardOut(input.outDir, input.gameDir);
  copyGameDir(input.gameDir, input.outDir);
  const img = editArchive(input.archives.gta3);

  const { hdTxdToClone, parentTextures } = packCloneTxds(perObject, input, img);
  const txdpChildren = [...hdTxdToClone.values()]; // partitioned children — hole-fill atlases added later are full TXDs
  const modelToTxd = new Map<string, string>();
  const stats: BuildStats = {
    clonedLods: 0,
    decimatedLods: 0,
    filledHoles: 0,
    filledInstances: 0,
    generatedTxds: hdTxdToClone.size,
    mergedLods: 0,
    missingHd: 0,
    missingTxd: 0,
    parentTextures,
    retransformedLods: 0,
    skippedHoles: 0,
    skippedShared,
  };
  const decimate = input.decimateBudget > 0 ? createBudgetedDecimate({ pixelBudget: input.decimateBudget }) : null;
  for (const link of perObject) {
    const cloneTxd = hdTxdToClone.get(link.hdTxd);
    if (!cloneTxd) {
      stats.missingTxd += 1; // no usable HD atlas → leave the stock LOD intact
      continue;
    }
    const hdDff = input.archives.get(`${link.hdModel}.dff`);
    if (!hdDff) {
      stats.missingHd += 1;
      continue;
    }
    img.set(
      `${link.lodModel}.dff`,
      cloneLodDff(
        new Uint8Array(hdDff),
        link,
        decimate,
        atlasView(input.source, link.hdTxd),
        stats,
        input.keepParticles,
      ),
    );
    modelToTxd.set(link.lodModel, cloneTxd);
    stats.clonedLods += 1;
  }

  // Phase 2 (plan 003): generate a far-LOD for curated HD-without-LOD models — shares the img editor + TXD dedup,
  // and appends to the copied text IPLs before they're re-read by the Phase-1 transform retarget below.
  if (input.holeModels.size > 0) {
    const fill = fillMissingLods({
      archives: input.archives,
      ensureTxd: (hdTxd) => ensureCloneTxd(hdTxd, input, img, hdTxdToClone),
      holeLodDraw: input.holeLodDraw,
      keepParticles: input.keepParticles,
      models: input.holeModels,
      outDataDir: join(input.outDir, 'data'),
      setImg: (name, bytes) => img.set(name, bytes),
    });
    stats.filledHoles = fill.filled;
    stats.filledInstances = fill.appended;
    stats.skippedHoles = fill.skipped;
  }
  stats.generatedTxds = hdTxdToClone.size;

  writeImgFile(img, join(input.outDir, 'models', 'gta3.img'));
  retargetIdes(input.outDir, modelToTxd);
  if (parentTextures > 0) {
    writeTxdpIde(input.outDir, txdpChildren);
  }
  stats.retransformedLods = retargetLodTransforms(input, new Set(modelToTxd.keys()));

  return stats;
}

/** A {@link TextureSource} view resolving every name inside ONE source atlas first (lod-common plan 004). */
function atlasView(source: TextureSource, hdTxd: string): TextureSource {
  return {
    get: (name) => resolveFrom(source, hdTxd, name),
    getFrom: (txd, name) => source.getFrom?.(txd, name) ?? null,
  };
}

/** Distinct LOD models across the given links. */
function distinctLods(links: readonly LodLink[]): number {
  return new Set(links.map((link) => link.lodModel)).size;
}

/** Content key for a resolved texture (null when unresolvable) — dims + a cheap rolling hash of the pixels. */
function variantKey(texture: null | { height: number; rgba: Uint8Array; width: number }): null | string {
  if (!texture) {
    return null;
  }
  let hash = 0x811c9dc5;
  for (const byte of texture.rgba) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return `${texture.width}x${texture.height}:${(hash >>> 0).toString(16)}`;
}

/** The shared `txdp` parent dictionary every partitioned clone TXD points at (plan 006). */
export const PARENT_TXD = 'salodpar';

/**
 * Partition the clone atlases' texture names for the `txdp` parent scheme (plan 006, revised by lod-common
 * plan 004): a name used by **≥ 2** atlases goes to the shared parent **only when every owner carries the
 * SAME pixels** (`keyOf` — a content key per (atlas, name)). SA reuses names across TXDs with different
 * pixels (area recolours), so a multi-variant name stays in EACH owner's child TXD instead — the `txdp`
 * chain resolves child-first, so every LOD keeps its own variant. Without `keyOf` (legacy tests) any
 * multi-atlas name is treated as one variant.
 */
export function partitionCloneTextures(
  atlasNames: ReadonlyMap<string, readonly string[]>,
  keyOf?: (atlas: string, name: string) => null | string,
): {
  perAtlas: Map<string, string[]>;
  shared: string[];
} {
  const owners = new Map<string, string[]>();
  for (const [atlas, names] of atlasNames) {
    for (const name of new Set(names)) {
      const list = owners.get(name) ?? [];
      list.push(atlas);
      owners.set(name, list);
    }
  }
  const shared = new Set(
    [...owners]
      .filter(([name, atlasList]) => {
        if (atlasList.length < 2) {
          return false;
        }
        if (!keyOf) {
          return true;
        }
        const keys = new Set(atlasList.map((atlas) => keyOf(atlas, name) ?? `missing:${atlas}`));

        return keys.size === 1; // one variant everywhere → safe in the shared parent
      })
      .map(([name]) => name),
  );
  const perAtlas = new Map<string, string[]>();
  for (const [atlas, names] of atlasNames) {
    perAtlas.set(atlas, [...new Set(names)].filter((name) => !shared.has(name)).sort());
  }

  return { perAtlas, shared: [...shared].sort() };
}

/**
 * The clone TXDs, `txdp`-partitioned (plan 006): one shared `salodpar.txd` for every texture used by ≥ 2 source
 * atlases + one slim `salodNNNN` child per atlas holding only its unique textures (a child may be empty — it
 * must still exist for the game to bind, and the parent chain supplies the rest). Returns `hdTxd → child name`
 * and the shared-texture count for the stats/report.
 */
function packCloneTxds(
  perObject: readonly LodLink[],
  input: BuildInput,
  img: ReturnType<typeof editArchive>,
): { hdTxdToClone: Map<string, string>; parentTextures: number } {
  const atlasNames = new Map<string, string[]>();
  for (const hdTxd of [...new Set(perObject.map((link) => link.hdTxd))].sort()) {
    const bytes = hdTxd ? input.archives.get(`${hdTxd}.txd`) : null;
    if (!bytes) {
      continue; // no source atlas → the LODs it would serve stay stock (counted as missingTxd per link)
    }
    try {
      // The texture's OWN name, case intact. A clone LOD is the HD's geometry verbatim, so its materials ask
      // for the HD's spelling (`gymshop1_LAe`, `Parking1_LAe2`) — and stock SA never once spells a texture
      // differently in a DFF than in the dictionary it lives in (measured, 0 case-only mismatches). Lowercasing
      // here handed the game a dictionary whose keys no material asks for, and OUR resolver could not see it
      // because it lowercases both sides. `ensureCloneTxd` (the hole-fill path) always kept the case.
      atlasNames.set(
        hdTxd,
        parseTxd(bytes).textures.map((texture) => texture.name),
      );
    } catch {
      // unreadable atlas — same as missing
    }
  }

  // Self-contained (opt-in): every atlas keeps every name and no parent is written — see
  // {@link BuildInput.selfContainedTxd}.
  const { perAtlas, shared } = input.selfContainedTxd
    ? { perAtlas: new Map([...atlasNames].map(([atlas, names]) => [atlas, [...new Set(names)]])), shared: [] }
    : partitionCloneTextures(atlasNames, (atlas, name) => variantKey(resolveFrom(input.source, atlas, name)));
  if (shared.length > 0) {
    // All owners carry identical pixels — resolve each shared name through ANY owner (scoped, not flat).
    const ownerOf = new Map<string, string>();
    for (const [atlas, names] of atlasNames) {
      for (const name of names) {
        if (!ownerOf.has(name)) {
          ownerOf.set(name, atlas);
        }
      }
    }
    const parentView: TextureSource = { get: (name) => resolveFrom(input.source, ownerOf.get(name) ?? '', name) };
    img.set(`${PARENT_TXD}.txd`, encodeHalvedTxd(shared, parentView, input.halvings, 'gamma'));
  }
  const hdTxdToClone = new Map<string, string>();
  for (const [hdTxd, names] of perAtlas) {
    const cloneName = `salod${String(hdTxdToClone.size).padStart(4, '0')}`;
    img.set(`${cloneName}.txd`, encodeHalvedTxd(names, atlasView(input.source, hdTxd), input.halvings, 'gamma'));
    hdTxdToClone.set(hdTxd, cloneName);
  }

  return { hdTxdToClone, parentTextures: shared.length };
}

/** Retarget every IDE `txd` column of a cloned LOD to its clone TXD (drop-in — no other IDE/IPL change). */
function retargetIdes(outDir: string, modelToTxd: ReadonlyMap<string, string>): void {
  if (modelToTxd.size === 0) {
    return;
  }
  for (const file of walk(join(outDir, 'data')).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    const result = editIdeTxd(readFileSync(file, 'utf8'), modelToTxd);
    if (result.changed) {
      writeFileSync(file, result.text);
    }
  }
}

/**
 * A clone LOD is now its HD's geometry, so its instance must sit under the **HD instance's** transform — the stock
 * LOD instance's rotation/position compensated for the stock LOD's differently-baked local frame and would skew the
 * clone (see the `ipl-lod-index-coupling` memory: the pointed-to LOD instance always lives in a **text** IPL, so
 * only text IPLs are rewritten). For every cloned LOD instance, copy its owning HD instance's transform — from the
 * same text file (text HD) or the area's binary streams (binary HD → companion text). Returns the rows rewritten.
 */
function retargetLodTransforms(input: BuildInput, clonedLods: ReadonlySet<string>): number {
  const areas = new Map<string, { file: string; instances: ReturnType<typeof parseIpl> }>();
  for (const file of walk(join(input.outDir, 'data'))) {
    if (!file.toLowerCase().endsWith('.ipl') || /[/\\]interior[/\\]/i.test(file)) {
      continue;
    }
    areas.set(areaKey(file), { file, instances: parseIpl(readFileSync(file, 'utf8')) });
  }

  const perFile = new Map<string, Map<number, IplTransform>>();
  const record = (file: string, lodRow: number, transform: IplTransform): void => {
    const map = perFile.get(file) ?? new Map<number, IplTransform>();
    map.set(lodRow, transform);
    perFile.set(file, map);
  };
  for (const { file, instances } of areas.values()) {
    instances.forEach((inst) => {
      const lod = instances[inst.lod];
      if (inst.lod >= 0 && inst.lod < instances.length && clonedLods.has(lod.modelName.toLowerCase())) {
        record(file, inst.lod, { pos: inst.position, rot: inst.rotation });
      }
    });
  }
  for (const name of input.archives.gta3.names) {
    const area = name.endsWith('.ipl') ? areas.get(areaKey(name)) : undefined;
    const buffer = area ? input.archives.gta3.get(name) : null;
    if (!area || !buffer) {
      continue;
    }
    for (const inst of parseBinaryIpl(buffer)) {
      const lod = area.instances[inst.lod];
      if (inst.lod >= 0 && inst.lod < area.instances.length && clonedLods.has(lod.modelName.toLowerCase())) {
        record(area.file, inst.lod, { pos: inst.position, rot: inst.rotation });
      }
    }
  }

  let rewritten = 0;
  for (const [file, transforms] of perFile) {
    const result = retransformTextIpl(readFileSync(file, 'utf8'), transforms);
    if (result.changed) {
      writeFileSync(file, result.text);
      rewritten += transforms.size;
    }
  }

  return rewritten;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Write the `txdp` IDE (child → parent per clone TXD) and register it in `gta.dat` before the first IPL. */
function writeTxdpIde(outDir: string, children: readonly string[]): void {
  if (children.length === 0) {
    return;
  }
  const rel = join('maps', 'salod-txdp.ide');
  const rows = children.map((child) => `${child}, ${PARENT_TXD}`);
  writeFileSync(join(outDir, 'data', rel), `txdp\n${rows.join('\n')}\nend\n`);
  const datPath = join(outDir, 'data', 'gta.dat');
  writeFileSync(datPath, patchGtaDat(readFileSync(datPath, 'utf8'), 'DATA\\MAPS\\salod-txdp.ide'));
}
