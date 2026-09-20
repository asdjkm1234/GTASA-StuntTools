/**
 * The measure/draw row of the operator cluster (201/7-05): arm a tool, then tap the map.
 *
 * Three tools and nothing else, because three is what the job has: a distance between two places, a radius
 * around one, and an area around several. The controls for finishing, stepping back and clearing appear only
 * while a tool is armed — an idle console shows three buttons, not six, and the row an operator has to read
 * mid-shift is as short as it can be.
 *
 * Every button is a real target on a finger (`buttonTouch`), the row wraps rather than overflowing at
 * 360 CSS px, and the live measurement is text rather than a colour
 * ([cross-platform-surface](../../../../docs/restrictions/cross-platform-surface.md)).
 */
import type { ReactElement } from 'react';

import type { MapTool, Measurement } from '../map/sketch';
import type { DispatchHandle } from '../world/boot';

import { describeMeasurement } from '../map/sketch';
import { styles } from './styles';

/** What each tool is for, in the words the tooltip uses. Also the label — a verb an operator can scan. */
const TOOLS: readonly { hint: string; label: string; tool: 'area' | 'circle' | 'ruler' }[] = [
  { hint: 'Measure a distance: tap along the route, then Finish', label: 'Ruler', tool: 'ruler' },
  { hint: 'Measure a radius: tap the centre, then the edge', label: 'Circle', tool: 'circle' },
  { hint: 'Draw a cordon or search area: tap its corners, then Finish', label: 'Area', tool: 'area' },
];

export function MeasureTools({
  handle,
  measurement,
  tool,
  touch = false,
}: {
  handle: DispatchHandle | null;
  /** What the shape in progress (or the last one drawn) measures — straight off the readout. */
  measurement: Measurement | null;
  tool: MapTool;
  touch?: boolean;
}): ReactElement {
  const button = touch ? styles.buttonTouch : styles.button;
  const buttonPrimary = touch ? styles.buttonPrimaryTouch : styles.buttonPrimary;
  const armed = tool !== 'none';

  return (
    <div style={styles.measureTools}>
      <div style={styles.measureRow}>
        {TOOLS.map((entry) => (
          <button
            disabled={handle === null}
            key={entry.tool}
            onClick={() => handle?.setTool(tool === entry.tool ? 'none' : entry.tool)}
            style={tool === entry.tool ? buttonPrimary : button}
            title={entry.hint}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>
      {armed && (
        <div style={styles.measureRow}>
          <button onClick={() => handle?.sketchFinish()} style={button} title="Close the shape" type="button">
            Finish
          </button>
          <button onClick={() => handle?.sketchUndo()} style={button} title="Step back one tap" type="button">
            Undo
          </button>
          <button onClick={() => handle?.sketchClear()} style={button} title="Remove every shape" type="button">
            Clear
          </button>
        </div>
      )}
      {measurement !== null && <div style={styles.measureReadout}>{describeMeasurement(measurement)}</div>}
    </div>
  );
}
