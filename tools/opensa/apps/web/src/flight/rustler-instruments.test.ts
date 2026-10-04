import { describe, expect, it } from 'vitest';

import { rustlerStatusLamps } from './cockpit-instruments';

describe('Rustler embedded status lamps', () => {
  it('lights the down lamp only when fully down, independently of surface damage', () => {
    for (const gear of ['DOWN', 'MOVING', 'UP'] as const) {
      expect(rustlerStatusLamps({ damage: [0, 0, 0, 0, 0], gear })).toEqual({
        damage: 'healthy',
        gearDown: gear === 'DOWN',
      });
      expect(rustlerStatusLamps({ damage: [0, 1, 0, 0, 0], gear })).toEqual({
        damage: 'damaged',
        gearDown: gear === 'DOWN',
      });
    }
  });
  it('prioritizes any measured damage and keeps missing/partial damage unknown', () => {
    for (let index = 0; index < 5; index++) {
      for (const value of [1, 2, 3]) {
        const damage: (null | number)[] = [null, null, null, null, null];
        damage[index] = value;
        expect(rustlerStatusLamps({ damage, gear: 'UP' }).damage).toBe('damaged');
      }
    }
    for (const damage of [[], [0, 0], [null, null, null, null, null], [0, 0, null, 0, 0]])
      expect(rustlerStatusLamps({ damage, gear: 'DOWN' }).damage).toBe('unknown');
  });
});
