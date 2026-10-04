import { describe, expect, it } from 'vitest';

import type { BootEvent, BootState } from './boot-machine';

import { bootReducer, initialBootState, MAX_RETRIES } from './boot-machine';

const run = (state: BootState, events: BootEvent[]): BootState => events.reduce(bootReducer, state);
const select = (assetLoader: 'fetch' | 'http-dir' | 'local'): BootEvent => ({
  assetLoader,
  game: 'gostown',
  type: 'SELECT',
});

/** A fetch game that has reached `loading` — it can only get there THROUGH the disclaimer now. */
const loadingFetch = (): BootState => run(initialBootState(), [select('fetch'), { type: 'DISCLAIMER_OK' }]);

describe('bootReducer', () => {
  describe('negative cases', () => {
    it('ignores out-of-phase events', () => {
      const menu = initialBootState();
      expect(bootReducer(menu, { type: 'WORLD_READY' }).phase).toBe('menu'); // no warmup yet
      expect(bootReducer(menu, { type: 'RESUME' }).phase).toBe('menu'); // not paused
      expect(bootReducer(menu, { type: 'DISCLAIMER_OK' }).phase).toBe('menu'); // no disclaimer up

      const loading = loadingFetch();
      expect(bootReducer(loading, select('fetch')).phase).toBe('loading'); // can't re-select mid-flow
    });
  });

  describe('positive cases', () => {
    it('fetch happy path: menu → disclaimer → loading → warmup → playing', () => {
      const state = run(initialBootState(), [
        select('fetch'),
        { type: 'DISCLAIMER_OK' },
        { type: 'LOADED' },
        { type: 'WORLD_READY' },
      ]);
      expect(state.phase).toBe('playing');
      expect(state.game).toBe('gostown');
    });

    it('shows the disclaimer on EVERY fetch launch — there is no remembered acceptance', () => {
      // It is a legal notice, not an onboarding step; nothing about a previous visit may skip it.
      expect(run(initialBootState(), [select('fetch')]).phase).toBe('disclaimer');
      expect(run(loadingFetch(), [{ type: 'FAIL' }, { type: 'RETRY' }]).phase).toBe('loading');
    });

    it('local always routes through the folder prompt, then loads', () => {
      const folder = run(initialBootState(), [select('local')]);
      expect(folder.phase).toBe('folder'); // the folder screen carries the disclaimer
      expect(run(folder, [{ type: 'FOLDER_READY' }]).phase).toBe('loading');
    });

    it('http-dir loads straight from its served dir (no folder or disclaimer gate)', () => {
      expect(run(initialBootState(), [select('http-dir')]).phase).toBe('loading');
    });

    it('pauses and resumes from playing', () => {
      let state = run(loadingFetch(), [{ type: 'LOADED' }, { type: 'WORLD_READY' }]);
      state = bootReducer(state, { type: 'PAUSE' });
      expect(state.phase).toBe('paused');
      expect(bootReducer(state, { type: 'RESUME' }).phase).toBe('playing');
    });

    it('retries loading, then returns to the menu after MAX_RETRIES', () => {
      let state = bootReducer(loadingFetch(), { type: 'FAIL' });
      expect(state.phase).toBe('error');

      for (let i = 1; i <= MAX_RETRIES; i += 1) {
        state = bootReducer(state, { type: 'RETRY' });
        expect(state.phase).toBe('loading');
        expect(state.retries).toBe(i);
        state = bootReducer(state, { type: 'FAIL' });
      }
      state = bootReducer(state, { type: 'RETRY' }); // budget spent → back to the menu
      expect(state.phase).toBe('menu');
      expect(state.game).toBeNull();
    });
  });
});
