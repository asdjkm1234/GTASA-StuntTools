import { describe, expect, it } from 'vitest';

import type { JsonStorage } from './storage';

import {
  COMMAND_ORDER,
  commandFor,
  DEFAULT_BINDINGS,
  isHeld,
  keyOf,
  loadBindings,
  rebind,
  resetBindings,
} from './keymap';

/**
 * The keyboard is the half of this console an operator uses without looking, so its failures are the quiet
 * kind: a key that means two things, a rebind that survives nothing, a stored map from an older version that
 * takes the whole keyboard down. Each of those has a case here.
 */
function memory(seed?: unknown): JsonStorage {
  const cells = new Map<string, string>();
  if (seed !== undefined) {
    cells.set('opensa.dispatch.keymap', JSON.stringify(seed));
  }

  return {
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => void cells.set(key, value),
  };
}

describe('keymap', () => {
  describe('negative cases', () => {
    it('answers nothing for a key nobody bound', () => {
      expect(commandFor({ key: 'x', shiftKey: false }, DEFAULT_BINDINGS)).toBeNull();
    });

    it('does not let one key mean two things after a rebind', () => {
      const store = memory();
      // `f` is fit; give it to "face north" and fit must lose it rather than both claiming the key.
      const bindings = rebind('north', 'f', store);

      expect(bindings.north.keys).toEqual(['f']);
      expect(bindings.fitBoard.keys).not.toContain('f');
      expect(commandFor({ key: 'f', shiftKey: false }, bindings)).toBe('north');
    });

    it('falls back to the defaults for a stored map that is not an object', () => {
      expect(loadBindings(memory('nonsense'))).toEqual(DEFAULT_BINDINGS);
    });

    it('keeps the default for one nonsense row instead of losing the whole keyboard', () => {
      const bindings = loadBindings(memory({ north: 42, panEast: ['j'] }));

      expect(bindings.north.keys).toEqual(DEFAULT_BINDINGS.north.keys);
      expect(bindings.panEast.keys).toEqual(['j']);
    });

    it('does not confuse a shifted named key with the unshifted one', () => {
      expect(commandFor({ key: 'ArrowUp', shiftKey: false }, DEFAULT_BINDINGS)).toBe('panNorth');
      expect(commandFor({ key: 'ArrowUp', shiftKey: true }, DEFAULT_BINDINGS)).toBe('tiltUp');
    });
  });

  describe('positive cases', () => {
    it('gives every command a label and at least one key by default', () => {
      for (const command of COMMAND_ORDER) {
        expect(DEFAULT_BINDINGS[command].label).not.toBe('');
        expect(DEFAULT_BINDINGS[command].keys.length).toBeGreaterThan(0);
      }
    });

    it('binds no key to two commands in the default map', () => {
      const seen = new Map<string, string>();
      for (const command of COMMAND_ORDER) {
        for (const key of DEFAULT_BINDINGS[command].keys) {
          expect(seen.get(key)).toBeUndefined();
          seen.set(key, command);
        }
      }
    });

    it('reads a letter case-insensitively, so caps lock is not a broken keyboard', () => {
      expect(keyOf({ key: 'F', shiftKey: false })).toBe('f');
      expect(commandFor({ key: 'F', shiftKey: false }, DEFAULT_BINDINGS)).toBe('fitBoard');
    });

    it('writes a shifted named key the way the table spells it', () => {
      expect(keyOf({ key: 'ArrowUp', shiftKey: true })).toBe('Shift+ArrowUp');
      // A shifted character already IS its own character — `?` must not become `Shift+?`.
      expect(keyOf({ key: '?', shiftKey: true })).toBe('?');
    });

    it('stores only what differs, so a later change to the base map still reaches this operator', () => {
      const store = memory();
      rebind('north', 'k', store);
      const raw = JSON.parse(String(store?.getItem('opensa.dispatch.keymap'))) as Record<string, unknown>;

      expect(Object.keys(raw)).toEqual(['north']);
    });

    it('survives a reload: what was rebound is what comes back', () => {
      const store = memory();
      rebind('panEast', 'l', store);

      expect(loadBindings(store).panEast.keys).toEqual(['l']);
      expect(loadBindings(store).panWest.keys).toEqual(DEFAULT_BINDINGS.panWest.keys);
    });

    it('resets everything an operator changed', () => {
      const store = memory();
      rebind('panEast', 'l', store);

      expect(resetBindings(store)).toEqual(DEFAULT_BINDINGS);
      expect(loadBindings(store)).toEqual(DEFAULT_BINDINGS);
    });

    it('knows which commands run while a key is held', () => {
      expect(isHeld('panEast')).toBe(true);
      expect(isHeld('rotateLeft')).toBe(true);
      expect(isHeld('fitBoard')).toBe(false);
    });
  });
});
