/**
 * One `.osm` per MODEL, not per asset class (plan opensa-pack/003 phase 5).
 *
 * A model belongs to as many classes as the data says: a cactus is a clutter species AND a breakable, a
 * crate is a topple prop AND a breakable. Each class contributes its own sections — `DESC`/`GEOM` from the
 * rigid build, `SHAT` from the shatter bake, collision from the COL — and they must land in ONE container.
 *
 * Emitting a file per class instead looks fine until two classes name the same model: the archive editor
 * dedupes inserts by name, so the second contribution is silently dropped and the model loses half its
 * sections. This accumulator is what makes that impossible.
 */
import type { OsmSection, OstexFormatId } from '@opensa/engine-formats';

import {
  decodeOsmTextures,
  encodeOsm,
  encodeOsmTextures,
  OsmSectionTag,
  osmTextureFormats,
} from '@opensa/engine-formats';

import type { ArchiveInsert } from './archive-edit';

export interface ModelBundles {
  /** Add a class's contribution to `model`. Repeated tags are rejected — two classes may not both claim one. */
  add(model: string, contribution: ModelContribution): void;
  /** Whether `model` already carries `tag` — a later class then contributes only what it adds. */
  hasSection(model: string, tag: number): boolean;
  /** Every accumulated model as archive inserts — ONE `.osm` each; the dictionary rides in `TEXS`. */
  inserts(): ArchiveInsert[];
  /** The format of every dictionary array accumulated so far — the build's platform check reads it to learn
   *  which GPUs can spawn these models. Headers only: {@link inserts} is what encodes, and calling it twice
   *  to answer this would re-encode the whole game. */
  ostexFormats(): OstexFormatId[];
  /** Rewrite every accumulated dictionary array through `transform`, returning how many were rewritten.
   *  The texture-format pass (plan 200/2-02) is the only caller and runs AFTER every class has contributed,
   *  so no asset class has to know which format the build targets. Zero-length placeholders — a model that
   *  binds the world's arrays instead of carrying its own — are left alone.
   *
   *  `onProgress` fires once per model bundle. The stage is minutes long at one encoder thread and printed
   *  nothing until it finished, which on a phone is indistinguishable from a hang — and was reported as one
   *  on 2026-08-09. */
  retexture(
    transform: (array: Uint8Array) => Promise<Uint8Array>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<number>;
  /** Number of distinct models accumulated. */
  size(): number;
}

export interface ModelContribution {
  sections: readonly OsmSection[];
}

export function createModelBundles(): ModelBundles {
  const bundles = new Map<string, { sections: OsmSection[] }>();

  return {
    add(model: string, contribution: ModelContribution): void {
      const name = model.toLowerCase();
      const bundle = bundles.get(name) ?? { sections: [] };
      for (const section of contribution.sections) {
        if (bundle.sections.some((existing) => existing.tag === section.tag)) {
          // Two classes writing the same section for one model means they disagree about its content —
          // silently keeping either one is how a model ends up with the wrong geometry.
          throw new Error(`${name}: duplicate .osm section contributed twice`);
        }
        bundle.sections.push(section);
      }
      bundles.set(name, bundle);
    },
    hasSection(model: string, tag: number): boolean {
      return bundles.get(model.toLowerCase())?.sections.some((section) => section.tag === tag) ?? false;
    },
    inserts(): ArchiveInsert[] {
      const out: ArchiveInsert[] = [];
      for (const [name, bundle] of bundles) {
        out.push({ bytes: encodeOsm(bundle.sections), name: `${name}.osm`, near: `${name}.dff` });
      }

      return out;
    },
    ostexFormats(): OstexFormatId[] {
      const formats: OstexFormatId[] = [];
      for (const bundle of bundles.values()) {
        for (const section of bundle.sections) {
          if (section.tag === OsmSectionTag.TEXS) {
            formats.push(...osmTextureFormats(section.bytes));
          }
        }
      }

      return formats;
    },
    async retexture(
      transform: (array: Uint8Array) => Promise<Uint8Array>,
      onProgress?: (done: number, total: number) => void,
    ): Promise<number> {
      let rewritten = 0;
      let visited = 0;
      for (const bundle of bundles.values()) {
        visited += 1;
        onProgress?.(visited, bundles.size);
        for (const section of bundle.sections) {
          if (section.tag !== OsmSectionTag.TEXS) {
            continue;
          }
          const textures = decodeOsmTextures(section.bytes);
          const arrays: Uint8Array[] = [];
          for (const array of textures.arrays) {
            if (array.byteLength === 0) {
              arrays.push(array);
              continue;
            }
            arrays.push(await transform(array));
            rewritten += 1;
          }
          section.bytes = encodeOsmTextures({ arrays });
        }
      }

      return rewritten;
    },
    size(): number {
      return bundles.size;
    },
  };
}
