/**
 * The console's keyboard (201/7-06): what every command is, what it is bound to by default, and what this
 * operator rebound it to.
 *
 * **One table, and it is the only one.** A key handled inline where it happens to be convenient is a key
 * that exists nowhere an operator can read, cannot be rebound, and silently collides with the next one
 * somebody adds — which is how a dispatch console ends up with three different meanings for `f` depending
 * on which panel has focus. Everything below is data: the input layer resolves an event against it, the help
 * sheet renders it, and the rebinder writes to it.
 *
 * **A key is a WORD, not a scancode.** `KeyboardEvent.key` is what the operator's layout says the key
 * produces, so a bound `q` is the key marked Q on their keyboard rather than the physical position of Q on
 * a US one. That is the right trade for a surface whose keys are mnemonics (`f` fit, `c` follow, `n` north)
 * and it is why the sheet can print what it prints.
 */
import type { JsonStorage } from './storage';

import { browserStorage, readJson, STORAGE_KEYS, writeJson } from './storage';

/**
 * Everything the map can be told to do from the keyboard. Split by how it is DRIVEN, because the two halves
 * reach the camera differently: a held command runs every frame while the key is down, a pressed one fires
 * once per press.
 */
export type HeldCommand = (typeof HELD_COMMANDS)[number];

export type MapCommand = HeldCommand | PressedCommand;

export type PressedCommand = (typeof PRESSED_COMMANDS)[number];

/** Movement: the keys an operator holds. Repeating these on the OS's key-repeat would move in jerks. */
const HELD_COMMANDS = [
  'panNorth',
  'panSouth',
  'panWest',
  'panEast',
  'rotateLeft',
  'rotateRight',
  'tiltUp',
  'tiltDown',
  'zoomIn',
  'zoomOut',
] as const;

/** Everything else: one action per press. */
const PRESSED_COMMANDS = [
  'levelCity',
  'levelDistrict',
  'levelBlock',
  'north',
  'fitBoard',
  'followSelected',
  'nextCall',
  'previousCall',
  'stopFollowing',
  'toggleHelp',
  'toggleMode',
] as const;

export type KeyBindings = Readonly<Record<MapCommand, KeyBinding>>;

interface KeyBinding {
  /** `KeyboardEvent.key` values, in the order the sheet lists them. Lower-cased for letters. */
  readonly keys: readonly string[];
  /** What it does, in the words the help sheet prints. */
  readonly label: string;
}

/**
 * The default map, and the reasoning is deliberately boring: movement sits under the hand that is not on
 * the mouse (WASD and the arrows for the ground, Q/E to turn, shifted arrows to tilt), everything else is
 * the first letter of what it does. Nothing here uses a modifier an operating system claims, and nothing
 * needs two hands.
 */
export const DEFAULT_BINDINGS: KeyBindings = {
  fitBoard: { keys: ['f'], label: 'Fit every unit and open call' },
  followSelected: { keys: ['c'], label: 'Follow the selected unit' },
  levelBlock: { keys: ['3'], label: 'Zoom to a block' },
  levelCity: { keys: ['1'], label: 'Zoom to the city' },
  levelDistrict: { keys: ['2'], label: 'Zoom to the district' },
  nextCall: { keys: [']'], label: 'Go to the next open call' },
  north: { keys: ['n'], label: 'Face north' },
  panEast: { keys: ['d', 'ArrowRight'], label: 'Pan east' },
  panNorth: { keys: ['w', 'ArrowUp'], label: 'Pan north' },
  panSouth: { keys: ['s', 'ArrowDown'], label: 'Pan south' },
  panWest: { keys: ['a', 'ArrowLeft'], label: 'Pan west' },
  previousCall: { keys: ['['], label: 'Go to the previous open call' },
  rotateLeft: { keys: ['q'], label: 'Turn left' },
  rotateRight: { keys: ['e'], label: 'Turn right' },
  stopFollowing: { keys: ['Escape'], label: 'Stop following' },
  tiltDown: { keys: ['Shift+ArrowDown'], label: 'Tilt towards the ground' },
  tiltUp: { keys: ['Shift+ArrowUp'], label: 'Tilt towards the horizon' },
  toggleHelp: { keys: ['?'], label: 'Show or hide this sheet' },
  toggleMode: { keys: ['m'], label: 'Switch between the 3D map and the flat map' },
  zoomIn: { keys: ['+', '='], label: 'Zoom in' },
  zoomOut: { keys: ['-'], label: 'Zoom out' },
};

