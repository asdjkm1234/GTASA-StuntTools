/**
 * The selection panel — what is under the cursor and what can be done about it.
 *
 * The `world` case is the one a mod author will actually live in: clicking any building on the map resolves it
 * through `CellStore.pick` to the MODEL and TXD names the pak was built from, plus the GTA coordinates to
 * paste into an IPL row or a teleport. That readout is a side effect of having a real engine under the map,
 * and no tile-based map stack can produce it.
 */
import type { ReactElement } from 'react';

import type { GtaGround } from '../map/coords';
import type { Incident, Operations, Selection, Unit } from '../ops/types';
import type { DispatchActions } from '../ops/use-operations';

import { gtaDistance } from '../map/coords';
import { COLORS, styles } from './styles';

export function DetailPanel({
  actions,
  compact = false,
  onLocate,
  ops,
  selection,
}: {
  actions: DispatchActions;
  /** Phone layout: the card spans the map's width along the bottom instead of floating in a corner. */
  compact?: boolean;
  onLocate: (at: GtaGround) => void;
  ops: Operations;
  selection: Selection;
}): null | ReactElement {
  if (selection === null) {
    return null;
  }
  const card = compact ? styles.detailCompact : styles.detail;
  if (selection.kind === 'world') {
    return (
      <div style={card}>
        <Title text="Map object" />
        <Field label="model" value={selection.model} />
        <Field label="txd" value={selection.txd} />
        {selection.district !== null && <Field label="district" value={selection.district} />}
        <Field label="coords" value={coords(selection.at)} />
        <Row>
          <button onClick={() => void navigator.clipboard?.writeText(coords(selection.at))} style={styles.button}>
            Copy coords
          </button>
          <button onClick={() => actions.createAt(selection.at)} style={styles.buttonPrimary}>
            New call here
          </button>
          <button onClick={() => actions.select(null)} style={styles.button}>
            Close
          </button>
        </Row>
      </div>
    );
  }

  const unit = ops.units.find((entry) => entry.id === selection.id);
  const incident = ops.incidents.find((entry) => entry.id === selection.id);

  return (
    <div style={card}>
      {unit && <UnitDetail actions={actions} incidents={ops.incidents} onLocate={onLocate} unit={unit} />}
      {incident && <IncidentDetail actions={actions} incident={incident} onLocate={onLocate} ops={ops} />}
      {!unit && !incident && <Title text="Gone from the board" />}
    </div>
  );
}

function coords(at: GtaGround): string {
  return `${at[0].toFixed(1)}, ${at[1].toFixed(1)}`;
}

function Field({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
      <span style={{ color: COLORS.muted, minWidth: 58 }}>{label}</span>
      <span style={styles.mono}>{value}</span>
    </div>
  );
}

function IncidentDetail({
  actions,
  incident,
  onLocate,
  ops,
}: {
  actions: DispatchActions;
  incident: Incident;
  onLocate: (at: GtaGround) => void;
  ops: Operations;
}): ReactElement {
  const nearest = nearestAvailable(ops.units, incident.at);
  const assigned = ops.units.filter((unit) => incident.assigned.includes(unit.id));

  return (
    <>
      <Title text={`${incident.code} · ${incident.title}`} />
      <Field label="place" value={incident.place} />
      <Field label="coords" value={coords(incident.at)} />
      <Field label="priority" value={`P${incident.priority} · ${incident.status}`} />
      <Field label="assigned" value={assigned.map((unit) => unit.callsign).join(', ') || '—'} />
      <Row>
        {nearest && incident.status !== 'closed' && (
          <button onClick={() => actions.assign(nearest.id, incident.id)} style={styles.buttonPrimary}>
            Dispatch {nearest.callsign} ({Math.round(gtaDistance(nearest.at, incident.at))} m)
          </button>
        )}
        <button onClick={() => onLocate(incident.at)} style={styles.button}>
          Centre map
        </button>
        <button onClick={() => actions.select(null)} style={styles.button}>
          Close
        </button>
      </Row>
    </>
  );
}

function nearestAvailable(units: readonly Unit[], at: GtaGround): undefined | Unit {
  return units
    .filter((unit) => unit.status === 'available')
    .sort((a, b) => gtaDistance(a.at, at) - gtaDistance(b.at, at))[0];
}

function Row({ children }: { children: React.ReactNode }): ReactElement {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 8 }}>{children}</div>;
}

function Title({ text }: { text: string }): ReactElement {
  return <div style={{ fontSize: 13, fontWeight: 700, paddingBottom: 6 }}>{text}</div>;
}

function UnitDetail({
  actions,
  incidents,
  onLocate,
  unit,
}: {
  actions: DispatchActions;
  incidents: readonly Incident[];
  onLocate: (at: GtaGround) => void;
  unit: Unit;
}): ReactElement {
  const open = incidents.filter((incident) => incident.status !== 'closed');
  const current = incidents.find((incident) => incident.id === unit.incident);

  return (
    <>
      <Title text={unit.callsign} />
      <Field label="status" value={unit.status} />
      <Field label="coords" value={coords(unit.at)} />
      <Field label="call" value={current ? `${current.code} · ${current.place}` : '—'} />
      <Row>
        <select
          onChange={(event) => event.target.value && actions.assign(unit.id, event.target.value)}
          style={{ ...styles.button, cursor: 'pointer' }}
          value=""
        >
          <option value="">Dispatch to…</option>
          {open.map((incident) => (
            <option key={incident.id} value={incident.id}>
              {incident.code} · {incident.place}
            </option>
          ))}
        </select>
        {unit.incident !== null && (
          <button onClick={() => actions.clear(unit.id)} style={styles.button}>
            Clear
          </button>
        )}
        <button onClick={() => onLocate(unit.at)} style={styles.button}>
          Centre map
        </button>
        <button onClick={() => actions.select(null)} style={styles.button}>
          Close
        </button>
      </Row>
    </>
  );
}
