import { describe, expect, it } from 'vitest';

import type { Operations, Unit } from './types';

import { UNITS_ON_SCREEN } from './budget';
import { BYTES_PER_SAMPLE, PUBLISH_INTERVAL_MS, RECORD_INTERVAL_MS, SAMPLES_PER_TRACK, UnitTracks } from './tracks';

function board(now: number, units: readonly Partial<Unit>[]): Operations {
  return {
    incidents: [],
    log: [],
    now,
    units: units.map((unit, index) => ({
      at: [0, 0],
      callsign: `U${index}`,
      elevation: 13,
      heading: 0,
      id: `u${index}`,
      incident: null,
      kind: 'patrol',
      model: 'copcarls',
      status: 'available',
      target: null,
      ...unit,
    })),
  };
}

/** Drive one unit along +x at `speed` world units per second, ticking at 20 Hz like the app does. */
function drive(tracks: UnitTracks, seconds: number, speed: number, from = 0): void {
  for (let ms = from; ms <= from + seconds * 1000; ms += 50) {
    tracks.record(board(ms, [{ at: [(ms / 1000) * speed, 0] }]));
  }
}

describe('UnitTracks', () => {
  describe('negative cases', () => {
    it('does not grow the history when the feed speeds up — the ring is sized by OUR interval', () => {
      // The trap the two constants were split for (2026-08-26). A socket feed at 10 Hz delivers 40 fixes in
      // the time PCAD delivers one; recording all of them would quadruple-and-then-some a shift's memory on
      // a phone, for a change nobody would connect to a feed setting.
      const fast = new UnitTracks();
      const slow = new UnitTracks();
      for (let ms = 0; ms <= 60_000; ms += 100) {
        fast.record(board(ms, [{ at: [ms / 100, 0] }]));
      }
      for (let ms = 0; ms <= 60_000; ms += RECORD_INTERVAL_MS) {
        slow.record(board(ms, [{ at: [ms / 100, 0] }]));
      }

      expect(fast.stats().samples).toBe(slow.stats().samples);
      expect(fast.stats().bytes).toBe(slow.stats().bytes);
    });

    it('answers null for a unit it has never seen', () => {
      expect(new UnitTracks().at('nobody', 0)).toBeNull();
    });

    it('does NOT extrapolate past the last sample — it holds, and says how old the answer is', () => {
      const tracks = new UnitTracks();
      drive(tracks, 20, 10);
      const last = tracks.at('u0', 20_000);

      const later = tracks.at('u0', 80_000);
      expect(later?.at).toEqual(last?.at);
      expect(later?.stale).toBe(true);
      expect(later?.ageMs).toBeGreaterThan(55_000);
    });

    it('is not stale inside one publish interval — a fix that has not arrived yet is not a lie', () => {
      const tracks = new UnitTracks();
      drive(tracks, 20, 10);

      expect(tracks.at('u0', 20_000 + PUBLISH_INTERVAL_MS - 1)?.stale).toBe(false);
    });

    it('answers the first sample before the track starts, rather than nothing', () => {
      const tracks = new UnitTracks();
      tracks.record(board(10_000, [{ at: [100, 200] }]));

      expect(tracks.at('u0', 0)?.at).toEqual([100, 200]);
    });

    it('records at the PUBLISH rate, not the tick rate — 20 Hz in must not be 20 Hz stored', () => {
      const tracks = new UnitTracks();
      drive(tracks, 60, 10);

      // 60 s at one sample per 4 s, plus the first: nothing like the 1201 ticks that went in.
      expect(tracks.stats().samples).toBeLessThanOrEqual(60_000 / RECORD_INTERVAL_MS + 2);
      expect(tracks.stats().samples).toBeGreaterThan(10);
    });

    it('collapses a stationary run to its two ends — a parked shift is not 7200 samples', () => {
      const tracks = new UnitTracks();
      for (let ms = 0; ms <= 3_600_000; ms += 1000) {
        tracks.record(board(ms, [{ at: [500, -500] }]));
      }

      expect(tracks.stats().samples).toBe(2);
      expect(tracks.at('u0', 1_800_000)?.at).toEqual([500, -500]);
    });

    it('drops the oldest sample when the ring wraps rather than growing', () => {
      const tracks = new UnitTracks(4);
      drive(tracks, 40, 10);
      const stats = tracks.stats();

      expect(stats.samples).toBe(4);
      expect(stats.bytes).toBe(4 * BYTES_PER_SAMPLE);
    });

    it('forgets a unit that went off duty', () => {
      const tracks = new UnitTracks();
      tracks.record(board(0, [{ at: [1, 2] }]));
      tracks.forget('u0');

      expect(tracks.at('u0', 0)).toBeNull();
      expect(tracks.stats().tracks).toBe(0);
    });
  });

  describe('positive cases', () => {
    it("answers with the LAST FIX between two samples — it does not slide (the user's call, 08-22)", () => {
      const tracks = new UnitTracks();
      drive(tracks, 20, 10);
      const midway = tracks.at('u0', 6000);

      // 10 u/s at a 4 s rate: the fix at t=4 s puts the unit at x=40, and t=6 s is still that fix. A slide
      // would answer 60 — smooth, confident, and a position nobody reported.
      expect(midway?.at[0]).toBeCloseTo(40, 0);
      expect(midway?.stale).toBe(false);
      expect(midway?.ageMs).toBe(0);
    });

    it('gives every unit status a distinct stored id — an unknown one wrote 255 and replayed as available', () => {
      const tracks = new UnitTracks();
      const statuses: Unit['status'][] = ['available', 'busy', 'enRoute', 'onScene'];
      for (const [i, status] of statuses.entries()) {
        tracks.record(board(i * RECORD_INTERVAL_MS, [{ at: [i, 0], status }]));
      }

      // Each reads back as itself. Before the ids were exhaustive by type, a status outside the table
      // stored 255, came back `available`, and sampled on every tick instead of every 4 s.
      for (const [i, status] of statuses.entries()) {
        expect(tracks.at('u0', i * RECORD_INTERVAL_MS)?.status).toBe(status);
      }
      expect(tracks.stats().samples).toBe(statuses.length);
    });

    it('samples a status change immediately, whatever the rate limit says', () => {
      const tracks = new UnitTracks();
      tracks.record(board(0, [{ at: [0, 0], status: 'available' }]));
      tracks.record(board(100, [{ at: [0, 0], status: 'enRoute' }]));

      expect(tracks.stats().samples).toBe(2);
      expect(tracks.at('u0', 100)?.status).toBe('enRoute');
    });

    it('carries the heading of the fix it answers with, unblended', () => {
      const tracks = new UnitTracks();
      tracks.record(board(0, [{ at: [0, 0], heading: 0.1 }]));
      tracks.record(board(RECORD_INTERVAL_MS, [{ at: [40, 0], heading: Math.PI * 2 - 0.1 }]));

      // No blend, so no wrap-around question to get wrong: each answer is one recorded heading.
      expect(tracks.at('u0', RECORD_INTERVAL_MS / 2)?.heading).toBeCloseTo(0.1, 5);
      expect(tracks.at('u0', RECORD_INTERVAL_MS)?.heading).toBeCloseTo(Math.PI * 2 - 0.1, 5);
    });

    it('reports the window it holds, so a scrub knows what it may ask for', () => {
      const tracks = new UnitTracks();
      drive(tracks, 30, 10);

      expect(tracks.stats().window?.[0]).toBe(0);
      expect(tracks.stats().window?.[1]).toBeGreaterThanOrEqual(28_000);
    });
  });
});

