/**
 * The status bar reports the RENDERER, not the board: frame cost, what is resident, where the view is and
 * which pak build is being read. A field report that does not name its build is a field report nobody can
 * reproduce, so the build stamp is on screen rather than in a console line.
 */
import type { ReactElement } from 'react';

import type { DispatchReadout } from '../world/boot';

import { COLORS, styles } from './styles';

export function StatusBar({
  compact = false,
  readout,
}: {
  /** Phone layout: drop the gesture hint and the pak stamp — there is no room, and neither is actionable. */
  compact?: boolean;
  readout: DispatchReadout | null;
}): ReactElement {
  if (!readout) {
    return (
      <div style={styles.statusBar}>
        <span>booting engine · streaming world…</span>
      </div>
    );
  }
  const [x, y] = readout.pose.at;

  return (
    <div style={styles.statusBar}>
      {/* 201/4-01 and 201/3-05: the frame rate and the frame COST, in ONE field so the narrowest bar cannot
          cut one off the other — they answer different questions and reading either alone is how this
          console has been misjudged. At rest it says so rather than showing a rate it is not paying for. */}
      <span
        style={{ color: readout.idle ? COLORS.muted : readout.fps < 45 ? COLORS.danger : COLORS.accent }}
        title={
          readout.idle
            ? 'Nothing has changed — no frames are being drawn. The cost beside it is the last drawn frame’s.'
            : 'Frames drawn in the last second, and what a frame is costing'
        }
      >
        {frameField(readout, compact)}
      </span>
      <span>
        cells {readout.cellsVisible}/{readout.cellsTotal}
      </span>
      <span>draws {readout.draws}</span>
      <span>resident {readout.residencyMb.toFixed(0)} MB</span>
      {readout.pending > 0 && <span>streaming {readout.pending}…</span>}
      {/* 201/6-02: the flat map says which pyramid level it is drawing, or why it is drawing none — an empty
          2D map that is silent about it is indistinguishable from one that is still loading. */}
      {readout.tiles !== undefined && (
        // The pyramid's state can be a whole sentence when it is an error, and this bar is 22 px of a phone:
        // it ellipsizes rather than running off the end of a row that cannot scroll.
        <span style={styles.statusEllipsis} title={readout.tiles}>
          {readout.tiles}
        </span>
      )}
      {/* 201/3-03: what the decluttering dropped. Every symbol is on screen — these are the NAMES that
          did not fit, and an operator who cannot see the count would read a crowded map as a complete one. */}
      {readout.namesHidden > 0 && <span title="Labels the map could not fit">{readout.namesHidden} names hidden</span>}
      {!compact && (
        <span>
          view {x.toFixed(0)}, {y.toFixed(0)} · {readout.pose.height.toFixed(0)} m
        </span>
      )}
      {!compact && <span style={{ marginLeft: 'auto' }}>pak {readout.buildTime}</span>}
      {!compact && (
        <span style={styles.statusEllipsis}>
          left-drag pan · right-drag orbit · wheel zoom · click select · right-click new call
        </span>
      )}
    </div>
  );
}

/**
 * The one field: how many frames, and what one is costing.
 *
 * The cost has two honest forms and which one is available depends on how the console is being used, so the
 * field NAMES the one it is showing rather than printing a bare number that means different things:
 *
 * - **the interval** between two consecutive drawn frames, which is the real answer while the map is being
 *   flown — it includes the wait on the GPU and the vsync, which is most of a frame on a phone (201/1-01
 *   measured the main thread running 5.83 ms of a 27.56 ms frame);
 * - **`cpu`, the loop body**, when the window holds no consecutive pair at all. A console that renders on
 *   demand produces exactly that under a slow drag: every drawn frame sits between two skipped wakes, so
 *   there is no interval to measure and the body is the only thing that was really timed.
 *
 * Never a fabricated `0.0 ms`, and never a stale one carried over from the last time the map moved.
 */
function frameField(readout: DispatchReadout, compact: boolean): string {
  const cost = readout.frameMs > 0 ? `${readout.frameMs.toFixed(1)} ms` : `cpu ${readout.cpuMs.toFixed(1)} ms`;
  // On a desk both are worth carrying: the interval says what the operator is getting, the body says how
  // much of it this console is responsible for. A phone bar has room for one.
  const both = !compact && readout.frameMs > 0 ? `${cost} · cpu ${readout.cpuMs.toFixed(1)} ms` : cost;

  return readout.idle ? `idle · last ${both}` : `${readout.fps} fps · ${both}`;
}
