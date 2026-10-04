/**
 * The `MapGame` the debugger's `MapInspector` drives (plan 094, phase 2). Implementing that one interface is
 * what buys the whole panel — the cell grid, the whole-map toggle, LOD mode, the selection block — without
 * copying a line of its UI.
 *
 * The inspector OWNS the cell set here, exactly as it does in the game: it seeds itself from `viewCell()` at
 * mount (so the viewer opens on the cell under the camera, which is what `?at` names) and every checkbox
 * writes through `setManualCells`. There is no camera-follow behind its back — two owners of one cell set is
 * how a debug tool starts lying about what it is showing.
 *
 * Picking (phase 3) rides the `.oscell` placement mapper (minor 6) the welder writes: a click becomes a cursor
 * ray, `CellStore.pick` slab-tests it against the mapper rows of every visible cell, and the hit goes out on
 * the `select` event the inspector's SELECTED block already listens to.
 */
import type { Engine } from '@opensa/engine';
import type { CellCoord, GameEvents } from '@opensa/game';
import type { ModelSearchHit } from '@opensa/renderware';
import type { MapGame } from '@opensa/web/ui/debug/map-inspector';

import { CELL_SIZE } from '@opensa/cell-weld';
import { EventBus } from '@opensa/game/events/event-bus';
import { ModelIndex } from '@opensa/renderware';
import { CAMERA_FOV_Y, cursorRay } from '@opensa/web/ui/camera/engine-camera';

import type { ViewerCamera } from '../camera/viewer-camera';
import type { LoadedMap } from '../source/map-source';
import type { CellLoadStats, CellRenderer } from './cell-renderer';

import { cellAt } from './cell-renderer';

/** Progress while a big set welds — the whole-map toggle must show its cost, not hide it. */
export interface CellProgress {
  done: number;
  total: number;
}

/** A cell-set change, reported for the readout + the console record. */
export interface CellSetEvent {
  lod: boolean;
  stats: CellLoadStats;
}

export class ViewerMapGame implements MapGame {
  readonly events = new EventBus<GameEvents>();

  private hidden = 0;
  /** Built on the first search: walking every instance is wasted on a session that never searches. */
  private index: ModelIndex | null = null;
  private pending: null | { cells: CellCoord[]; lod: boolean } = null;
  private readonly renderer: CellRenderer;
  private running = false;
  private selected: null | number = null;

  constructor(
    private readonly engine: Engine,
    private readonly map: LoadedMap,
    private readonly camera: ViewerCamera,
    renderer: CellRenderer,
    private readonly onCells: (event: CellSetEvent) => void,
    private readonly onProgress: (progress: CellProgress | null) => void,
  ) {
    this.renderer = renderer;
  }

  cellSize(): number {
    return CELL_SIZE;
  }

  /**
   * Centre the view on the next placement of `name` and answer its cell, which the inspector then makes
   * resident. The pose is untouched — a search from the whole-map height stays at that height, so the jump
   * cannot silently change what a capture is showing.
   */
  focusModel(name: string): CellCoord | null {
    const position = this.models().focusNext(name, this.camera.positionGta());
    if (!position) {
      return null;
    }
    const at: [number, number] = [position[0], position[1]];
    this.camera.lookAtGta(at);
    const { cx, cy } = cellAt(at);

    return [cx, cy];
  }

  /** Hide the picked placement (degenerate its indices). Returns how many are hidden now. */
  hideSelectedObject(): number {
    if (this.selected !== null && this.engine.cells.hidePlacement(this.selected) > 0) {
      this.hidden += 1;
      this.selected = null;
      this.events.emit('select', null); // it is gone from view — the panel must not still describe it
    }

    return this.hidden;
  }

  listCells(): CellCoord[] {
    return [...this.map.grid.values()].map((cell): CellCoord => [cell.cx, cell.cy]);
  }

  /**
   * Pick along the ray through the clicked point. The cursor is the aim: this camera has no pointer lock, and
   * a forward-vector pick would report whatever happens to sit at screen centre.
   */
  pickAt(ndc: readonly [number, number], aspect: number): void {
    const { eye, forward } = this.camera.eyeAndForward();
    const hit = this.engine.cells.pick(eye, cursorRay(forward, ndc, aspect, CAMERA_FOV_Y));
    this.selected = hit?.id ?? null;
    this.events.emit(
      'select',
      hit
        ? {
            // Engine (x, y, z) back to GTA (x, −z, y): the panel reports the coordinates the map files use.
            modelName: hit.model,
            position: [hit.position[0], -hit.position[2], hit.position[1]],
            txdName: hit.txd,
          }
        : null,
    );
  }

  /** Un-hide everything: hiding has no inverse, so the resident cells are re-created from their bytes. */
  restoreHiddenObjects(): number {
    this.renderer.reload();
    this.hidden = 0;
    this.selected = null;
    this.events.emit('select', null);

    return 0;
  }

  /** Autocomplete over the names this map actually places. */
  searchModels(query: string): ModelSearchHit[] {
    return this.models().search(query);
  }

  /** The inspector's writes land here. A set arriving mid-weld replaces the queued one, never interleaves. */
  setManualCells(cells: CellCoord[] | null, lod = false): void {
    this.pending = { cells: cells ?? [], lod };
    if (!this.running) {
      void this.drain();
    }
  }

  /** The viewer IS the map viewer — there is no other mode to enter. */
  setMapViewer(): void {
    // nothing to do
  }

  /** Draw the sea or not (plan 094/07) — the mesh stays uploaded either way, only the draw is gated. */
  setShowWater(enabled: boolean): void {
    this.engine.waterEnabled = enabled;
  }

  viewCell(): CellCoord | null {
    const { cx, cy } = cellAt(this.camera.positionGta());

    return [cx, cy];
  }

  /** Apply queued sets one at a time, always ending on the most recent one. */
  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending) {
        const { cells, lod } = this.pending;
        this.pending = null;
        this.onProgress(cells.length > 1 ? { done: 0, total: cells.length } : null);
        const stats = await this.renderer.setCells(
          cells.map(([cx, cy]) => ({ cx, cy })),
          lod,
          (done, total) => this.onProgress({ done, total }),
        );
        this.onProgress(null);
        this.onCells({ lod, stats });
      }
    } finally {
      this.running = false;
    }
  }

  /** The search index, built once — it also carries the per-name placement cursor the cycling reads. */
  private models(): ModelIndex {
    this.index ??= new ModelIndex(this.map.defs);

    return this.index;
  }
}
