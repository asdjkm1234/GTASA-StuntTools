import { describe, expect, it } from 'vitest';

import type { MarkerProjection } from './endpoint-picking';

import { pickEndpointMarker } from './endpoint-picking';

describe('coincident beacon selection without a list panel', () => {
  const projections: MarkerProjection[] = [
    { onScreen: true, slot: 0, trackIndex: 0, x: 500, y: 300 },
    { onScreen: true, slot: 1, trackIndex: 2, x: 500, y: 300 },
    { onScreen: true, slot: 2, trackIndex: 3, x: 500, y: 300 },
  ];

  it('cycles through every coincident recording in import order, including sparse track indices', () => {
    let active = -1;
    const selected = Array.from({ length: 7 }, () => {
      active = pickEndpointMarker(projections, 500, 300, 26, active)!.trackIndex;

      return active;
    });
    expect(selected).toEqual([0, 2, 3, 0, 2, 3, 0]);
  });

  it('preserves nearest-target selection when the current record belongs to another group', () => {
    const other = { onScreen: true, slot: 3, trackIndex: 4, x: 600, y: 300 };
    expect(pickEndpointMarker([...projections, other], 500, 300, 26, 4)?.trackIndex).toBe(0);
    expect(pickEndpointMarker([...projections, other], 600, 300, 26, 2)?.trackIndex).toBe(4);
    expect(pickEndpointMarker(projections, 800, 300, 26, 2)).toBeNull();
  });
});
