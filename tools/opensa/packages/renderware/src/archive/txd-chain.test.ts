import { afterEach, describe, expect, it } from 'vitest';

/**
 * The `txdp` walk (opensa-pack 003 phase 3) — the UNOPTIMIZED path's texture resolution.
 *
 * `MapDefinitions.txdParents` was built and carried to the engine for a long time and read by NOBODY, so a
 * modded TXD with a parent silently lost every inherited texture. The bug went unnoticed because the only
 * consumer that mattered lived on the CONVERTER side (`TexturePlanner` flattens the chain at weld time),
 * and the mod that emits a real `txdp` — mod-installer's HD-swap — targets map models, which weld offline.
 */
import type { ImgArchive } from './img-archive';

import { getTxdChain, setTxdParents } from './asset-cache';

/** An archive whose entries are their own names as bytes, so a chain is readable in the assertions. */
function archiveOf(names: readonly string[]): ImgArchive {
  const present = new Set(names);

  return {
    get: (name: string): ArrayBuffer | null =>
      present.has(name.toLowerCase()) ? new TextEncoder().encode(name.toLowerCase()).buffer : null,
    names: [...present],
  };
}

const decode = (chain: readonly ArrayBuffer[]): string[] => chain.map((bytes) => new TextDecoder().decode(bytes));

afterEach(() => {
  setTxdParents(undefined); // module-level state — never leak a chain into the next test
});

describe('getTxdChain', () => {
  describe('negative cases', () => {
    it('returns nothing when the TXD is absent', () => {
      expect(getTxdChain(archiveOf([]), 'mytreetxd')).toEqual([]);
    });

    it('is a no-op on a self-contained archive (no parents installed)', () => {
      const chain = getTxdChain(archiveOf(['mytreetxd.txd']), 'mytreetxd');

      expect(decode(chain)).toEqual(['mytreetxd.txd']);
    });

    it('does not loop forever on a cyclic txdp', () => {
      setTxdParents(
        new Map([
          ['a', 'b'],
          ['b', 'a'],
        ]),
      );

      expect(decode(getTxdChain(archiveOf(['a.txd', 'b.txd']), 'a'))).toEqual(['a.txd', 'b.txd']);
    });

    it('skips a parent whose TXD is missing instead of dropping the child', () => {
      setTxdParents(new Map([['mytreetxd', 'vegetation']]));

      expect(decode(getTxdChain(archiveOf(['mytreetxd.txd']), 'mytreetxd'))).toEqual(['mytreetxd.txd']);
    });

    it('does not serve one archive a TXD that only another archive carries', () => {
      // The bytes cache behind the chain is keyed PER ARCHIVE. Keyed by name alone it hands the second
      // archive whatever the first cached — the wrong dictionary, or one this archive does not have.
      expect(decode(getTxdChain(archiveOf(['mytreetxd.txd']), 'mytreetxd'))).toEqual(['mytreetxd.txd']);

      expect(getTxdChain(archiveOf([]), 'mytreetxd')).toEqual([]);
    });

    it('still yields the parent when the CHILD TXD is the missing one', () => {
      // A mod may declare a txdp for a dictionary it never ships; the parent must still be reachable.
      setTxdParents(new Map([['mytreetxd', 'vegetation']]));

      expect(decode(getTxdChain(archiveOf(['vegetation.txd']), 'mytreetxd'))).toEqual(['vegetation.txd']);
    });
  });

  describe('positive cases', () => {
    it('puts the child FIRST and its parent after — the merge rule both consumers use', () => {
      // The real case: mod-installer's HD-swap mod parents `mytreetxd` to `vegetation`.
      setTxdParents(new Map([['mytreetxd', 'vegetation']]));

      const chain = getTxdChain(archiveOf(['mytreetxd.txd', 'vegetation.txd']), 'mytreetxd');

      expect(decode(chain)).toEqual(['mytreetxd.txd', 'vegetation.txd']);
    });

    it('walks the whole ancestry, nearest first', () => {
      setTxdParents(
        new Map([
          ['child', 'parent'],
          ['parent', 'grandparent'],
        ]),
      );

      const chain = getTxdChain(archiveOf(['child.txd', 'grandparent.txd', 'parent.txd']), 'child');

      expect(decode(chain)).toEqual(['child.txd', 'parent.txd', 'grandparent.txd']);
    });

    it('is case-insensitive on the requested name', () => {
      setTxdParents(new Map([['mytreetxd', 'vegetation']]));

      expect(decode(getTxdChain(archiveOf(['mytreetxd.txd', 'vegetation.txd']), 'MyTreeTxd'))).toEqual([
        'mytreetxd.txd',
        'vegetation.txd',
      ]);
    });

    it('drops the installed chain when the parents are cleared', () => {
      setTxdParents(new Map([['mytreetxd', 'vegetation']]));
      setTxdParents(undefined);

      expect(decode(getTxdChain(archiveOf(['mytreetxd.txd', 'vegetation.txd']), 'mytreetxd'))).toEqual([
        'mytreetxd.txd',
      ]);
    });
  });
});
