import type { ClumpEffect } from '@opensa/lod-common/clump-effects';
import type { MergedMesh, Quat, Vec3 } from '@opensa/lod-common/mesh';
import type { ModelSource } from '@opensa/lod-common/model-source';
import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { MeshBuilder, type VertexTransform } from '@opensa/lod-common/build-mesh';
import { collectClumpEffects } from '@opensa/lod-common/clump-effects';
import { registerScopedName, type ScopedRegistry } from '@opensa/lod-common/scoped-texture';
import { keepTypesFor, spaceOf } from '@opensa/lod-common/two-dfx-policy';
import { transform2dfxEntry } from '@opensa/lod-common/two-dfx-transform';
import { frameWorldTransform } from '@opensa/renderware/mesh/frame-transform';

import type { Cell, CellInstance } from '../../core/types';

/**
 * Gather the cell's 2dfx entries in cell-centre-relative space, so a baked cell's coronas glow, its chimneys
 * smoke and its street-name plates read exactly where the source models' did (plan 003 Phase 5, widened to
 * emitters and plates by plan 100). WHICH types ride is not decided here: it is `@opensa/lod-common`'s
 * declared policy for the `cell` target, which carries the reason with it.
 *
 * The transform is chosen by the entry's SPACE, not by its type, so a type declared later inherits the right
 * behaviour:
 *
 * - **model-local** (lights, emitters): the instance transform {@link mergeCell} gives vertices — two chimneys
 *   are two plumes — with the per-model entries memoized untransformed;
 * - **world** (roadsigns): a translation by `−origin` and nothing else. The position is already a city
 *   coordinate; rotating it by the instance would throw the plate about a kilometre. It is emitted ONCE per
 *   model per cell, because every placement of that model would otherwise stack an identical plate.
 */
export function collectCellEffects(
  cell: Cell,
  cellSize: number,
  loadRaw: (model: string) => null | Uint8Array,
  source: ModelSource,
  cache: Map<string, ClumpEffect[]>,
): ClumpEffect[] {
  const origin: Vec3 = [(cell.cx + 0.5) * cellSize, (cell.cy + 0.5) * cellSize, 0];
  const rebase = originTransform(origin);
  const out: ClumpEffect[] = [];
  const worldModelsDone = new Set<string>();
  for (const instance of cell.instances) {
    let effects = cache.get(instance.model);
    if (!effects) {
      const clump = source.load(instance.model);
      const raw = clump ? loadRaw(instance.model) : null;
      effects = clump && raw ? collectClumpEffects(raw, clump, keepTypesFor('cell')) : [];
      cache.set(instance.model, effects);
    }
    if (effects.length === 0) {
      continue;
    }
    const transform = instanceTransform(conjugate(instance.rotation), instance.position, origin);
    const firstOfModel = !worldModelsDone.has(instance.model);
    worldModelsDone.add(instance.model);
    for (const effect of effects) {
      if (spaceOf(effect.type) !== 'world') {
        out.push(transform2dfxEntry(effect, transform));
      } else if (firstOfModel) {
        out.push(transform2dfxEntry(effect, rebase));
      }
    }
  }

  return out;
}

/**
 * Merge a cell's instances into one cell-centre-relative, native Z-up mesh (Phase 1), triangles bucketed by
 * texture. Every instance's atomics are placed by their IPL transform — **rotation = the conjugate of the IPL
 * quaternion** (GTA stores its inverse; matches `build-region.ts`) — offset to the cell centre (small coords for
 * float precision; the cell-LOD inst places it back). The DFF **frame** transform is ignored for a plain `objs`
 * clump, as the engine does; an IDE `anim` def's atomics ARE placed by their frame hierarchy (the engine's weld
 * composes `frameWorldTransform` for them — the Burger Shot sign sits on a child frame 7 m off the building's
 * origin, and ignoring it baked the sign in the middle of the roof), so the merge composes the same transform
 * ahead of the instance's: the animation's rest pose. The shared {@link MeshBuilder} (`@opensa/lod-common`)
 * accumulates the geometry so opensa and lod-procobj build LOD meshes by the same rules.
 */
