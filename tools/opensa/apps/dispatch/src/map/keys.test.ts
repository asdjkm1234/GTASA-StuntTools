import { describe, expect, it } from 'vitest';

import type { PressedCommand } from './keymap';

import { DEFAULT_BINDINGS } from './keymap';
import { bindKeys } from './keys';

/**
 * The input layer's whole job is to be boring, and every case here is one of the ways this kind of code is
 * usually not: a key typed into a field that moves the map, a modifier stolen from the browser, and the
 * classic — a key released while the window is not focused, which never sends `keyup` and leaves the map
 * panning by itself forever.
 */
function windowStub(): {
  blur: () => void;
  down: (key: string, extra?: Partial<KeyboardEvent>) => void;
  target: Parameters<typeof bindKeys>[0];
  up: (key: string, extra?: Partial<KeyboardEvent>) => void;
} {
  const listeners = new Map<string, EventListener[]>();
  const fire = (type: string, event: unknown): void => {
    for (const listener of listeners.get(type) ?? []) {
      listener(event as Event);
    }
  };
  const event = (key: string, extra?: Partial<KeyboardEvent>): unknown => ({
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    preventDefault: () => undefined,
    shiftKey: false,
    target: null,
    ...extra,
  });

  return {
    blur: () => fire('blur', {}),
    down: (key, extra) => fire('keydown', event(key, extra)),
    target: {
      addEventListener: (type: string, listener: EventListener) =>
        listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      removeEventListener: (type: string, listener: EventListener) =>
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((entry) => entry !== listener),
        ),
    } as Parameters<typeof bindKeys>[0],
    up: (key, extra) => fire('keyup', event(key, extra)),
  };
}

describe('bindKeys', () => {
  describe('negative cases', () => {
    it('does not move the map when the key was typed into a field', () => {
      const stub = windowStub();
      const pressed: PressedCommand[] = [];
      const keyboard = bindKeys(stub.target, (command) => pressed.push(command), DEFAULT_BINDINGS);

      stub.down('d', { target: { tagName: 'INPUT' } as unknown as EventTarget });
      stub.down('f', { target: { tagName: 'TEXTAREA' } as unknown as EventTarget });

      expect(keyboard.held('panEast')).toBe(false);
      expect(pressed).toEqual([]);
    });

    it('leaves the browser its own modifiers', () => {
      const stub = windowStub();
      const pressed: PressedCommand[] = [];
      const keyboard = bindKeys(stub.target, (command) => pressed.push(command), DEFAULT_BINDINGS);

      stub.down('d', { ctrlKey: true });
      stub.down('f', { metaKey: true });
      stub.down('1', { altKey: true });

      expect(keyboard.held('panEast')).toBe(false);
      expect(pressed).toEqual([]);
    });

    it('does not keep panning after the window loses focus mid-press', () => {
      const stub = windowStub();
      const keyboard = bindKeys(stub.target, () => undefined, DEFAULT_BINDINGS);
      stub.down('d');

      expect(keyboard.held('panEast')).toBe(true);

      // Alt-tab: the keyup lands in another window and never reaches this one.
      stub.blur();

      expect(keyboard.held('panEast')).toBe(false);
    });

    it('does not leave a pan held when Shift is pressed in the middle of it', () => {
      const stub = windowStub();
      const keyboard = bindKeys(stub.target, () => undefined, DEFAULT_BINDINGS);
      stub.down('ArrowUp');
      // Shift alone means nothing, so the pan continues — but the RELEASE now reads as `Shift+ArrowUp`,
      // which is the tilt command. Matching only that would leave the map panning north by itself.
      stub.down('Shift', { shiftKey: true });
      stub.up('ArrowUp', { shiftKey: true });

      expect(keyboard.held('panNorth')).toBe(false);
      expect(keyboard.held('tiltUp')).toBe(false);
    });

    it('does not leave a tilt held when Shift is let go first', () => {
      const stub = windowStub();
      const keyboard = bindKeys(stub.target, () => undefined, DEFAULT_BINDINGS);
      stub.down('ArrowUp', { shiftKey: true });

      expect(keyboard.held('tiltUp')).toBe(true);

      stub.up('Shift');

      expect(keyboard.held('tiltUp')).toBe(false);
    });

    it('does not leave a command held under a map it is no longer bound in', () => {
      const stub = windowStub();
      const keyboard = bindKeys(stub.target, () => undefined, DEFAULT_BINDINGS);
      stub.down('d');
      keyboard.setBindings({ ...DEFAULT_BINDINGS, panEast: { keys: ['l'], label: 'Pan east' } });

      expect(keyboard.held('panEast')).toBe(false);
    });

    it('stops listening once unbound', () => {
      const stub = windowStub();
      const pressed: PressedCommand[] = [];
      const keyboard = bindKeys(stub.target, (command) => pressed.push(command), DEFAULT_BINDINGS);
      keyboard.unbind();
      stub.down('f');

      expect(pressed).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('holds a movement key down and releases it', () => {
      const stub = windowStub();
      const keyboard = bindKeys(stub.target, () => undefined, DEFAULT_BINDINGS);

      stub.down('ArrowRight');

      expect(keyboard.held('panEast')).toBe(true);

      stub.up('ArrowRight');

      expect(keyboard.held('panEast')).toBe(false);
    });

    it('holds two directions at once, which is what a diagonal is', () => {
      const stub = windowStub();
      const keyboard = bindKeys(stub.target, () => undefined, DEFAULT_BINDINGS);
      stub.down('w');
      stub.down('d');

      expect(keyboard.held('panNorth')).toBe(true);
      expect(keyboard.held('panEast')).toBe(true);
    });

    it('fires a pressed command once per press, not per repeat frame', () => {
      const stub = windowStub();
      const pressed: PressedCommand[] = [];
      bindKeys(stub.target, (command) => pressed.push(command), DEFAULT_BINDINGS);
      stub.down('f');
      stub.down('f');

      expect(pressed).toEqual(['fitBoard', 'fitBoard']);
    });

    it('reads a rebound key as soon as the map is swapped in', () => {
      const stub = windowStub();
      const pressed: PressedCommand[] = [];
      const keyboard = bindKeys(stub.target, (command) => pressed.push(command), DEFAULT_BINDINGS);
      keyboard.setBindings({ ...DEFAULT_BINDINGS, fitBoard: { keys: ['g'], label: 'Fit' } });
      stub.down('g');

      expect(pressed).toEqual(['fitBoard']);
    });
  });
});
