/** The roster: every unit on duty, its status and what it is committed to. */
import type { ReactElement } from 'react';

import type { TallyItem } from './status-tally';

import { SET_COLORS } from '../map/beacons';
import { css } from '../map/overlay-2d';
import { type Incident, type Selection, type Unit } from '../ops/types';
import { COLORS, RAMP, styles } from './styles';

const KIND_LABEL: Readonly<Record<Unit['kind'], string>> = {
  ambulance: 'EMS',
  fire: 'FIRE',
  patrol: 'PD',
};

const STATUS_LABEL: Readonly<Record<Unit['status'], string>> = {
  available: 'AVAILABLE',
  busy: 'OUT OF SERVICE',
  enRoute: 'EN ROUTE',
  onScene: 'ON SCENE',
};

export function UnitsPanel({
  incidents,
  onLocate,
  onSelect,
  selection,
  units,
}: {
  incidents: readonly Incident[];
  onLocate: (unit: Unit) => void;
  onSelect: (selection: Selection) => void;
  selection: Selection;
  units: readonly Unit[];
}): ReactElement {
  return (
    <div style={styles.panel}>
      <div style={styles.scroll}>
        {units.map((unit) => {
          const selected = selection?.kind === 'unit' && selection.id === unit.id;
          const incident = incidents.find((entry) => entry.id === unit.incident);

          return (
            <div
              key={unit.id}
              onClick={() => onSelect({ id: unit.id, kind: 'unit' })}
              onDoubleClick={() => onLocate(unit)}
              // A unit's rail carries its STATUS for the same reason a call's carries its priority: the
              // roster is scanned down the left edge, not read row by row.
              style={{
                ...styles.row,
                borderLeftColor: css(SET_COLORS[unit.status]),
                ...(selected ? styles.rowSelected : {}),
              }}
              title="Click to select · double-click to centre the map on it"
            >
              <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
                {/* The callsign carries the status as its own fill rather than standing next to a dot: it is
                    the one field in the row that never truncates, so at 360 px it is the only place the
                    status is guaranteed to still be readable. The row's left rail says the same thing a
                    second time for anyone who cannot separate the hues. */}
                <span style={{ ...styles.unitPill, background: css(SET_COLORS[unit.status]) }}>{unit.callsign}</span>
                <span
                  style={{ ...styles.badge, background: RAMP.surfaceHover, color: COLORS.muted, marginLeft: 'auto' }}
                >
                  {KIND_LABEL[unit.kind]}
                </span>
              </div>
              <div style={{ color: css(SET_COLORS[unit.status]), fontSize: 10 }}>{STATUS_LABEL[unit.status]}</div>
              {incident && (
                <div style={{ color: COLORS.muted, fontSize: 10 }}>
                  {incident.code} · {incident.place}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The roster's tally, in the order a dispatcher wants it: who can be sent, then who is committed, then who
 * is gone. Not alphabetical and not the enum's order — the first number is the one the shift turns on.
 */
export function unitsTally(units: readonly Unit[]): readonly TallyItem[] {
  const order: readonly Unit['status'][] = ['available', 'enRoute', 'onScene', 'busy'];

  return order.map((status) => ({
    color: css(SET_COLORS[status]),
    count: units.filter((unit) => unit.status === status).length,
    label: STATUS_LABEL[status],
  }));
}
