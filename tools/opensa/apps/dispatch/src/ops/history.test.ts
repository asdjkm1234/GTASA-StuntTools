import { describe, expect, it } from 'vitest';

import type { Incident, Operations, Unit } from './types';

import { BoardHistory } from './history';

function board(now: number, units: readonly Unit[], incidents: readonly Incident[] = []): Operations {
  return { incidents, log: ['live'], now, units };
}

function call(id: string, opened: number, status: Incident['status'] = 'pending'): Incident {
  return {
    assigned: [],
    at: [500, -500],
    code: '10-50',
    id,
    opened,
    place: 'Ganton',
    priority: 2,
    remaining: 30,
    status,
    title: 'Traffic collision',
  };
}

/** Tick a moving unit at the app's 20 Hz so the sampling policy is exercised rather than bypassed. */
function run(history: BoardHistory, seconds: number, make: (ms: number) => Operations): void {
  for (let ms = 0; ms <= seconds * 1000; ms += 50) {
    history.record(make(ms));
  }
}

function unit(id: string, at: [number, number], status: Unit['status'] = 'available'): Unit {
  return {
    at,
    callsign: id,
    elevation: 13,
    heading: 0,
    id,
    incident: null,
    kind: 'patrol',
    model: 'copcarls',
    status,
    target: null,
  };
}

describe('BoardHistory', () => {
  describe('negative cases', () => {
    it('has no window before anything is recorded, so nothing can be scrubbed to', () => {
      expect(new BoardHistory().window()).toBeNull();
    });

    it('does not put a call on the board before it was opened', () => {
      const history = new BoardHistory();
      run(history, 60, (ms) => board(ms, [unit('u1', [0, 0])], ms >= 30_000 ? [call('i1', 30_000)] : []));

      expect(history.at(10_000, board(60_000, [], [call('i1', 30_000)])).incidents).toHaveLength(0);
      expect(history.at(45_000, board(60_000, [], [call('i1', 30_000)])).incidents).toHaveLength(1);
    });

    it('keeps a unit that went OFF DUTY in the replay of when it was on', () => {
      const history = new BoardHistory();
      run(history, 60, (ms) => board(ms, [unit('u1', [ms / 100, 0]), unit('u2', [500, -500])]));
      // u2 leaves the live roster. The hour it worked must not leave with it.
      run(history, 30, (ms) => board(60_000 + ms, [unit('u1', [(60_000 + ms) / 100, 0])]));
      const live = board(90_000, [unit('u1', [900, 0])]);

      expect(
        history
          .at(30_000, live)
          .units.map((entry) => entry.id)
          .sort(),
      ).toEqual(['u1', 'u2']);
      expect(history.at(85_000, live).units.map((entry) => entry.id)).toEqual(['u1', 'u2']);
    });

    it('forgets a unit outright when asked, roster and track together', () => {
      const history = new BoardHistory();
      run(history, 20, (ms) => board(ms, [unit('u1', [ms / 100, 0]), unit('u2', [1, 1])]));
      history.forget('u2');

      expect(history.at(10_000, board(20_000, [])).units.map((entry) => entry.id)).toEqual(['u1']);
    });

    it('drops a unit it has no sample for rather than drawing it where nobody saw it', () => {
      const history = new BoardHistory();
      history.record(board(0, [unit('u1', [10, 10])]));
      // u2 was never recorded, so it is in no roster and no track — the replay cannot place it.
      const resolved = history.at(0, board(0, [unit('u1', [10, 10]), unit('u2', [99, 99])]));

      expect(resolved.units.map((entry) => entry.id)).toEqual(['u1']);
    });
  });

  describe('positive cases', () => {
    it('puts the units back where they were an hour into the shift', () => {
      const history = new BoardHistory();
      run(history, 600, (ms) => board(ms, [unit('u1', [(ms / 1000) * 10, 0])]));
      const then = history.at(120_000, board(600_000, [unit('u1', [6000, 0])]));

      // Stepped, so the answer is the last fix at or before 120 s rather than a blend through it: within
      // one 4 s publish interval of 1200 (10 u/s x 120 s), never past it.
      expect(then.units[0].at[0]).toBeGreaterThan(1200 - 10 * 4);
      expect(then.units[0].at[0]).toBeLessThanOrEqual(1200);
      expect(then.now).toBe(120_000);
    });

    it('gives a call the status it HAD, not the one it ended with', () => {
      const history = new BoardHistory();
      run(history, 120, (ms) => board(ms, [unit('u1', [0, 0])], [call('i1', 0, ms >= 60_000 ? 'closed' : 'pending')]));
      const live = board(120_000, [unit('u1', [0, 0])], [call('i1', 0, 'closed')]);

      expect(history.at(30_000, live).incidents[0].status).toBe('pending');
      expect(history.at(90_000, live).incidents[0].status).toBe('closed');
    });

    it('gives a unit the status it HAD — a scrub must not colour the past with today', () => {
      const history = new BoardHistory();
      run(history, 120, (ms) => board(ms, [unit('u1', [ms / 100, 0], ms >= 60_000 ? 'onScene' : 'enRoute')]));
      const live = board(120_000, [unit('u1', [1200, 0], 'onScene')]);

      expect(history.at(30_000, live).units[0].status).toBe('enRoute');
      expect(history.at(90_000, live).units[0].status).toBe('onScene');
    });

    it('counts the call transitions apart from the position samples', () => {
      const history = new BoardHistory();
      run(history, 120, (ms) => board(ms, [unit('u1', [0, 0])], [call('i1', 0, ms >= 60_000 ? 'closed' : 'pending')]));

      // Opened pending, then closed: two events, whatever the tick rate was.
      expect(history.stats().incidentEvents).toBe(2);
    });
  });
});
