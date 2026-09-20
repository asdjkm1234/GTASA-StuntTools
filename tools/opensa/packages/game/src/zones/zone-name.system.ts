import type { NamedZone } from '../adapters/named-zones';
import type { System } from '../core/system';
import type { Vec3 } from '../interfaces/world-adapter.interface';

import { namedZoneAt } from '../adapters/named-zones';

export type { NamedZone };

/**
 * Tracks the district (`info.zon` zone) the player is in and calls `onChange(zoneKey)` when it changes.
 * `onChange` gets the zone's GXT **key** (e.g. `LMEX`); the caller resolves it to display text via the GXT.
 * Empty string is sent when the player is in no zone.
 *
 * The "which box" rule — the SMALLEST containing one, since the boxes nest — lives beside the parser that
 * produced them (`zoneAt`, renderware), reached through `adapters/named-zones` because that is the only door
 * this package has to that layer. So the game's HUD and the dispatch console's readout cannot answer the
 * same point differently (201/5-03); this class is the per-frame tracking around it and nothing else.
 */
export class ZoneNameSystem implements System {
  readonly name = 'zone-name';

  private current: null | string = null;
  private readonly onChange: (zoneKey: string) => void;
  private readonly position: () => Vec3;
  private readonly zones: readonly NamedZone[];

  constructor(zones: readonly NamedZone[], position: () => Vec3, onChange: (zoneKey: string) => void) {
    this.zones = zones;
    this.position = position;
    this.onChange = onChange;
  }

  update(): void {
    const [x, y] = this.position();
    const key = namedZoneAt(this.zones, x, y);
    if (key !== this.current) {
      this.current = key;
      this.onChange(key);
    }
  }
}
