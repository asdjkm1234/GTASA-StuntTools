import type { OspakManifest } from '@opensa/engine-formats';

import { describe, expect, it } from 'vitest';

import { COLLISION_KEY_PREFIX, PakCollisionSource } from './collision-source';
import { pakTraffic } from './pak-traffic';

/** A pak worker that records what it was asked for and answers on demand — the reads are promises, so a
 *  test drives the reply explicitly rather than waiting on a timer. */
function harness(
  collision?: OspakManifest['collision'],
  collisionCellSize = 256,
): {
  deliver: (key: string, buffer: ArrayBuffer | undefined, error?: string) => void;
  requested: { enc?: string; key: string; length: number; offset: number }[];
  source: PakCollisionSource;
} {
  const requested: { enc?: string; key: string; length: number; offset: number }[] = [];
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const worker = {
    addEventListener: (_type: string, listener: (event: { data: unknown }) => void): void => {
      listeners.push(listener);
    },
    postMessage: (message: { enc?: string; key: string; length: number; offset: number }): void => {
      requested.push(message);
    },
  } as unknown as Worker;
  const manifest = {
    byteLength: 4096,
    cells: {},
    cellSize: 250,
    ...(collision ? { collision, collisionCellSize } : {}),
    textures: {},
    version: 1,
  } as OspakManifest;

  return {
    deliver: (key: string, buffer: ArrayBuffer | undefined, error?: string): void => {
      for (const listener of listeners) {
        listener({ data: { buffer, ...(error !== undefined ? { error } : {}), key, type: 'blob' } });
      }
    },
    requested,
    source: new PakCollisionSource(manifest, worker),
  };
}

const entries = { '4,-7': { enc: 'deflate-raw' as const, hash: 0, length: 64, offset: 8192 } };

describe('PakCollisionSource', () => {
  describe('negative cases', () => {
    it('refuses a manifest whose collision entries do not say which grid they are keyed on', () => {
      const worker = { addEventListener: (): void => undefined, postMessage: (): void => undefined };
      const manifest = { byteLength: 0, cells: {}, cellSize: 250, collision: entries, textures: {}, version: 1 };

      expect(() => new PakCollisionSource(manifest as unknown as OspakManifest, worker as unknown as Worker)).toThrow(
        /collisionCellSize/,
      );
    });

    it('reports no bake for a cell the pak has no entry for, and asks the worker for nothing', async () => {
      const h = harness(entries);

      expect(h.source.has(9, 9)).toBe(false);
      await expect(h.source.read(9, 9)).resolves.toBeNull();
      expect(h.requested).toEqual([]);
    });

    it('resolves null on a failed read, so the caller falls back to parsing COL', async () => {
      const h = harness(entries);
      const read = h.source.read(4, -7);
      h.deliver(`${COLLISION_KEY_PREFIX}4,-7`, undefined, 'range fetch 416');

      await expect(read).resolves.toBeNull();
    });

    it('ignores a reply that is not a collision entry — the streaming driver shares this worker', async () => {
      const h = harness(entries);
      const read = h.source.read(4, -7);
      h.deliver('4,-7,hd', new Uint8Array([9]).buffer);
      h.deliver('array-3', new Uint8Array([9]).buffer);
      h.deliver(`${COLLISION_KEY_PREFIX}4,-7`, new Uint8Array([1, 2]).buffer);

      await expect(read).resolves.toEqual(new Uint8Array([1, 2]));
    });
  });

  describe('positive cases', () => {
    it('publishes the GAME grid its entries are keyed on, not the pak render grid', () => {
      expect(harness(entries).source.cellSize).toBe(256);
      expect(harness(entries).source.has(4, -7)).toBe(true);
    });

    it('asks the worker for the entry range, prefixed so the two payload kinds stay distinguishable', () => {
      const h = harness(entries);
      void h.source.read(4, -7);

      expect(h.requested).toEqual([
        { enc: 'deflate-raw', key: `${COLLISION_KEY_PREFIX}4,-7`, length: 64, offset: 8192, type: 'fetch' },
      ]);
    });

    it('COUNTS what it read into the pak-traffic ledger — the bytes column of 201/1-01', () => {
      // The ledger's value is the gap between what a pak contains and what a surface asks for, so it has to
      // be fed by the REAL request path rather than by a helper nobody calls. This is that path.
      pakTraffic.reset();
      const h = harness(entries);
      void h.source.read(4, -7);

      expect(pakTraffic.report()).toEqual([{ bytes: 64, kind: 'collision', requests: 1 }]);
      pakTraffic.reset();
    });

    it('shares ONE range read between two callers asking for the same cell at once', async () => {
      const h = harness(entries);
      const first = h.source.read(4, -7);
      const second = h.source.read(4, -7);
      h.deliver(`${COLLISION_KEY_PREFIX}4,-7`, new Uint8Array([7]).buffer);

      await expect(Promise.all([first, second])).resolves.toEqual([new Uint8Array([7]), new Uint8Array([7])]);
      expect(h.requested).toHaveLength(1);
    });

    it('re-reads a cell after a failure rather than remembering it as empty', async () => {
      const h = harness(entries);
      const failed = h.source.read(4, -7);
      h.deliver(`${COLLISION_KEY_PREFIX}4,-7`, undefined, 'range fetch 500');
      await failed;

      const retry = h.source.read(4, -7);
      h.deliver(`${COLLISION_KEY_PREFIX}4,-7`, new Uint8Array([3]).buffer);

      await expect(retry).resolves.toEqual(new Uint8Array([3]));
      expect(h.requested).toHaveLength(2);
    });
  });
});
