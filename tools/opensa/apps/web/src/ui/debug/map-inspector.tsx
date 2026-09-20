import type { CellCoord, GameEvents, WorldObjectInfo } from '@opensa/game';
import type { EventBus } from '@opensa/game/events/event-bus';
import type { ModelSearchHit } from '@opensa/renderware';

import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';

import { CELL_PX, styles } from './debug-styles';
import { ModelSearch } from './model-search';

/**
 * The map inspector's view of the host (074/22). The three-owned `Game` class this used to take died with
 * the old renderer (plan 13 phase 5), so the surface is declared here and implemented by whichever host
 * can honour it — the engine host builds it in its boot closure. Selection members are OPTIONAL because
 * picking needs the per-placement mapper in `.oscell`; a host without one simply omits them and the
 * SELECTED block renders its own explanation instead of a dead panel.
 */
export interface MapGame {
  /** The pak's cell grid pitch (world units). */
  cellSize: () => number;
  readonly events: Pick<EventBus<GameEvents>, 'on'>;
  /**
   * Centre the camera on the next placement of `name` and answer the cell it sits in, so the inspector can
   * make that cell resident. Repeated calls for one name cycle its placements (nearest first). `null` when
   * the map places nothing under that name. Paired with {@link MapGame.searchModels} — a host implements
   * both or neither, and the FIND MODEL block only renders when it does.
   */
  focusModel?: (name: string) => CellCoord | null;
  /** Hide the picked object; returns how many are hidden now. */
  hideSelectedObject?: () => number;
  /** Every cell the map offers, resident or not. */
  listCells: () => CellCoord[];
  /** Un-hide everything; returns the remaining hidden count (0). */
  restoreHiddenObjects?: () => number;
  /** Autocomplete over the PLACED model names (see `ModelIndex`); an empty query answers nothing. */
  searchModels?: (query: string) => ModelSearchHit[];
  /** Pin an explicit cell set at one level, or `null` to resume normal streaming. */
  setManualCells: (cells: CellCoord[] | null, lod?: boolean) => void;
  /** Enter/leave map-viewer mode (detached camera + pinned cells). */
  setMapViewer: (enabled: boolean) => void;
  /** Draw the scattered procobj clutter or not — what is GENERATED, subtracted from what the IPLs place. */
  setShowClutter?: (enabled: boolean) => void;
  setShowCollision?: (enabled: boolean) => void;
  /** Draw the water surface or not — an inspector has to be able to look UNDER the sea sheet. */
  setShowWater?: (enabled: boolean) => void;
  /** The cell the player currently stands in. */
  viewCell: () => CellCoord | null;
}

/** Rough GTA SA region of a cell (by its world-centre coords), used to group the sections. */
const REGIONS = ['Los Santos', 'San Fierro', 'Las Venturas', 'Countryside'] as const;
type Region = (typeof REGIONS)[number];

const REGION_COLOR: Record<Region, string> = {
  Countryside: '#8899aa',
  'Las Venturas': '#ff66cc',
  'Los Santos': '#ffcc00',
  'San Fierro': '#00ff88',
};

/**
 * The map-viewer inspector. Mounting it turns the host's **map-viewer** mode on
 * (detached camera + manual cell render + click-to-pick where supported) and seeds
 * the selection with the current section; unmounting turns it back off and resumes
 * streaming — so leaving the Map screen / closing the panel exits cleanly. Pick the
 * sections to render (HD, or LOD with "Show LODs"); clicking a model reports its info.
 */