export function mergeCell(cell: Cell, cellSize: number, source: ModelSource, registry?: ScopedRegistry): MergedMesh {
  const origin: Vec3 = [(cell.cx + 0.5) * cellSize, (cell.cy + 0.5) * cellSize, 0];
  const builder = new MeshBuilder();
  for (const instance of cell.instances) {
    const clump = source.load(instance.model);
    if (!clump) {
      continue;
    }
    // Scoped texture names (lod-common plan 004): bucket triangles by the (def txd, name) pair, not the bare
    // name — SA reuses names across TXDs with different pixels, and the bare-name bucket would merge two
    // models' different variants into one group (and the shared LOD TXD would then pick a random one).
    const textureName =
      registry === undefined ? undefined : (raw: string): string => registerScopedName(registry, instance.txd, raw);
    const transform = instanceTransform(conjugate(instance.rotation), instance.position, origin);
    for (const atomic of clump.atomics) {
      const geometry = clump.geometries[atomic.geometryIndex];
      if (geometry) {
        builder.add(geometry, atomicTransform(instance, clump, atomic.frameIndex, transform), textureName);
      }
    }
  }

  return builder.finish();
}

/** An `anim` atomic's model-space placement — its frame chain composed root→leaf (null = identity). */
function atomicFrameTransform(clump: RWClump, frameIndex: number): null | VertexTransform {
  const frame = frameWorldTransform(clump.frames, frameIndex);
  if (!frame) {
    return null;
  }
  const { pos, rot: m } = frame; // row-major mat3

  return {
    normal: (x, y, z): Vec3 => [
      m[0] * x + m[1] * y + m[2] * z,
      m[3] * x + m[4] * y + m[5] * z,
      m[6] * x + m[7] * y + m[8] * z,
    ],
    point: (x, y, z): Vec3 => [
      m[0] * x + m[1] * y + m[2] * z + pos[0],
      m[3] * x + m[4] * y + m[5] * z + pos[1],
      m[6] * x + m[7] * y + m[8] * z + pos[2],
    ],
  };
}

/** The instance transform, preceded by the atomic's frame placement when the def is an `anim` row. */
function atomicTransform(
  instance: CellInstance,
  clump: RWClump,
  frameIndex: number,
  transform: VertexTransform,
): VertexTransform {
  const framed = instance.anim !== undefined ? atomicFrameTransform(clump, frameIndex) : null;

  return framed ? compose(framed, transform) : transform;
}

/** `first`, then `second` — the frame placement into model space, then the instance placement into cell space. */
function compose(first: VertexTransform, second: VertexTransform): VertexTransform {
  return {
    normal: (x, y, z): Vec3 => second.normal(...first.normal(x, y, z)),
    point: (x, y, z): Vec3 => second.point(...first.point(x, y, z)),
  };
}

/** GTA IPL quaternions are the inverse of the standard convention — conjugate before use (cf. build-region). */
function conjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** The vertex map for one instance: rotate by `q`, then translate by `position`, offset to the cell `origin`. */
function instanceTransform(q: Quat, position: Vec3, origin: Vec3): VertexTransform {
  return {
    normal: (x, y, z) => rotate(q, x, y, z),
    point: (x, y, z): Vec3 => {
      const [rx, ry, rz] = rotate(q, x, y, z);

      return [rx + position[0] - origin[0], ry + position[1] - origin[1], rz + position[2] - origin[2]];
    },
  };
}

/**
 * The map for a WORLD-space position: re-base it on the cell centre, rotate it by nothing. The identity
 * `normal` is what keeps a plate's authored facing byte-verbatim — `transform2dfxEntry` rewrites the payload
 * only when something actually turned it.
 */
function originTransform(origin: Vec3): VertexTransform {
  return {
    normal: (x, y, z): Vec3 => [x, y, z],
    point: (x, y, z): Vec3 => [x - origin[0], y - origin[1], z - origin[2]],
  };
}

/** Rotate `(vx,vy,vz)` by quaternion `q` (x,y,z,w): `v + 2w(qv×v) + 2qv×(qv×v)`. */
function rotate(q: Quat, vx: number, vy: number, vz: number): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);

  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
