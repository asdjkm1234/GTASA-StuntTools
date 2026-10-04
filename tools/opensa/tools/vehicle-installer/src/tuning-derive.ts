/**
 * A car's TUNING PARTS that belong to ANOTHER car, derived — plan 005, extended by 014.
 *
 * A car that ships a `.dff` under a stock part's name is saying "this is that part, re-modelled for my
 * body". When the part is the slot's OWN, that is exactly what a replacement mod does and the name stays.
 * When it belongs to a DIFFERENT car it must not reach the archive under that name — an entry name is
 * global, so it would replace the part every other car wearing it gets. Those get a new unique name, and
 * everything the game knows about the stock one is cloned under it: the IDE row, the shop item, the price,
 * the `link` to its mirror, and its place on the car's `carmods.dat` line.
 *
 * **Whose part is it? The stock `veh_mods.ide` row's TXD column says so** — it names the car the part is
 * textured by (`rbmp_lr_bl1` → `blade`), or `vehicle` for the parts any car can wear. That column, not the
 * `carmods.dat` `mods` line: a right-hand part is bought through its left partner's `link` and is on no
 * line at all (22 of them, plus slamvan's two bonnets no shop offers), and treating those as new would
 * rename one half of a stock `link` pair and leave the car buying a left skirt with no right side. Measured
 * on the stock tables: no car's line names a part whose txd is another car's, so the column never
 * contradicts the line — it only sees the parts the line cannot show. The rule needs no per-car table, and
 * it serves both callers with nothing to switch on: for an ADDED car every stock part it ships belongs to
 * its base, so all of them derive, exactly as before.
 *
 * **Nothing here is a table.** The user's earlier tool carried a hand-written rename per car; every value
 * below is read from the built `data/` or from the name itself, so a car nobody has seen yet works the same.
 *
 * **The new name is the stock name plus `_<token>`.** Not a rewrite of the stock naming scheme: SA derives a
 * component's flags from the name's PREFIX (`CAtomicModelInfo::SetupVehicleUpgradeFlags`), and the exact set
 * of prefixes it switches on is documented but not exhaustively known here — appending keeps every prefix
 * rule matching whatever it is, where replacing a field in the middle would be a guess. The ceiling is 19
 * characters (`docs/gta-sa-original/carmods-upgrade-ceilings.md`) and it is REFUSED, not truncated.
 *
 * The token is `slotTokens`' — the shortest prefix that tells the slot apart from every other slot, floor 3
 * — and not the slot name itself, because the whole name overflows the ceiling on real data
 * (`wg_r_lr_slv1_slamvan` is 20, so today's scheme refuses a part the shop needs). It is derived, not
 * registered: the same slot table always yields the same token.
 *
 * **A part is base-specific when its IDE row's TXD column names the base car**, and generic when it names
 * `vehicle` (nitro, hydraulics, stereo, wheels — 48 of the stock rows). That is the rule that decides what
 * a derived `mods` line keeps: generic parts stay, re-modelled parts take their new name, and a
 * base-specific part the car does NOT ship is dropped — it fits the base's body, not this one.
 */
import { parseCarmods } from '@opensa/renderware/parsers/text/carmods.parser';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { VEH_MODS_IDE } from './tuning-parts';

/** The TXD column of a part that belongs to no particular car. */
const GENERIC_TXD = 'vehicle';

/** An IMG entry name is 24 bytes including `.dff`, and the IDE loader reads a name into `char[24]`. */
export const MAX_PART_NAME = 19;

/** Below this a token stops naming the car it came from, however unique it is. */
export const MIN_SLOT_TOKEN = 3;

/** What one added car's shipped parts become. */
export interface DerivedTuning {
  /** `link` pairs to add, under the new names. */
  readonly links: readonly [string, string][];
  /** `<stock file name>.dff` (lowercased) → the entry name it is staged under. */
  readonly renames: ReadonlyMap<string, string>;
  /** `veh_mods.ide` rows to add, with `<:id>` where the id goes. */
  readonly rows: readonly { readonly from: string; readonly name: string; readonly row: string }[];
  /** Shop item + price lines to clone, each after the stock part it was cloned from. */
  readonly shop: readonly {
    readonly after: string;
    readonly item: string;
    readonly price: string;
    /** The `section shops` → `section <name>` the stock item sits in (`carmod1`, `carmod2`, `transfender`). */
    readonly section: string;
  }[];
  readonly warnings: readonly string[];
}

/** One car's shipped parts, and the slot table its derived names are told apart by. */
export interface DeriveTuningOptions {
  /** The stock car this one varies — its own slot, for a mod that replaces a stock car in place. */
  readonly base: string;
  /** A BUILT game tree: `data/carmods.dat`, `data/shopping.dat` and the `veh_mods.ide` rows are read from it. */
  readonly gameDir: string;
  /** The folder's `.dff` file names that are not the car itself. */
  readonly shipped: readonly string[];
  /** The car's own slot. */
  readonly slot: string;
  /** What a derived part name ends in — `slotTokens(...).get(slot)`. */
  readonly token: string;
}

