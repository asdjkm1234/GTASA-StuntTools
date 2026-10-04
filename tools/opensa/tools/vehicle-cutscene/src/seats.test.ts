import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readClump, writeClump } from './rig/clump-io';
import { worldTransforms } from './rig/emit';
import { matchSeat, resolveSeatPoints, type SeatPoint } from './seats';

const TAXI = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/taxi.dff'));
const BOBCAT = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/bobcat.dff'));

function seatsOf(donor: Uint8Array, shiftZ: number): SeatPoint[] {
  const model = readClump(donor);

  return resolveSeatPoints(model, worldTransforms(model), shiftZ);
}

/** The donor with the named frames renamed out of the way — a mod that states no seat. */
function withoutFrames(donor: Uint8Array, names: readonly string[]): Uint8Array {
  const model = readClump(donor);
  for (const frame of model.frames) {
    if (names.includes(frame.name.trim())) {
      frame.name = `gone_${frame.name.trim()}`;
    }
  }

  return writeClump(model);
}

describe('resolveSeatPoints', () => {
  describe('negative cases', () => {
    it('states nothing when the donor carries no seat dummy — the scene keeps its own placement', () => {
      expect(seatsOf(withoutFrames(TAXI, ['ped_frontseat', 'ped_backseat']), 0)).toEqual([]);
    });

    it('ignores the other ped dummies — ped_arm is not a seat', () => {
      const dummies = seatsOf(withoutFrames(TAXI, ['ped_frontseat', 'ped_backseat']), 0);
      expect(dummies).toEqual([]);
      expect(readClump(TAXI).frames.some((frame) => frame.name.trim() === 'ped_arm')).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('reads both rows of the taxi, each with its x-mirror', () => {
      const seats = seatsOf(TAXI, 0);
      expect(seats.map((seat) => `${seat.dummy}${seat.mirrored ? '-mirror' : ''}`).sort()).toEqual([
        'ped_backseat',
        'ped_backseat-mirror',
        'ped_frontseat',
        'ped_frontseat-mirror',
      ]);
      const front = seats.find((seat) => seat.dummy === 'ped_frontseat' && !seat.mirrored)!;
      const mirror = seats.find((seat) => seat.dummy === 'ped_frontseat' && seat.mirrored)!;
      expect(front.position[0]).toBeCloseTo(0.517, 3);
      expect(mirror.position[0]).toBeCloseTo(-0.517, 3);
      // Only x flips: a mirrored seat is the same row, the same height.
      expect(mirror.position[1]).toBeCloseTo(front.position[1], 6);
      expect(mirror.position[2]).toBeCloseTo(front.position[2], 6);
    });

    it('lifts the seat into cutscene space by the conversion ground shift', () => {
      // The glendale's measured case (plan 005): a donor seat at -0.048 under a +0.209 lift resolves
      // to +0.161, which is 0.281 m above where SMOKE2B's anim puts the actor (-0.120).
      const flat = seatsOf(BOBCAT, 0).find((seat) => !seat.mirrored)!;
      const lifted = seatsOf(BOBCAT, 0.209).find((seat) => !seat.mirrored)!;
      expect(lifted.position[2]).toBeCloseTo(flat.position[2] + 0.209, 6);
      expect(lifted.position[0]).toBeCloseTo(flat.position[0], 6);
    });
  });
});

describe('matchSeat', () => {
  describe('negative cases', () => {
    it('matches nothing when the offset is nowhere near a seat', () => {
      // PROLOG1's csstew rides 1.68 m forward of the taxi root — not a seat, and the census flags him
      // at 92 % seated for exactly that reason.
      expect(matchSeat(seatsOf(TAXI, 0), [-0.24, 1.68, -0.08])).toBeNull();
    });

    it('matches nothing when the donor states no seat at all', () => {
      expect(matchSeat([], [0.52, 0.06, -0.11])).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('picks the side the actor actually rides on, ignoring z', () => {
      const seats = seatsOf(TAXI, 0);
      // z is deliberately absurd: it is the quantity being corrected, so it may not be evidence.
      const right = matchSeat(seats, [0.52, 0.06, -9])!;
      const left = matchSeat(seats, [-0.52, 0.06, -9])!;
      expect(right.dummy).toBe('ped_frontseat');
      expect(right.mirrored).toBe(false);
      expect(left.dummy).toBe('ped_frontseat');
      expect(left.mirrored).toBe(true);
    });

    it('picks the ROW nearest in y — front seat over back seat', () => {
      const seats = seatsOf(TAXI, 0);
      expect(matchSeat(seats, [0.52, -1.02, 0])!.dummy).toBe('ped_backseat');
      expect(matchSeat(seats, [0.52, 0.06, 0])!.dummy).toBe('ped_frontseat');
    });
  });
});
