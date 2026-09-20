/**
 * The keyboard as an input SOURCE (201/7-06): events in, commands out, and a set of what is currently held.
 *
 * Two kinds of command and they cannot share a path. A press ("fit the board") fires once. A hold ("pan
 * east") has to run in the frame loop, because the alternative — acting on the operating system's key repeat
 * — moves the map in the OS's own stutter: a long first gap, then a burst, at a rate the operator set for
 * typing. Holding a key is a continuous input and the loop is where continuous inputs belong.
 *
 * What is deliberately handled here rather than left to whoever calls it:
 *
 * - **a key pressed into a field is text.** The console has a time slider, checkboxes, a search box and a
 *   name box; a `w` typed into any of them must not pan the map.
 * - **a modifier the browser owns is not ours.** Ctrl, Alt and Meta pass straight through, so the operator
 *   keeps their tab, their address bar and their window manager.
 * - **a key released while the window is not focused never sends `keyup`.** Alt-tab away mid-pan and the
 *   map would pan forever; the blur clears the held set, which is the one bug this class of code always
 *   ships with.
 */
import type { HeldCommand, KeyBindings, PressedCommand } from './keymap';

import { commandFor, isHeld, keyOf, loadBindings } from './keymap';

export interface KeyboardInput {
  /** Whether this movement command is being held right now — read by the frame loop. */
  held(command: HeldCommand): boolean;
  /** Swap in a rebound map without re-binding the listeners (the help sheet rebinds live). */
  setBindings(bindings: KeyBindings): void;
  unbind(): void;
}

/** Attach to a window. `onPressed` fires once per press; movement is read through {@link KeyboardInput.held}. */
export function bindKeys(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  onPressed: (command: PressedCommand) => void,
  initial: KeyBindings = loadBindings(),
): KeyboardInput {
  let bindings = initial;
  const down = new Set<HeldCommand>();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey || isTyping(event.target)) {
      return;
    }
    const command = commandFor(event, bindings);
    if (command === null) {
      return;
    }
    event.preventDefault();
    if (isHeld(command)) {
      down.add(command);
    } else {
      onPressed(command);
    }
  };

  /**
   * A release clears EVERY command that key could have started, shifted or not — and Shift's own release
   * clears everything bound with it.
   *
   * The reason is a sequence an operator produces without noticing: hold ArrowUp (panning north), then press
   * Shift. The press of Shift means nothing on its own, so panning continues — correctly. But the RELEASE of
   * ArrowUp now reads as `Shift+ArrowUp`, which is a different command, and matching only that one would
   * leave `panNorth` held with no key down and the map panning by itself until something else clears it.
   * The same happens in reverse when Shift is let go first.
   */
  const onKeyUp = (event: KeyboardEvent): void => {
    const released = [keyOf(event), keyOf({ key: event.key, shiftKey: false })];
    for (const command of [...down]) {
      const keys = bindings[command].keys;
      const shiftGone = event.key === 'Shift' && keys.some((key) => key.startsWith('Shift+'));
      if (shiftGone || keys.some((key) => released.includes(key))) {
        down.delete(command);
      }
    }
  };

  const onBlur = (): void => down.clear();

  target.addEventListener('keydown', onKeyDown as EventListener);
  target.addEventListener('keyup', onKeyUp as EventListener);
  target.addEventListener('blur', onBlur);

  return {
    held: (command) => down.has(command),
    setBindings(next) {
      bindings = next;
      // Anything held under the OLD map is released: its key may now mean something else, and a command
      // nobody can release is worse than one keystroke lost.
      down.clear();
    },
    unbind() {
      down.clear();
      target.removeEventListener('keydown', onKeyDown as EventListener);
      target.removeEventListener('keyup', onKeyUp as EventListener);
      target.removeEventListener('blur', onBlur);
    },
  };
}

/** A key pressed into a field is text, not a command. */
function isTyping(target: EventTarget | null): boolean {
  const element = target as null | { isContentEditable?: boolean; tagName?: string };

  return (
    element?.isContentEditable === true ||
    element?.tagName === 'INPUT' ||
    element?.tagName === 'SELECT' ||
    element?.tagName === 'TEXTAREA'
  );
}