/** One stock upgrade part, as `veh_mods.ide` defines it. */
export interface StockPart {
  /** Everything after the txd column, verbatim — draw distance and flags. */
  readonly columns: string;
  readonly id: number;
  readonly name: string;
  /** The dictionary column: the base car's model, or `vehicle` for a part any car can wear. */
  readonly txd: string;
}

/**
 * Derive everything an added car's re-modelled parts need. `shipped` is the folder's `.dff` names that are
 * NOT the car itself; `slot` is the added car's own slot, `base` the stock car it varies, and `token` the
 * tail its parts are renamed with — the caller's, out of `slotTokens` over every slot the run knows about.
 */
export function deriveTuning({ base, gameDir, shipped, slot, token }: DeriveTuningOptions): DerivedTuning {
  const warnings: string[] = [];
  const stock = readStockParts(gameDir);
  const carmods = parseCarmods(readFileSync(join(gameDir, 'data', 'carmods.dat'), 'latin1'));
  const shopping = existsSync(join(gameDir, 'data', 'shopping.dat'))
    ? readFileSync(join(gameDir, 'data', 'shopping.dat'), 'latin1')
    : '';

  const parts = shipped.map((file) => file.replace(/\.dff$/i, '').toLowerCase());
  const renames = new Map<string, string>();
  const rows: { from: string; name: string; row: string }[] = [];
  const shop: { after: string; item: string; price: string; section: string }[] = [];
  for (const part of parts) {
    const stockPart = stock.get(part);
    if (stockPart === undefined) {
      // Nothing to clone FROM. A part the stock game never had is the mod's own to declare, which is what
      // `tuning_new_parts.txt` is for; here it just ships under the name it was authored with.
      warnings.push(`${part}.dff is not a part any veh_mods.ide row defines — shipped as it is, under its own name`);
      continue;
    }
    if (stockPart.txd === slot) {
      // The slot's OWN part, re-modelled for the body that is replacing it: it keeps its name and replaces
      // the stock geometry, which is the whole point of a replacement mod. Nothing to derive.
      continue;
    }
    if (stockPart.txd === GENERIC_TXD) {
      warnings.push(
        `${part}.dff re-models a part every car wears (its veh_mods.ide row's txd is '${GENERIC_TXD}') — ` +
          `installed under its own name, so every other car gets this version too`,
      );
      continue;
    }
    const derived = `${part}_${token}`;
    if (derived.length > MAX_PART_NAME) {
      warnings.push(
        `${derived} is ${derived.length} characters and a part name may be ${MAX_PART_NAME} — the part is ` +
          `not installed (the IDE loader reads a name into char[24] and an IMG entry name is 24 with '.dff')`,
      );
      continue;
    }
    renames.set(`${part}.dff`, `${derived}.dff`);
    // The TXD is the ADDED car's own: a re-modelled part is textured by the car that ships it.
    rows.push({ from: part, name: derived, row: `<:id>, ${derived}, ${slot}, ${stockPart.columns}` });
    const entry = shopEntry(shopping, part);
    if (entry === null) {
      // A part with no shop entry is normal — a right-hand wing is bought through its left partner's link.
      continue;
    }
    shop.push({ after: part, item: derived, price: entry.price.replace(part, derived), section: entry.section });
  }

  if (base !== slot) {
    warnings.push(...borrowedParts(carmods.mods.get(slot) ?? carmods.mods.get(base), renames, stock, base));
  }

  return {
    links: deriveLinks(carmods.links, renames, warnings),
    renames,
    rows,
    shop,
    warnings,
  };
}

/** Every stock upgrade part by name, out of `veh_mods.ide`. */
export function readStockParts(gameDir: string): Map<string, StockPart> {
  const parts = new Map<string, StockPart>();
  const path = join(gameDir, VEH_MODS_IDE);
  if (!existsSync(path)) {
    return parts;
  }
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const cells = line
      .split('#')[0]
      .split(',')
      .map((cell) => cell.trim());
    if (cells.length >= 3 && /^\d+$/.test(cells[0])) {
      parts.set(cells[1].toLowerCase(), {
        columns: cells.slice(3).join(', '),
        id: Number(cells[0]),
        name: cells[1].toLowerCase(),
        txd: cells[2].toLowerCase(),
      });
    }
  }

  return parts;
}

