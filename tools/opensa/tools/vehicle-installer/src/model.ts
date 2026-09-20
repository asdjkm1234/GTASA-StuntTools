import { parseVehicleSlot } from '@opensa/tool-kit/vehicles-dir';

/**
 * The model SLOT a vehicle folder takes over — what the ide/handling merge keys on, what the mod-car ledger
 * records, what `--strip` keeps, and the name the rebake converts into `<model>.osm`.
 *
 * The folder NAME states it (`admiral - 1976 Mercedes-Benz 230 - k1real24` → `admiral`, contract
 * `docs/contracts/vehicles.md` §1), and the folder's own `.dff` files confirm it. Taking "the first `.dff`
 * in the folder" instead was wrong for 10 of the original's 212 cars: a bodykit ships `exh_a_l.dff`,
 * `bbb_lr_slv1.dff` … beside the car, and alphabetically those come FIRST — so `flash` entered the ledger as
 * `exh_a_f` (video mode then never saw the slot as modded), `--strip` would have dropped the very car it was
 * told to keep, and a `--rebake` converted the exhaust into `exh_a_f.osm` while the car kept its old model.
 *
 * When the folder claims a slot it ships no `.dff` for, the first `.dff` is still used — the old rule, so a
 * mis-named folder installs exactly as it did — but it says so: nothing downstream can tell the two apart.
 */
export function resolveVehicleModel(
  folderName: string,
  dffNames: readonly string[],
): { model?: string; warning?: string } {
  const models = dffNames
    .filter((name) => /\.dff$/i.test(name))
    .map((name) => name.replace(/\.dff$/i, '').toLowerCase());
  if (models.length === 0) {
    return {};
  }
  const slot = parseVehicleSlot(folderName);
  if (models.includes(slot)) {
    return { model: slot };
  }

  return {
    model: models[0],
    warning:
      `the folder name claims the slot '${slot}' but no '${slot}.dff' ships in it — ` +
      `installed as '${models[0]}' instead. Rename the folder '<slot> - <car> - <author>' so the ledger, ` +
      'the strip set and a rebake all name the car the game will actually load',
  };
}
