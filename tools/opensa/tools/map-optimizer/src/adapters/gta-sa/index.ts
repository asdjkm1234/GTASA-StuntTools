import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { isLodModel } from '@opensa/renderware/parsers/text/lod';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GameAdapter } from '../../core/adapter';
import type { Asset, AssetRef, WriteResult } from '../../core/asset';

import { shiftPrelit } from '../../plugins/apply-prelit-level';
import { writeFullBuild } from './build';
import { encodeDff } from './codec/dff';
import {
  computePrelitContext,
  fingerprintClump,
  type LevelVerdict,
  type PrelitContextOptions,
  type PrelitContextResult,
  type PrelitFingerprint,
} from './prelit-context';
import { clumpToIr } from './read';
import { type Placement, resolveMap, resolvePlacements, timedModels } from './resolve';
import { computeSeamOverrides, type SeamModel, type SeamWeldOptions, type SeamWeldResult } from './seam-weld';
import { optimizeTxd } from './textures';

/** GTA-SA world-context prelight op (plan 019). */
export interface GtaSaPrelitOps {
  /** Fingerprint every placed model + compute neighbourhood correction verdicts (day level / night). */
  buildPrelitContext(options?: PrelitContextOptions): PrelitContextResult;
}

/** GTA-SA seam-weld op, exposed for the optional cross-model prelit weld (plan 016 + feather band, plan 019). */
export interface GtaSaSeamOps {
  /** Compute per-model prelit overrides that close cross-model tile seams (uniquely-placed models only).
   *  Pass the day-level verdicts so the weld/feather works in post-level space (plan 019 Phase 3). */
  buildSeamOverrides(options?: SeamWeldOptions & { levelVerdicts?: ReadonlyMap<string, LevelVerdict> }): SeamWeldResult;
}

/** GTA-SA texture-pass ops, exposed alongside the {@link GameAdapter} for the optional mip pass (plan 010). */
export interface GtaSaTextureOps {
  /** Read `<name>.txd`, generate mip chains, pack the result into the output `.img`; null if not in archives. */
  optimizeTexture(name: string): null | TextureOutcome;
  /** The TXD names the map references. */
  resolveTextures(): string[];
}

/** Outcome of optimizing one TXD. `null` (from `optimizeTexture`) means it wasn't in the archives. */
export interface TextureOutcome {
  /** True when the TXD couldn't be read/optimized (isolated — not packed into the build). */
  failed: boolean;
  /** How many textures gained a mip chain (the resized ones included). */
  mipped: number;
  /** DXT textures not block-aligned, resampled to a power of two (see `optimizeTxd`). */
  resized: number;
}

/**
 * GTA-SA (RenderWare) adapter. Encapsulates all of this game's I/O behind {@link GameAdapter}: resolving the
 * map's models, reading DFFs into the neutral IR (read-only reuse of `../src` parsers), and writing them back
 * via the in-house DFF serializer ({@link encodeDff}). On `finalize` it emits a **full drop-in build**: the
 * whole game-src tree is mirrored to `out/`, with each `models/*.img` rebuilt so the optimized entries are
 * swapped in and everything else (vehicles, peds, interiors, …) is preserved (plan 011).
 * The serializer patches vertex attributes in place (positions/normals/prelit/UVs); topology edits and
 * anti-rip recovered geometry are not yet expressible and surface as per-asset failures.
 */