describe('UnitTracks.trail', () => {
  describe('negative cases', () => {
    it('has nothing to draw for a unit it never saw', () => {
      expect(new UnitTracks().trail('nobody', 0, 100)).toBeNull();
    });

    it('has nothing to draw from a single sample — a point is not a path', () => {
      const tracks = new UnitTracks();
      tracks.record(board(0, [{ at: [10, 10] }]));

      expect(tracks.trail('u0', 0, 100)).toBeNull();
    });

    it('stops at the last status change — the leg, not the whole shift', () => {
      const tracks = new UnitTracks();
      // 40 s available, then 40 s en route, sampling every 4 s.
      for (let ms = 0; ms <= 80_000; ms += 50) {
        tracks.record(board(ms, [{ at: [ms / 100, 0], status: ms < 40_000 ? 'available' : 'enRoute' }]));
      }
      const leg = tracks.trail('u0', 80_000, 1000);

      // Every point of the leg is from the en-route half: x = ms/100, so x >= 400.
      expect(leg).not.toBeNull();
      for (let i = 0; i < (leg?.length ?? 0); i += 2) {
        expect(leg?.[i]).toBeGreaterThanOrEqual(400);
      }
    });

    it('never returns more points than the work bound allows', () => {
      const tracks = new UnitTracks();
      drive(tracks, 600, 10);

      expect((tracks.trail('u0', 600_000, 20)?.length ?? 0) / 2).toBeLessThanOrEqual(20);
    });
  });

  describe('positive cases', () => {
    it('walks the leg up to the moment asked for, and no further', () => {
      const tracks = new UnitTracks();
      drive(tracks, 100, 10);
      const half = tracks.trail('u0', 50_000, 1000);

      expect(half).not.toBeNull();
      // 10 u/s at one sample per 4 s: the last point is the fix at or before 50 s, never past it.
      expect(half?.[(half.length ?? 2) - 2]).toBeLessThanOrEqual(500);
      expect(half?.[(half.length ?? 2) - 2]).toBeGreaterThan(500 - 10 * 4 - 1);
      expect(tracks.trail('u0', 100_000, 1000)?.length).toBeGreaterThan(half?.length ?? 0);
    });
  });
});

describe('UnitTracks cost', () => {
  describe('positive cases', () => {
    it('prices the declared worst case: 150 units, one shift, at the publish rate', () => {
      const tracks = new UnitTracks();
      tracks.record(
        board(
          0,
          Array.from({ length: UNITS_ON_SCREEN }, () => ({})),
        ),
      );
      const { bytes } = tracks.stats();

      expect(bytes).toBe(UNITS_ON_SCREEN * SAMPLES_PER_TRACK * BYTES_PER_SAMPLE);
      // 17.51 MB, measured against a real `arrayBuffers` delta in
      // docs/benchmarks/opensa-engine/2026-08-22-dispatch-track-memory.json. HOST bytes, never the GPU
      // residency ceiling.
      expect(bytes / (1024 * 1024)).toBeCloseTo(17.51, 1);
    });
  });
});
