/**
 * Baked cell collision, read out of the pak (plan 200/3-01, the runtime half).
 *
 * The bake put the COL parse in the converter; this is what makes the runtime stop doing it. The bytes ride
 * the SAME pak worker the cells do — one file handle, one range reader, no second fetch path — and a read is
 * a promise the collision streamer already awaits, so the parse the main thread used to pay 9.6–78.3 ms per
 * cell for becomes a range read in the worker plus a decode in a continuation.
 *
 * **The grid is the trap.** These entries are keyed on the GAME grid (`collisionCellSize`, 256), not on the
 * render grid (`cellSize`, 250) — two tessellations of one world. A caller streaming on the wrong one gets a
 * NEIGHBOURING cell's colliders rather than none, and the field reads that as a physics bug, so
 * {@link PakCollisionSource.cellSize} is published for the consumer to check against its own
 * (`docs/restrictions/architecture.md`).
 *
 * A miss is not an error: a cell with no collision, a pak built without `--bake-collision`, and a failed read
 * all answer `null`, and the caller falls back to parsing COL exactly as it always did.
 */
import type { OspakEntry, OspakManifest } from '@opensa/engine-formats';

import type { PakWorkerResponse } from './pak-worker';

import { postPakFetch } from './pak-traffic';

/** Wire-key prefix for a collision entry. The streaming driver shares this worker and sees every reply, so
 *  the two payload kinds must be distinguishable by key alone — a bare `"cx,cy"` is one `,level` away from
 *  a cell key, and a driver that mistook one for the other would silently drop it into its blob table. */
export const COLLISION_KEY_PREFIX = 'collision-';

export class PakCollisionSource {
  /** The grid the entries are keyed on (engine units) — the consumer checks its own streaming grid against
   *  this rather than assuming, because the two grids differ and nothing else catches it. */
  readonly cellSize: number;

  private readonly entries: Record<string, OspakEntry>;
  /** In-flight reads by wire key: two cells asking at once share one range read. */
  private readonly pending = new Map<string, ((bytes: null | Uint8Array) => void)[]>();
  /** Keys already reported as failed — one line each, not one per retry. */
  private readonly warned = new Set<string>();
  private readonly worker: Worker;

  constructor(manifest: OspakManifest, worker: Worker) {
    if (manifest.collision === undefined || manifest.collisionCellSize === undefined) {
      throw new Error('PakCollisionSource needs a manifest with collision entries and their collisionCellSize');
    }
    this.entries = manifest.collision;
    this.cellSize = manifest.collisionCellSize;
    this.worker = worker;
    worker.addEventListener('message', (event: MessageEvent<PakWorkerResponse>) => this.onBlob(event.data));
  }

  /** Whether the pak carries a bake for this cell. Asked BEFORE `read` so a caller with no bake to wait for
   *  never introduces an `await` into its path — an empty cell contributes no entry, and neither does a pak
   *  built without the bake. */
  has(cx: number, cy: number): boolean {
    return this.entries[`${cx},${cy}`] !== undefined;
  }

  /** The cell's raw `.oscol` bytes, or null when the pak has no bake for it (or the read failed). */
  async read(cx: number, cy: number): Promise<null | Uint8Array> {
    const cellKey = `${cx},${cy}`;
    const entry = this.entries[cellKey];
    if (!entry) {
      return null;
    }
    const key = `${COLLISION_KEY_PREFIX}${cellKey}`;
    const waiting = this.pending.get(key);
    if (waiting) {
      return new Promise((resolve) => waiting.push(resolve));
    }

    return new Promise((resolve) => {
      this.pending.set(key, [resolve]);
      postPakFetch(this.worker, key, entry);
    });
  }

  private onBlob(message: PakWorkerResponse): void {
    if (message.type !== 'blob' || !message.key.startsWith(COLLISION_KEY_PREFIX)) {
      return;
    }
    const waiting = this.pending.get(message.key);
    if (!waiting) {
      return;
    }
    this.pending.delete(message.key);
    if (!message.buffer && !this.warned.has(message.key)) {
      this.warned.add(message.key);
      // eslint-disable-next-line no-console -- the fallback is a working world that quietly costs a COL parse per cell
      console.warn(`[stream] baked collision ${message.key} failed: ${message.error ?? 'unknown'} — parsing COL`);
    }
    const bytes = message.buffer ? new Uint8Array(message.buffer) : null;
    for (const resolve of waiting) {
      resolve(bytes);
    }
  }
}
