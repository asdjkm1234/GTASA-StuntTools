/**
 * The counts in a panel's title bar — `AVAILABLE 4 · EN ROUTE 2 · ON SCENE 1`.
 *
 * Copied from SonoranCAD, which is the only console in the surveyed field that puts the tally where the
 * legend would go. It is worth copying because one line then answers two questions at once: what a colour
 * on the map MEANS, and how the shift is doing. Neither SnailyCAD, Resgrid nor CrowdCAD has it, and it
 * costs a row of text.
 *
 * The swatches are not "matched to" the map — the caller reads them from `map/beacons.ts` → `SET_COLORS`,
 * the same table the pillars are drawn from, so a legend that disagrees with the world it explains is not a
 * thing that can happen here.
 */
import type { ReactElement } from 'react';

import { styles } from './styles';

export interface TallyItem {
  /** From `SET_COLORS`, already through `css()`. */
  readonly color: string;
  readonly count: number;
  readonly label: string;
}

export function StatusTally({ items }: { items: readonly TallyItem[] }): ReactElement {
  return (
    <span style={styles.tally}>
      {/* Zero rows are dropped rather than shown as `0`: an empty count is noise in a header read at a
          glance, and the row it would occupy is the one a non-zero count needs on a 360-px screen. */}
      {items
        .filter((item) => item.count > 0)
        .map((item) => (
          <span key={item.label} style={styles.tallyItem}>
            <span style={{ ...styles.tallyDot, background: item.color }} />
            {item.label} {item.count}
          </span>
        ))}
    </span>
  );
}
