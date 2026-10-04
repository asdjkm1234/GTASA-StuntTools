import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { extract2dfxEntries } from '@opensa/rw-codec/dff';

import type { VertexTransform } from './build-mesh';
import type { Vec3 } from './mesh';

import { clumpFrameTransforms } from './build-mesh';
import { spaceOf } from './two-dfx-policy';
import { transform2dfxEntry } from './two-dfx-transform';

/** A geometry with no atomic of its own — and any WORLD-space entry — keeps the entry where it was authored. */
const IDENTITY_TRANSFORM: VertexTransform = {
  normal: (x, y, z): Vec3 => [x, y, z],
  point: (x, y, z): Vec3 => [x, y, z],
};

/** A raw 2dfx entry with its position lifted into **model-local** space (the geometry's frame applied). */
export interface ClumpEffect {
  bytes: Uint8Array;
  position: Vec3;
  type: number;
}

/**
 * Lift a model's 2dfx entries out of its DFF bytes, each carried through the owning geometry's frame by
 * {@link transform2dfxEntry} — the same placement {@link clumpFrameTransforms} gives vertices, so effects land
 * exactly where the encoded mesh's geometry did (plan 003, Phase 5). An opaque payload stays byte-verbatim;
 * a spatial one (a plate's rotation, an escalator's step path) is carried too. `keepTypes` filters — pass
 * `keepTypesFor(target)`; default = everything except particles.
 *
 * The frame carry is **model-space** work and says nothing about a WORLD-space type: a roadsign's authored
 * position is already a city coordinate, so a caller re-bases it by the cell origin alone (`spaceOf`), never
 * by an instance transform.
 */
export function collectClumpEffects(
  dffBytes: Uint8Array,
  clump: RWClump,
  keepTypes?: ReadonlySet<number>,
): ClumpEffect[] {
  const transforms = clumpFrameTransforms(clump);

  return extract2dfxEntries(dffBytes, keepTypes).map((entry) =>
    transform2dfxEntry(
      entry,
      spaceOf(entry.type) === 'world' ? IDENTITY_TRANSFORM : (transforms[entry.geometryIndex] ?? IDENTITY_TRANSFORM),
    ),
  );
}