/** Commands in the order the help sheet lists them: movement first, then the jumps, then the rest. */
export const COMMAND_ORDER: readonly MapCommand[] = [...HELD_COMMANDS, ...PRESSED_COMMANDS];

/** The command this key event means, or `null` when it means nothing here. */
export function commandFor(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey'>,
  bindings: KeyBindings = loadBindings(),
): MapCommand | null {
  const pressed = keyOf(event);
  for (const command of COMMAND_ORDER) {
    if (bindings[command].keys.includes(pressed)) {
      return command;
    }
  }

  return null;
}

/** Whether a command runs every frame while its key is down. */
export function isHeld(command: MapCommand): command is HeldCommand {
  return (HELD_COMMANDS as readonly string[]).includes(command);
}

/**
 * How a key event is written in the table: `Shift+ArrowUp`, `f`, `?`. Only Shift is spelled out — Alt, Ctrl
 * and Meta belong to the browser and the operating system, and a console that binds them takes a shortcut
 * out of somebody's hands.
 */
export function keyOf(event: Pick<KeyboardEvent, 'key' | 'shiftKey'>): string {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  // A shifted letter already reads as its own character (`?` is Shift+/), so the prefix is only meaningful
  // for the named keys — otherwise `Shift+?` and `?` would be two different bindings for one keystroke.
  return event.shiftKey && event.key.length > 1 ? `Shift+${key}` : key;
}

/** This operator's map: the defaults with their overrides applied. Never throws, never partial. */
export function loadBindings(storage: JsonStorage = browserStorage()): KeyBindings {
  return applyOverrides(readJson(STORAGE_KEYS.keymap, storage));
}

/**
 * Bind `command` to `key`, and answer the new map.
 *
 * **A key can only mean one thing**, so binding one that is already taken takes it away from the other
 * command rather than leaving two rows claiming it — a collision that resolves by table order is a key that
 * works until somebody reorders an array. A command left with no keys is legal and means exactly what it
 * says: the operator does not want it on the keyboard.
 */
export function rebind(command: MapCommand, key: string, storage: JsonStorage = browserStorage()): KeyBindings {
  const current = loadBindings(storage);
  const next: Record<MapCommand, KeyBinding> = { ...current };
  for (const other of COMMAND_ORDER) {
    if (other !== command && next[other].keys.includes(key)) {
      next[other] = { ...next[other], keys: next[other].keys.filter((bound) => bound !== key) };
    }
  }
  next[command] = { ...next[command], keys: [key] };
  writeJson(STORAGE_KEYS.keymap, overridesOf(next), storage);

  return next;
}

/** Throw this operator's changes away and go back to the table above. */
export function resetBindings(storage: JsonStorage = browserStorage()): KeyBindings {
  writeJson(STORAGE_KEYS.keymap, {}, storage);

  return DEFAULT_BINDINGS;
}

/** Shape-checked: this is data an older version wrote, and a row of nonsense must cost the DEFAULT for that
 *  one command rather than the whole keyboard. */
function applyOverrides(stored: unknown): KeyBindings {
  if (stored === null || typeof stored !== 'object') {
    return DEFAULT_BINDINGS;
  }
  const rows = stored as Record<string, unknown>;
  const bindings: Record<MapCommand, KeyBinding> = { ...DEFAULT_BINDINGS };
  for (const command of COMMAND_ORDER) {
    const keys = rows[command];
    if (Array.isArray(keys) && keys.every((key) => typeof key === 'string')) {
      bindings[command] = { ...DEFAULT_BINDINGS[command], keys };
    }
  }

  return bindings;
}

/** Only what DIFFERS from the defaults is stored, so a later change to the base map reaches every operator
 *  who never touched that command — the alternative is a console frozen on the day somebody pressed one key. */
function overridesOf(bindings: KeyBindings): Record<string, readonly string[]> {
  const overrides: Record<string, readonly string[]> = {};
  for (const command of COMMAND_ORDER) {
    const mine = bindings[command].keys;
    const base = DEFAULT_BINDINGS[command].keys;
    if (mine.length !== base.length || mine.some((key, index) => key !== base[index])) {
      overrides[command] = mine;
    }
  }

  return overrides;
}
