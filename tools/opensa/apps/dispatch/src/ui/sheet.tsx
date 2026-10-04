/**
 * The phone sheet: the two side panels, stacked under the map behind a tab strip.
 *
 * A dispatcher on a phone is looking at ONE list at a time — the queue when calls are coming in, the roster
 * when deciding who rolls. Showing both at a third of the height each would make neither readable, so the tab
 * carries the count and the operator picks.
 *
 * **And sometimes neither.** The strip collapses to its own tabs, which keeps both counts on screen — the
 * two numbers a dispatcher actually watches — and gives the rest back to the map. It starts collapsed when
 * the viewport is too short to afford both (a phone in landscape, where the sheet at its cap left the map
 * 98 px).
 */
import { type ReactElement, useState } from 'react';

import type { Incident, Selection, Unit } from '../ops/types';

import { IncidentsPanel } from './incidents-panel';
import { styles, TOUCH_TARGET } from './styles';
import { UnitsPanel } from './units-panel';

type Tab = 'calls' | 'units';

export function Sheet({
  incidents,
  now,
  onLocateIncident,
  onLocateUnit,
  onSelect,
  selection,
  short = false,
  touch = false,
  units,
}: {
  incidents: readonly Incident[];
  now: number;
  onLocateIncident: (incident: Incident) => void;
  onLocateUnit: (unit: Unit) => void;
  onSelect: (selection: Selection) => void;
  selection: Selection;
  /** The viewport is too short to open on a list: start collapsed, with the counts still on screen. */
  short?: boolean;
  /** The pointer is a finger: the tab strip takes a finger-sized target. */
  touch?: boolean;
  units: readonly Unit[];
}): ReactElement {
  const [tab, setTab] = useState<Tab>('calls');
  const [open, setOpen] = useState(!short);
  const tabStyle = touch ? styles.sheetTabTouch : styles.sheetTab;
  /** Tapping the tab you are already on closes the list; tapping the other one switches and opens it. */
  const pick = (next: Tab): void => {
    setOpen(next === tab ? !open : true);
    setTab(next);
  };
  const openCalls = incidents.filter((incident) => incident.status !== 'closed').length;
  const free = units.filter((unit) => unit.status === 'available').length;

  return (
    <div style={styles.sheet}>
      <div style={styles.sheetTabs}>
        <button
          aria-expanded={open && tab === 'calls'}
          onClick={() => pick('calls')}
          style={{ ...tabStyle, ...(tab === 'calls' ? styles.sheetTabActive : {}) }}
          type="button"
        >
          CALLS · {openCalls}
        </button>
        <button
          aria-expanded={open && tab === 'units'}
          onClick={() => pick('units')}
          style={{ ...tabStyle, ...(tab === 'units' ? styles.sheetTabActive : {}) }}
          type="button"
        >
          UNITS · {free}/{units.length}
        </button>
        <button
          aria-label={open ? 'Hide the list' : 'Show the list'}
          onClick={() => setOpen(!open)}
          style={{ ...tabStyle, flex: 'none', minWidth: TOUCH_TARGET }}
          type="button"
        >
          {open ? '▾' : '▴'}
        </button>
      </div>
      {!open ? null : tab === 'calls' ? (
        <IncidentsPanel
          incidents={incidents}
          now={now}
          onLocate={onLocateIncident}
          onSelect={onSelect}
          selection={selection}
        />
      ) : (
        <UnitsPanel
          incidents={incidents}
          onLocate={onLocateUnit}
          onSelect={onSelect}
          selection={selection}
          units={units}
        />
      )}
    </div>
  );
}