/** The dff names in a car folder that are not the car itself. */
export function shippedParts(folder: string, slot: string): string[] {
  return readdirSync(folder)
    .filter((name) => name.toLowerCase().endsWith('.dff') && !name.toLowerCase().startsWith(slot.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * Slot → the shortest prefix that tells it apart from every other slot in `slots`, floor `MIN_SLOT_TOKEN`.
 *
 * A slot whose whole name is another slot's prefix has no unique prefix of its own and keeps its full name;
 * the longer slot then has to reach past it, so two slots can never end up on the same token.
 *
 * The caller owns the table: it must hold every slot the run can name, or two cars share a token and one
 * silently overwrites the other's part. `add-vehicles` passes the built tree's slots PLUS every added slot
 * of the source, whether or not `--only` narrowed the run — the same reason its ids are allocated for all.
 */
export function slotTokens(slots: Iterable<string>): Map<string, string> {
  const names = [...new Set([...slots].map((slot) => slot.toLowerCase()))];
  const tokens = new Map<string, string>();
  for (const name of names) {
    const shortest = [...Array(Math.max(name.length - MIN_SLOT_TOKEN + 1, 0)).keys()]
      .map((step) => name.slice(0, MIN_SLOT_TOKEN + step))
      .find((prefix) => !names.some((other) => other !== name && other.startsWith(prefix)));
    tokens.set(name, shortest ?? name);
  }

  return tokens;
}

/**
 * Every vehicle slot the tree's `vehicles.ide` names, lowercased — the table `slotTokens` is told apart in.
 *
 * Read off the `cars` rows directly rather than through `parseVehicleDefs`, which needs the wheel columns and
 * so drops the eleven boats (`predator` … `launch`). A dropped slot is a slot two tokens could collide on.
 */
export function vehicleSlots(gameDir: string): string[] {
  const path = join(gameDir, 'data', 'vehicles.ide');
  if (!existsSync(path)) {
    return [];
  }
  const slots: string[] = [];
  let section = '';
  for (const raw of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const row = /^\d+\s*,\s*([^,\s]+)/.exec(line);
    if (line === '') {
      continue;
    }
    if (row === null) {
      section = line.toLowerCase();
    } else if (section === 'cars') {
      slots.push(row[1].toLowerCase());
    }
  }

  return slots;
}

/**
 * The base's OWN parts a car's `carmods.dat` line names without re-modelling them. Not an error — the part
 * exists and the shop will sell it — but it was modelled for the base's body, so it is the thing to look at
 * when a bumper floats. A generic part (`nto_*`, `hydralics`, whose IDE row's TXD column is `vehicle`) is
 * not one of these: it fits anything.
 */
function borrowedParts(
  line: readonly string[] | undefined,
  renames: ReadonlyMap<string, string>,
  stock: ReadonlyMap<string, StockPart>,
  base: string,
): string[] {
  if (line === undefined) {
    return [];
  }
  const borrowed = line.filter(
    (part) =>
      renames.get(`${part.toLowerCase()}.dff`) === undefined &&
      (stock.get(part.toLowerCase())?.txd ?? GENERIC_TXD) !== GENERIC_TXD,
  );

  return borrowed.length === 0
    ? []
    : [
        `its carmods line names ${borrowed.length} of ${base}'s own part(s) that it does not re-model ` +
          `(${borrowed.join(', ')}) — they will fit the base's body, not this one`,
      ];
}

/** A stock link pair both of whose sides this car re-models, under the new names. */
function deriveLinks(
  stockLinks: readonly [string, string][],
  renames: ReadonlyMap<string, string>,
  warnings: string[],
): [string, string][] {
  const links: [string, string][] = [];
  const derived = (part: string): string | undefined =>
    renames.get(`${part.toLowerCase()}.dff`)?.replace(/\.dff$/i, '');
  for (const [left, right] of stockLinks) {
    const newLeft = derived(left);
    const newRight = derived(right);
    if (newLeft !== undefined && newRight !== undefined) {
      links.push([newLeft, newRight]);
    } else if (newLeft !== undefined || newRight !== undefined) {
      warnings.push(
        `${newLeft ?? newRight} re-models one side of the stock pair '${left}, ${right}' — the other side is ` +
          `not shipped, so the part has no mirror and the shop cannot pair them`,
      );
    }
  }

  return links;
}

/**
 * Where a stock part is SOLD and for how much: the `section shops` → `section <name>` its `item` line sits
 * in, and its `prices` row verbatim. Null when the part has neither — a mirrored part (a right-hand wing) is
 * bought through its partner and has no entry of its own.
 */
function shopEntry(shopping: string, part: string): null | { price: string; section: string } {
  let section = '';
  let price: null | string = null;
  let found: null | string = null;
  for (const raw of shopping.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^section\s+(\S+)/i.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    const tokens = line.split(/\s+/);
    if (tokens[0]?.toLowerCase() === 'item' && tokens[1]?.toLowerCase() === part) {
      found = section;
      continue;
    }
    if (tokens[0]?.toLowerCase() === part) {
      price = line;
    }
  }

  return found === null || price === null ? null : { price, section: found };
}
