import type { VehicleSettings } from '@opensa/vehicle-installer/settings';

import { carcolsSection } from '@opensa/vehicle-installer/merge';

/** What one car folder ships, as the page needs to read it. */
export interface VehicleFolderContents {
  /** Every entry name in the folder (files and directories). */
  readonly entries: readonly string[];
  /** True when the folder carries a `cleo/` subfolder. */
  readonly hasCleo: boolean;
  /** The car's model slot, lowercased. */
  readonly slot: string;
}

/** The universal nitro upgrades every tunable stock car already has — they say nothing about this mod. */
const UNIVERSAL_PARTS = /^nto_/i;

/**
 * What a mod brings on top of "a different model in the slot", read from the folder itself — its files and
 * its `*.settings.txt` lines. Nothing here consults the built game: the page describes THIS mod.
 *
 * The order is fixed so two cards read the same way, and it is the order the request stated:
 * `Tuning, New Tuning Parts, N Paint Jobs, Car4 Supported, New Colors, Has Cleo Script`.
 */
export function vehicleTags(folder: VehicleFolderContents, settings: VehicleSettings): string[] {
  const tags: string[] = [];
  const parts =
    settings.carmodsLine
      ?.split(',')
      .slice(1)
      .map((part) => part.trim())
      .filter(Boolean) ?? [];
  if (parts.some((part) => !UNIVERSAL_PARTS.test(part))) {
    tags.push('Tuning');
  }
  // More than one `.dff` means the mod re-modelled the kit itself (`exh_a_l.dff`, `spl_c_l_b.dff` …) —
  // the parts ship WITH the car rather than being the stock ones its carmods line names.
  if (folder.entries.filter((name) => /\.dff$/i.test(name)).length > 1) {
    tags.push('New Tuning Parts');
  }
  const paintJobs = folder.entries.filter((name) =>
    new RegExp(`^${escapeRegExp(folder.slot)}\\d+\\.txd$`, 'i').test(name),
  ).length;
  if (paintJobs > 0) {
    tags.push(`${paintJobs} Paint Job${paintJobs === 1 ? '' : 's'}`);
  }
  // The installer's own rule, not a second reading of it: 4 values per colour combo is the `car4` section.
  if (settings.carcolsLine !== undefined && carcolsSection(settings.carcolsLine) === 'car4') {
    tags.push('Car4 Supported');
  }
  if (settings.palette?.length) {
    tags.push('New Colors');
  }
  if (folder.hasCleo) {
    tags.push('Has Cleo Script');
  }

  return tags;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
