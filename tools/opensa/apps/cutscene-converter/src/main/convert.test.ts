import { describe, expect, it } from 'vitest';

import { convertArgs } from './convert';

const REQUEST = { carsPath: '/cars', gamePath: '/game', outPath: '/out' };

describe('convertArgs', () => {
  describe('negative cases', () => {
    // Without --no-base-copy the tool copies the whole game tree first: 600 MB of output becomes 2 GB,
    // and on a small disk the run dies half-way through.
    it('never omits --no-base-copy', () => {
      expect(convertArgs(REQUEST, '/child.cjs')).toContain('--no-base-copy');
    });

    // The user's game has no mod TXDs installed, so the txdp parent route cannot resolve; without this
    // flag every texture-closure miss is an error and the fleet comes out short.
    it('never omits --self-contained-txd', () => {
      expect(convertArgs(REQUEST, '/child.cjs')).toContain('--self-contained-txd');
    });

    it('passes no flag the app does not mean to pass', () => {
      const flags = convertArgs(REQUEST, '/child.cjs').filter((arg) => arg.startsWith('--'));

      expect(flags).toStrictEqual(['--game', '--in', '--out', '--no-base-copy', '--self-contained-txd']);
    });
  });

  describe('positive cases', () => {
    it('runs the child script with the three folders the user picked', () => {
      expect(convertArgs(REQUEST, '/child.cjs')).toStrictEqual([
        '/child.cjs',
        '--game',
        '/game',
        '--in',
        '/cars',
        '--out',
        '/out',
        '--no-base-copy',
        '--self-contained-txd',
      ]);
    });
  });
});
