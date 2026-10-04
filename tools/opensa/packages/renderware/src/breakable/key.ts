/**
 * The identity of a smashable prop placement — the ONE contract that pairs three separate systems: the
 * physics collider (which reports the hit), the render prop (which must disappear), and, on the own engine,
 * the converter (which decides at BUILD time which draw run belongs to which placement).
 *
 * Renderer-agnostic on purpose: the three path and the WebGPU path must agree byte for byte, or a hit resolves
 * to the wrong prop — or to none.
 */

/** Stable key for a placement (cm precision, GTA world coords) — shared by the render prop and its collider. */
export function breakableInstanceKey(modelName: string, position: readonly [number, number, number]): string {
  const cm = (value: number): number => Math.round(value * 100);

  return `${modelName.toLowerCase()}|${cm(position[0])}|${cm(position[1])}|${cm(position[2])}`;
}

/**
 * The same key as a u32 (FNV-1a), so it fits the `.oscell` objectTable's `params` field. The pak cannot carry
 * the string — it has no string table — and the engine only ever needs to ANSWER "is this the run to hide",
 * which an equality test on the hash answers. Both sides must hash identically; that is why this lives here
 * and not in either renderer.
 */
export function breakableKeyHash(key: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < key.length; at += 1) {
    hash ^= key.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}