export function MapInspector({ game }: { game: MapGame }): ReactElement {
  const [showCollision, setShowCollision] = useState(false);
  const [selection, setSelection] = useState<null | WorldObjectInfo>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [center, setCenter] = useState<CellCoord | null>(null);
  const [allCells, setAllCells] = useState<CellCoord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [showLods, setShowLods] = useState(false);
  const [showWater, setShowWater] = useState(true);
  const [showClutter, setShowClutter] = useState(true);

  const cellSize = game.cellSize();

  // Enter map-viewer on mount (seed the current section + all cells, suspend streaming);
  // leave on unmount (resume streaming, clear the manual selection).
  useEffect(() => {
    game.setMapViewer(true);
    const view = game.viewCell();
    /* eslint-disable @eslint-react/set-state-in-effect */
    setCenter(view);
    setAllCells(game.listCells());
    setSelected(new Set(view ? [cellKey(view)] : []));
    /* eslint-enable @eslint-react/set-state-in-effect */

    return (): void => {
      game.setMapViewer(false);
      game.setManualCells(null);
    };
  }, [game]);

  useEffect(() => game.events.on('select', setSelection), [game]);

  useEffect(() => {
    const cells = [...selected].map((key): CellCoord => {
      const [cx, cy] = key.split(',');

      return [Number(cx), Number(cy)];
    });
    game.setManualCells(cells, showLods);
  }, [game, selected, showLods]);

  // Wrapped rather than passed through: the members are optional AND methods, so an unbound reference would
  // lose its host. Memoised on the game so a 4 Hz readout re-render does not re-run the name scan.
  const searchModels = useCallback((query: string) => game.searchModels?.(query) ?? [], [game]);
  /** Centre on the model, then make its cell resident — a jump that shows nothing is not a jump. */
  const focusModel = useCallback(
    (name: string): null | string => {
      const cell = game.focusModel?.(name) ?? null;
      if (!cell) {
        return 'not placed on this map';
      }
      setSelected((previous) => new Set(previous).add(cellKey(cell)));

      return `centred · cell ${cell[0]}, ${cell[1]}`;
    },
    [game],
  );

  function toggleCell(coord: CellCoord): void {
    const key = cellKey(coord);
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) {
        next.add(key);
      }

      return next;
    });
  }

  const allSelected = allCells.length > 0 && selected.size === allCells.length;
  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(allCells.map(cellKey)));
  }

  const layout = useMemo(() => {
    if (allCells.length === 0) {
      return null;
    }
    const xs = allCells.map((c) => c[0]);
    const ys = allCells.map((c) => c[1]);

    return {
      cols: range(Math.min(...xs), Math.max(...xs)),
      has: new Set(allCells.map(cellKey)),
      region: new Map(allCells.map((c) => [cellKey(c), regionOf(c, cellSize)])),
      rows: range(Math.max(...ys), Math.min(...ys)), // top = north
    };
  }, [allCells, cellSize]);

  return (
    <>
      {game.searchModels && game.focusModel ? (
        <>
          <ModelSearch onFocus={focusModel} search={searchModels} />
          <div style={styles.divider} />
        </>
      ) : null}

      <div style={styles.group}>
        <div style={styles.groupLabel}>SECTIONS {center ? `(${center[0]}, ${center[1]})` : ''}</div>
        <Checkbox checked={allSelected} label="Whole map" onToggle={toggleAll} />
        {layout ? (
          <div style={styles.sectionsBox}>
            <div style={{ ...styles.grid, gridTemplateColumns: `repeat(${layout.cols.length}, ${CELL_PX}px)` }}>
              {layout.rows.flatMap((cy) =>
                layout.cols.map((cx) => {
                  const key = cellKey([cx, cy]);
                  if (!layout.has.has(key)) {
                    return <div key={key} style={styles.cellEmpty} />;
                  }
                  const region = layout.region.get(key) ?? 'Countryside';
                  const isCenter = center?.[0] === cx && center[1] === cy;

                  return (
                    <input
                      checked={selected.has(key)}
                      key={key}
                      onChange={() => toggleCell([cx, cy])}
                      style={{
                        ...styles.cell,
                        accentColor: REGION_COLOR[region],
                        ...(isCenter ? styles.cellCenter : {}),
                      }}
                      title={`${cx}, ${cy} · ${region}`}
                      type="checkbox"
                    />
                  );
                }),
              )}
            </div>
          </div>
        ) : null}
        <div style={styles.legend}>
          {REGIONS.map((r) => (
            <span key={r} style={styles.legendItem} title={r}>
              <span style={{ ...styles.swatch, background: REGION_COLOR[r] }} />
              {r
                .split(' ')
                .map((w) => w[0])
                .join('')}
            </span>
          ))}
        </div>
        <Checkbox checked={showLods} label="Show LODs" onToggle={() => setShowLods((previous) => !previous)} />
        {game.setShowWater ? (
          <Checkbox
            checked={showWater}
            label="Show water"
            onToggle={() => {
              const next = !showWater;
              setShowWater(next);
              game.setShowWater?.(next);
            }}
          />
        ) : null}
        {game.setShowClutter ? (
          <Checkbox
            checked={showClutter}
            label="Show procobj"
            onToggle={() => {
              const next = !showClutter;
              setShowClutter(next);
              game.setShowClutter?.(next);
            }}
          />
        ) : null}
      </div>

      {game.setShowCollision ? (
        <>
          <div style={styles.divider} />
          <div style={styles.group}>
            <div style={styles.groupLabel}>COLLISION</div>
            <Checkbox
              checked={showCollision}
              label="Show collision"
              onToggle={() => {
                const next = !showCollision;
                setShowCollision(next);
                game.setShowCollision?.(next);
              }}
            />
          </div>
        </>
      ) : null}

      <div style={styles.divider} />

      <div style={styles.group}>
        <div style={styles.groupLabel}>SELECTED</div>
        {selection ? (
          <>
            <div style={styles.info}>name: {selection.modelName}</div>
            <div style={styles.info}>txd: {selection.txdName}</div>
            <div style={styles.info}>pos: {selection.position.map((n) => n.toFixed(1)).join(', ')}</div>
            {selection.material === undefined ? null : <div style={styles.info}>mat: {selection.material}</div>}
            {game.hideSelectedObject ? (
              <button
                onClick={() => setHiddenCount(game.hideSelectedObject?.() ?? 0)}
                style={styles.actionButton}
                type="button"
              >
                Hide object
              </button>
            ) : null}
          </>
        ) : (
          <div style={styles.hint}>{game.hideSelectedObject ? 'click a model…' : 'picking needs a rebuilt pak'}</div>
        )}
        {hiddenCount > 0 ? (
          <>
            <div style={styles.hint}>hidden: {hiddenCount} (restored on exit)</div>
            <button
              onClick={() => setHiddenCount(game.restoreHiddenObjects?.() ?? 0)}
              style={styles.actionButton}
              type="button"
            >
              Restore all
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}

function cellKey([cx, cy]: CellCoord): string {
  return `${cx},${cy}`;
}

function Checkbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}): ReactElement {
  return (
    <label style={styles.label}>
      <input checked={checked} onChange={onToggle} style={styles.radio} type="checkbox" />
      <span style={checked ? styles.optionActive : styles.option}>{label}</span>
    </label>
  );
}

/** Inclusive integer range, ascending or descending depending on the bounds. */
function range(from: number, to: number): number[] {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) {
    out.push(v);
  }

  return out;
}

function regionOf([cx, cy]: CellCoord, cellSize: number): Region {
  const x = cx * cellSize + cellSize / 2;
  const y = cy * cellSize + cellSize / 2;
  if (x > 200 && y < -300) {
    return 'Los Santos';
  }
  if (x > 600 && y > 600) {
    return 'Las Venturas';
  }
  if (x < -700) {
    return 'San Fierro';
  }

  return 'Countryside';
}
