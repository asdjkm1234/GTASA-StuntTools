import { keepTypesFor } from '@opensa/lod-common/two-dfx-policy';
import { strip2dfxEntries } from '@opensa/rw-codec/dff';
import { PARTICLE_2DFX } from '@opensa/rw-codec/two-d-effect';

/**
 * What 2dfx a clone carries, for every path in this generator (plan 100/05). One place, because there are
 * three clone paths — decimated re-encode, verbatim byte copy, and the hole-fill copy — and they used to
 * disagree by accident rather than by decision.
 *
 * The set is `@opensa/lod-common`'s declared policy for the `clone` target. **Real SA reads 2dfx off whatever
 * model it streams**, so a clone's own section is live and no consumer change is needed on this side; what the
 * policy decides is only what rides.
 */
export function cloneKeepTypes(keepParticles: boolean): ReadonlySet<number> {
  const keep = new Set(keepTypesFor('clone'));
  if (!keepParticles) {
    // `--strip-particles`: the pre-009 behaviour for a STOCK target, where cloned emitters never unload and
    // crash the game (`asi/perfect-map` 009). An override of the policy, not a second code path.
    keep.delete(PARTICLE_2DFX);
  }

  return keep;
}

/**
 * Apply the policy SUBTRACTIVELY to a verbatim byte-copy clone: cut out the entries it may not carry, leave
 * everything else byte-for-byte. A full re-encode would throw away the plugins the byte copy exists to
 * preserve (breakable, and whatever else our writers do not model), so a rejected type is removed in place.
 *
 * On the stock corpus this removes nothing but particles under `--strip-particles` — every type stock uses is
 * `carry` on this target. It is here for the type a mod invents, which the policy drops by default.
 */
export function stripCloneTo(bytes: Uint8Array, keep: ReadonlySet<number>): Uint8Array {
  return strip2dfxEntries(bytes, (type) => keep.has(type));
}
