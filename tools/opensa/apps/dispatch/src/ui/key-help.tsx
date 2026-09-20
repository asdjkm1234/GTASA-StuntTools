/**
 * The key sheet (201/7-06), which is two deliverables in one panel: **the default map written down where an
 * operator can read it**, and **the rebinder**, because the operator decides what they repeat.
 *
 * It renders the live bindings rather than a copy of them, so a sheet that disagrees with the keyboard is not
 * a thing that can happen. Rebinding is a press, not a text field: click a row, press the key, done — asking
 * an operator to type `Shift+ArrowUp` is asking them to know how this file spells things.
 */
import { type ReactElement, useState } from 'react';

import type { KeyBindings, MapCommand } from '../map/keymap';

import { COMMAND_ORDER, keyOf, rebind, resetBindings } from '../map/keymap';
import { RAMP, styles } from './styles';

export function KeyHelp({
  bindings,
  onBindings,
  onClose,
}: {
  bindings: KeyBindings;
  /** Handed the new map after a rebind, so the input layer can swap it in live. */
  onBindings: (next: KeyBindings) => void;
  onClose: () => void;
}): ReactElement {
  /** The command waiting for a key, or null when the sheet is just a sheet. */
  const [listening, setListening] = useState<MapCommand | null>(null);

  const capture = (command: MapCommand, event: React.KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setListening(null);

      return;
    }
    onBindings(rebind(command, keyOf(event)));
    setListening(null);
  };

  return (
    <div style={styles.keyHelp}>
      <div style={styles.keyHelpHead}>
        <strong>Keys</strong>
        <span style={{ color: RAMP.textMuted }}>click a row, then press a key</span>
        <button onClick={onClose} style={styles.button} type="button">
          Close
        </button>
      </div>

      <div style={styles.keyHelpRows}>
        {COMMAND_ORDER.map((command) => (
          <button
            key={command}
            onClick={() => setListening(command)}
            onKeyDown={(event) => (listening === command ? capture(command, event) : undefined)}
            style={listening === command ? styles.keyHelpRowListening : styles.keyHelpRow}
            type="button"
          >
            <span>{bindings[command].label}</span>
            <span style={styles.mono}>
              {listening === command ? 'press a key…' : bindings[command].keys.join(' / ') || 'unbound'}
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={() => {
          onBindings(resetBindings());
          setListening(null);
        }}
        style={styles.button}
        type="button"
      >
        Reset to defaults
      </button>
    </div>
  );
}