export function createGtaSaAdapter(
  game: string,
  gameDir: string,
): GameAdapter & GtaSaPrelitOps & GtaSaSeamOps & GtaSaTextureOps {
  const modelsDir = join(gameDir, 'models');
  const dataDir = join(gameDir, 'data');
  // Open every models/*.img once, keyed by filename (so `finalize` can rebuild each in place). gta3.img is the
  // primary source; the rest (gta_int + any mod archives) are byte fallbacks.
  const imgFiles = readdirSync(modelsDir).filter((file) => file.toLowerCase().endsWith('.img'));
  const gta3File = imgFiles.find((file) => file.toLowerCase() === 'gta3.img');
  if (!gta3File) {
    throw new Error('models/gta3.img not found');
  }
  const archivesByFile = new Map(imgFiles.map((file) => [file, openArchive(readArchive(join(modelsDir, file)))]));
  const gta3 = archivesByFile.get(gta3File)!;
  const others = imgFiles.filter((file) => file !== gta3File).sort();
  const archives = [gta3, ...others.map((file) => archivesByFile.get(file)!)];

  const getModel = (name: string): ArrayBuffer | null => {
    for (const archive of archives) {
      const bytes = archive.get(name);
      if (bytes) {
        return bytes;
      }
    }

    return null;
  };

  const placed = resolveMap(dataDir, gta3); // map's models + txds, resolved once

  // Optimized models + textures collected during the run, packed into a VER2 .img on finalize().
  const packed: { data: Uint8Array; name: string }[] = [];

  // All exterior placements, resolved ONCE per adapter (plan 019 Phase 0) — three world pre-passes read them.
  let placementsCache: null | Placement[] = null;
  const allPlacements = (): Placement[] => {
    placementsCache ??= resolvePlacements(dataDir, gta3);

    return placementsCache;
  };

  // `tobj` (hour-gated) models — lit-window / neon night overlays, coplanar with their base building. Their
  // prelit IS the lighting design and their geometry must not weld/stitch to the wall behind, so every
  // world-context pass skips them (plan 019 — night repair dimmed skyscraper windows before this).
  let timedCache: null | Set<string> = null;
  const timed = (): Set<string> => {
    timedCache ??= timedModels(dataDir);

    return timedCache;
  };

  // Uniquely-placed models (placed exactly once), for the world-context passes. `lod*` are dropped by default
  // (the engine's LOD gate — reused by every LOD tool): a far-LOD isn't co-visible with its HD, so editing that
  // pair is pointless (plan 016). `_lodbit`/`_lod` tiles are NOT `lod*`-prefixed → kept as HD-tier.
  const uniquePlacements = (includeLods?: boolean): Map<string, Placement> => {
    const placements = allPlacements();
    const counts = new Map<string, number>();
    for (const placement of placements) {
      counts.set(placement.modelName, (counts.get(placement.modelName) ?? 0) + 1);
    }
    const unique = new Map<string, Placement>();
    for (const placement of placements) {
      if (
        counts.get(placement.modelName) === 1 &&
        (includeLods || !isLodModel(placement.modelName)) &&
        !timed().has(placement.modelName)
      ) {
        unique.set(placement.modelName, placement);
      }
    }

    return unique;
  };

  return {
    buildPrelitContext(options?: PrelitContextOptions): PrelitContextResult {
      // Fingerprint every distinct placed HD-tier model (lod* excluded — far-LODs aren't co-visible with their
      // HD and would double-count the hood brightness at the same coordinates; tobj excluded — a night-window
      // overlay's prelit is lighting design, and it must not feed the hood stats either). Parse-and-discard:
      // only the small fingerprint is retained per model.
      const placements = allPlacements().filter(
        (placement) => !isLodModel(placement.modelName) && !timed().has(placement.modelName),
      );
      const fingerprints = new Map<string, PrelitFingerprint>();
      for (const placement of placements) {
        if (fingerprints.has(placement.modelName)) {
          continue;
        }
        const bytes = getModel(`${placement.modelName}.dff`);
        if (!bytes) {
          continue;
        }
        try {
          const fingerprint = fingerprintClump(parseDff(bytes));
          if (fingerprint) {
            fingerprints.set(placement.modelName, fingerprint);
          }
        } catch {
          continue; // unparseable model — best-effort, like the other pre-passes
        }
      }

      return computePrelitContext(fingerprints, placements, options);
    },
    buildSeamOverrides(
      options?: SeamWeldOptions & { levelVerdicts?: ReadonlyMap<string, LevelVerdict> },
    ): SeamWeldResult {
      const models: SeamModel[] = [];
      for (const [name, placement] of uniquePlacements(options?.includeLods)) {
        const bytes = getModel(`${name}.dff`);
        if (!bytes) {
          continue;
        }
        // The weld/feather must see the prelit the pipeline will have AFTER apply-prelit-level (its overrides
        // are absolute and run later) — apply the model's day-level verdict to a copy (plan 019 Phase 3).
        const levelVerdict = options?.levelVerdicts?.get(name);
        const leveled = (prelit: Uint8Array): Uint8Array => {
          if (!levelVerdict) {
            return prelit;
          }
          const copy = new Uint8Array(prelit);
          shiftPrelit(copy, levelVerdict);

          return copy;
        };
        try {
          const geometries = parseDff(bytes)
            .geometries.filter((geometry) => geometry.prelitColors)
            .map((geometry) => ({
              positions: geometry.positions,
              prelit: leveled(geometry.prelitColors!),
              triangles: geometry.triangles.map((triangle) => ({ a: triangle.a, b: triangle.b, c: triangle.c })),
            }));
          if (geometries.length > 0) {
            models.push({
              geometries,
              name,
              placement: { position: placement.position, rotation: placement.rotation },
            });
          }
        } catch {
          continue; // unparseable model — skip it, the weld pass is best-effort
        }
      }

      return computeSeamOverrides(models, options);
    },
    finalize(outDir: string): void {
      // Mirror the whole game into out/, rebuilding each model archive with the optimized entries swapped in
      // and everything else (vehicles, peds, …) preserved — a drop-in build (plan 011).
      const optimized = new Map(packed.map((entry) => [entry.name, entry.data]));
      writeFullBuild(gameDir, outDir, archivesByFile, optimized);
    },
    game,
    optimizeTexture(name: string): null | TextureOutcome {
      const bytes = getModel(`${name}.txd`);
      if (!bytes) {
        return null;
      }
      try {
        const result = optimizeTxd(new Uint8Array(bytes));
        if (result.processed > 0) {
          packed.push({ data: result.bytes, name: `${name}.txd` }); // untouched TXDs keep their archive entry
        }

        return { failed: false, mipped: result.processed, resized: result.resized };
      } catch {
        return { failed: true, mipped: 0, resized: 0 }; // unparseable TXD — isolate, leave it out of the .img
      }
    },
    read(ref: AssetRef): Asset {
      const bytes = getModel(`${ref.name}.dff`);
      if (!bytes) {
        throw new Error(`model not found in archives: ${ref.name}.dff`);
      }

      return {
        dirty: false,
        ir: clumpToIr(parseDff(bytes)),
        log: [],
        meta: {},
        name: ref.name,
        source: new Uint8Array(bytes),
      };
    },
    resolve(): AssetRef[] {
      return placed.models.map((name) => ({ name }));
    },
    resolveTextures(): string[] {
      return placed.txds;
    },
    write(asset: Asset): WriteResult {
      if (!asset.dirty) {
        // Identity (the adapter contract): the source bytes ARE the output — byte-exact by construction, no
        // re-encode trust needed. Not pushed into `packed` either: the archive rebuild keeps the original entry.
        return { bytes: asset.source, fileName: `${asset.name}.dff` };
      }
      const bytes = encodeDff(asset.source, asset.ir);
      packed.push({ data: bytes, name: `${asset.name}.dff` });

      return { bytes, fileName: `${asset.name}.dff` };
    },
  };
}

function readArchive(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
