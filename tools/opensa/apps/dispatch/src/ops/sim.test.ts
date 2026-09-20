import { describe, expect, it } from 'vitest';

import type { Incident, Operations, Unit } from './types';

import { assignUnit, clearUnit, createIncidentAt, stepOperations } from './sim';

/** `1` never spawns a call (the trickle test is `random() > dt / interval`) and never indexes past a table. */
const QUIET = (): number => 1;

const board = (units: Unit[], incidents: Incident[] = []): Operations => ({
  incidents,
  log: [],
  now: 0,
  units,
});

const unit = (id: string, at: [number, number], patch: Partial<Unit> = {}): Unit => ({
  at,
  callsign: id.toUpperCase(),
  elevation: 13,
  heading: 0,
  id,
  incident: null,
  kind: 'patrol',
  model: 'copcarls',
  status: 'available',
  target: null,
  ...patch,
});

const call = (id: string, at: [number, number], patch: Partial<Incident> = {}): Incident => ({
  assigned: [],
  at,
  code: '10-50',
  id,
  opened: 0,
  place: 'Ganton',
  priority: 2,
  remaining: 10,
  status: 'pending',
  title: 'Traffic collision',
  ...patch,
});

const tick = (state: Operations, seconds: number, autoDispatch = false): Operations =>
  stepOperations(state, { autoDispatch, dtSeconds: seconds, now: seconds * 1000, random: QUIET });

describe('sim', () => {
  describe('negative cases', () => {
    it('ignores an assignment naming a unit that is not on the roster', () => {
      const state = board([unit('u1', [0, 0])], [call('i1', [100, 0])]);

      expect(assignUnit(state, 'ghost', 'i1')).toBe(state);
    });

    it('ignores an assignment naming a call that is not on the board', () => {
      const state = board([unit('u1', [0, 0])]);

      expect(assignUnit(state, 'u1', 'ghost')).toBe(state);
    });

    it('refuses to dispatch a unit to a call that is already cleared', () => {
      const state = board([unit('u1', [0, 0])], [call('i1', [100, 0], { status: 'closed' })]);

      expect(assignUnit(state, 'u1', 'i1')).toBe(state);
    });

    it('ignores clearing a unit that is not on a call', () => {
      const state = board([unit('u1', [0, 0])]);

      expect(clearUnit(state, 'u1')).toBe(state);
    });

    it('does not move a unit that is out of service', () => {
      const state = board([unit('u1', [0, 0], { status: 'busy', target: [1000, 0] })]);

      expect(tick(state, 1).units[0].at).toEqual([0, 0]);
    });

    it('does not move a unit that is already on scene', () => {
      const state = board([unit('u1', [50, 0], { incident: 'i1', status: 'onScene' })], [call('i1', [900, 0])]);

      expect(tick(state, 1).units[0].at).toEqual([50, 0]);
    });

    it('does not close a call while nobody is on scene', () => {
      const state = board([unit('u1', [0, 0], { incident: 'i1', status: 'enRoute' })], [call('i1', [5000, 0])]);

      expect(tick(state, 30).incidents[0].status).not.toBe('closed');
    });
  });

  describe('positive cases', () => {
    it('puts a dispatched unit en route and records it on the call', () => {
      const next = assignUnit(board([unit('u1', [0, 0])], [call('i1', [100, 0])]), 'u1', 'i1');

      expect(next.units[0].status).toBe('enRoute');
      expect(next.units[0].incident).toBe('i1');
      expect(next.incidents[0].assigned).toEqual(['u1']);
      expect(next.incidents[0].status).toBe('assigned');
    });

    it('drives a responding unit towards its call at the response speed', () => {
      const state = board([unit('u1', [0, 0], { incident: 'i1', status: 'enRoute' })], [call('i1', [1000, 0])]);

      expect(tick(state, 1).units[0].at[0]).toBeCloseTo(26);
    });

    it('flips a unit to on scene once it arrives', () => {
      const state = board([unit('u1', [990, 0], { incident: 'i1', status: 'enRoute' })], [call('i1', [1000, 0])]);

      expect(tick(state, 1).units[0].status).toBe('onScene');
    });

    it('counts the work down at the scene and clears the call, freeing the unit', () => {
      let state = board(
        [unit('u1', [1000, 0], { incident: 'i1', status: 'onScene' })],
        [call('i1', [1000, 0], { remaining: 4 })],
      );
      state = tick(state, 5);

      expect(state.incidents[0].status).toBe('closed');
      expect(state.units[0].status).toBe('available');
      expect(state.units[0].incident).toBeNull();
      expect(state.log[0]).toContain('cleared');
    });

    it('auto-dispatch sends the NEAREST free unit, not the first one on the roster', () => {
      const state = board([unit('far', [5000, 0]), unit('near', [120, 0])], [call('i1', [100, 0])]);
      const next = tick(state, 0.05, true);

      expect(next.units.find((entry) => entry.id === 'near')?.status).toBe('enRoute');
      expect(next.units.find((entry) => entry.id === 'far')?.status).toBe('available');
    });

    it('takes a cleared unit off its call and puts the call back in the queue', () => {
      const assigned = assignUnit(board([unit('u1', [0, 0])], [call('i1', [100, 0])]), 'u1', 'i1');
      const next = clearUnit(assigned, 'u1');

      expect(next.units[0].status).toBe('available');
      expect(next.incidents[0].assigned).toEqual([]);
      expect(next.incidents[0].status).toBe('pending');
    });

    it('opens a call at an arbitrary map point and names its nearest landmark', () => {
      const next = createIncidentAt(board([]), [2495, -1687], 1000, QUIET);

      expect(next.incidents).toHaveLength(1);
      expect(next.incidents[0].at).toEqual([2495, -1687]);
      expect(next.incidents[0].place).toBe('Grove Street, Ganton');
    });

    it('patrols a free unit rather than leaving it parked', () => {
      const state = board([unit('u1', [0, 0])]);
      const next = tick(state, 1);

      expect(next.units[0].target).not.toBeNull();
      expect(next.units[0].at).not.toEqual([0, 0]);
    });

    it('carries the board clock so panels can age calls without reading the wall clock', () => {
      expect(tick(board([]), 2).now).toBe(2000);
    });
  });
});
