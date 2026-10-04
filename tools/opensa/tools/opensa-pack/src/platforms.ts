/**
 * Which GPUs can run a BUILT game — answered by the converter, because the converter is what decided it.
 *
 * A world's texture format is a build-time choice that cannot be re-taken at runtime
 * (`docs/restrictions/assets-and-data.md`). Until now nothing said so before a device tried: the pak loaded
 * on the desktop it was made on and threw on the phone it was made for. This is the half that runs in the
 * build.
 *
 * The demand has TWO sources and a check that reads only one is worse than none: the pak's texture arrays
 * (the world) and every model's `TEXS` dictionary (vehicles, peds, map objects) — and a car is not in the
 * pak, so a world that loads on a phone can still fail at the first spawn.
 */
import type { OspakManifest, OstexFormatId } from '@opensa/engine-formats';

import { ospakRequiredFeatures, OSTEX_FORMAT_FEATURE } from '@opensa/engine-formats';

/**
 * The GPU families we build for, as the features their adapters actually carry.
 *
 * Derived from hardware, not from a device list: the 2026-08-04 Mali-G51 capture is the reference — no BC,
 * both ASTC and ETC2 present. Adding a name here is a claim about silicon, so it needs a capture behind it.
 */
export const PLATFORM_TARGETS: Record<string, readonly string[]> = {
  /** Desktop discrete/integrated GPUs (and Apple silicon, whose Metal path carries BCn). */
  desktop: ['texture-compression-bc'],
  /** Phones and tablets: Adreno, Mali, PowerVR, Apple — ETC2 and ASTC, never BC. */
  mobile: ['texture-compression-astc', 'texture-compression-etc2'],
};

export interface PlatformDemand {
  /** Every GPU feature the build needs, sorted. Empty = it runs anywhere WebGPU does. */
  features: string[];
  /** The demand the model dictionaries add on their own (vehicles, peds, map objects). */
  models: string[];
  /** The demand the pak's world arrays make. */
  world: string[];
}

/**
 * Fail a build that claims a platform it cannot run on.
 *
 * Loud and specific by design: the alternative is the failure this replaces, which arrives on someone else's
 * phone as one texture's name.
 */
export function assertPlatformSupport(demand: PlatformDemand, targets: readonly string[]): void {
  for (const target of targets) {
    const carried = PLATFORM_TARGETS[target];
    if (carried === undefined) {
      throw new Error(
        `unknown platform target '${target}' (known: ${Object.keys(PLATFORM_TARGETS).sort().join(', ')})`,
      );
    }
    const missing = demand.features.filter((feature) => !carried.includes(feature));
    if (missing.length > 0) {
      throw new Error(
        `this build cannot run on '${target}': it needs ${missing.join(', ')}, which that GPU family does not ` +
          `carry. World textures need [${demand.world.join(', ') || 'nothing'}], model dictionaries need ` +
          `[${demand.models.join(', ') || 'nothing'}]. The formats were chosen while packing, so the fix is a ` +
          `re-pack (--rgba8), not a runtime option.`,
      );
    }
  }
}

/** Union the two halves into the build's demand. */
export function platformDemand(manifest: OspakManifest, modelFormats: readonly OstexFormatId[]): PlatformDemand {
  const world = ospakRequiredFeatures(manifest);
  const models = [
    ...new Set(modelFormats.map((format) => OSTEX_FORMAT_FEATURE[format]).filter((f): f is string => f !== undefined)),
  ].sort();

  return { features: [...new Set([...world, ...models])].sort(), models, world };
}

/** The target names this build satisfies — what the report records for anyone reading it later. */
export function satisfiedTargets(demand: PlatformDemand): string[] {
  return Object.entries(PLATFORM_TARGETS)
    .filter(([, carried]) => demand.features.every((feature) => carried.includes(feature)))
    .map(([name]) => name)
    .sort();
}
