/** The call queue: open calls first, worst priority at the top — the order a dispatcher works them in. */
import type { ReactElement } from 'react';

import type { TallyItem } from './status-tally';

import { SET_COLORS } from '../map/beacons';
import { css } from '../map/overlay-2d';
import { type Incident, type Selection } from '../ops/types';
import { COLORS, styles } from './styles';

const STATUS_LABEL: Readonly<Record<Incident['status'], string>> = {
  assigned: 'ASSIGNED',
  closed: 'CLEARED',
  onScene: 'ON SCENE',
  pending: 'PENDING',
};

/** The queue's tally: open calls by priority, worst first. A closed call is not a number anyone is working. */
export function callsTally(incidents: readonly Incident[]): readonly TallyItem[] {
  return ([1, 2, 3] as const).map((priority) => ({
    color: css(SET_COLORS[`call${priority}`]),
    count: incidents.filter((call) => call.status !== 'closed' && call.priority === priority).length,
    label: `P${priority}`,
  }));
}

export function IncidentsPanel({
  incidents,
  now,
  onLocate,
  onSelect,
  selection,
}: {
  incidents: readonly Incident[];
  now: number;
  onLocate: (incident: Incident) => void;
  onSelect: (selection: Selection) => void;
  selection: Selection;
}): ReactElement {
  const sorted = [...incidents].sort(byUrgency);

  return (
    <div style={styles.panel}>
      <div style={styles.scroll}>
        {sorted.length === 0 && <div style={styles.empty}>No active calls</div>}
        {sorted.map((incident) => {
          const selected = selection?.kind === 'incident' && selection.id === incident.id;
          // One table for the map and the list, so a chip in the queue cannot drift from the pillar on the
          // map — they are the same number, not two colours somebody matched by eye.
          const key = `call${incident.priority}` as const;
          const priority = css(SET_COLORS[key]);

          return (
            <div
              key={incident.id}
              onClick={() => onSelect({ id: incident.id, kind: 'incident' })}
              onDoubleClick={() => onLocate(incident)}
              style={{
                ...styles.row,
                // The rail. Priority reaches the eye as POSITION here, as text in the chip, and as colour in
                // both — so a dispatcher scanning the queue, or one who cannot separate red from amber, still
                // reads it (DESIGN.md, "Priority is encoded three ways").
                borderLeftColor: incident.status === 'closed' ? 'transparent' : priority,
                ...(selected ? styles.rowSelected : {}),
              }}
              title="Click to select · double-click to centre the map on it"
            >
              <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
                <span style={{ ...styles.badge, background: priority, color: 'var(--os-on-status)' }}>
                  P{incident.priority}
                </span>
                <strong style={styles.mono}>{incident.code}</strong>
                <span style={{ ...styles.rowMeta, marginLeft: 'auto' }}>{age(now - incident.opened)}</span>
              </div>
              <div>{incident.title}</div>
              <div style={{ color: COLORS.muted, display: 'flex', gap: 8 }}>
                <span>{incident.place}</span>
                <span style={{ ...styles.statusTag, marginLeft: 'auto' }}>{STATUS_LABEL[incident.status]}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function age(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}`;
}

/** Open before closed, then by priority, then oldest first. */
function byUrgency(a: Incident, b: Incident): number {
  const closed = Number(a.status === 'closed') - Number(b.status === 'closed');

  return closed !== 0 ? closed : a.priority - b.priority || a.opened - b.opened;
}
