/**
 * `data/vehicle-features.txt` — an OpenSA data file, not one of SA's.
 *
 * Vehicle mods ship a `features.txt` declaring what their model can do beyond geometry (the Modloader/IVF
 * convention). `vehicle-installer` copies each mod's declaration into this table as `<model> <FEATURE>…`,
 * and the CONVERTER reads it while baking that car — which is why the file exists at all: the mod folder is
 * long gone by the time a `.osm` is built. It is a BUILD-time input; nothing reads it at runtime, and a
 * declaration a car misses here can never be recovered later, which is why an unconverted car is refused
 * at spawn rather than parsed from its DFF.
 *
 * The token VOCABULARY itself lives here too ({@link VEHICLE_FEATURE_TOKENS}), because both targets stand on
 * it: OpenSA hands a token to its detectors, and the `sa` build translates it into a stock model for
 * fastman92's `data/model_special_features.dat` ({@link saCarrierFor}).
 */

/** Retractable ("pop-up") headlights, spelled the way IVF and mod authors spell it. */
export const UP_DOWN_LIGHTS = 'UP/DOWN_LIGHTS';

/** A vocabulary row: the token as mods spell it, and the stock models that natively carry that ability. */
export interface VehicleFeatureToken {
  /** Stock model names; any one of them is a valid `StandardModelName` for FLA's special-feature loader. */
  readonly saCarriers: readonly string[];
  readonly token: string;
}

/** Parse the table: model (lowercased) → its declared features (uppercased). `#` starts a comment. */
export function parseVehicleFeatures(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const body = line.split('#')[0].trim();
    if (body === '') {
      continue;
    }
    const [model, ...tokens] = body.split(/[\s,;]+/);
    if (model && tokens.length > 0) {
      out.set(
        model.toLowerCase(),
        tokens.map((token) => token.toUpperCase()),
      );
    }
  }

  return out;
}

/**
 * The full token vocabulary (the VSA classes, normalised), token → the stock models that carry it.
 *
 * The spelling is the IVF/Modloader one, odd case and characters included, because that is what mods in the
 * wild write; matching folds case, so a mod may spell a token however it likes. The carrier list is a
 * REFERENCE — the real game's only lever for a special ability is a model id, so the `sa` build maps a
 * declaration onto a carrier through {@link saCarrierFor}. OpenSA never keys on these ids: its detectors
 * derive an ability from the asset and use this list as their test oracle.
 */
export const VEHICLE_FEATURE_TOKENS: readonly VehicleFeatureToken[] = [
  { saCarriers: ['hotknife', 'bandito'], token: 'ADV_HYDRALICs' },
  { saCarriers: ['bagboxa'], token: 'BAGBOXA' },
  { saCarriers: ['bagboxb'], token: 'BAGBOXB' },
  { saCarriers: ['bfinject'], token: 'BF_ENGINE&HYDRALICS' },
  { saCarriers: ['dozer'], token: 'BUCKETs' },
  { saCarriers: ['cement'], token: 'CISTERNs' },
  { saCarriers: ['packer'], token: 'PACKERs' },
  { saCarriers: ['tractor'], token: 'TRACTOR_HOOKs' },
  { saCarriers: ['linerun', 'petro', 'rdtrain', 'artict3'], token: 'TRAILER_HOOKs' },
  { saCarriers: ['towtruck'], token: 'TRUCK_HOOKs' },
  { saCarriers: ['tugstair'], token: 'TUGSTAIR' },
  { saCarriers: ['rhino', 'swatvan'], token: 'TURRETs_1' },
  { saCarriers: ['firetruk'], token: 'TURRETs_2' },
  { saCarriers: ['zr350'], token: UP_DOWN_LIGHTS },
  { saCarriers: ['firetruk', 'swatvan'], token: 'WATER_JETs' },
];

/** The carrier chosen for a declaration, the vocabulary tokens it covers, and the ones it cannot. */
export interface VehicleFeatureCarrier {
  readonly covers: readonly string[];
  readonly dropped: readonly string[];
  /** Stock model name to name as the `StandardModelName` in `data/model_special_features.dat`. */
  readonly model: string;
}

/** Every stock carrier, in table order, with the vocabulary tokens it natively carries. */
const CARRIER_ABILITIES: ReadonlyMap<string, readonly string[]> = buildCarrierAbilities();

/**
 * The vocabulary tokens a STOCK model natively carries; empty for a model that carries none.
 *
 * This is what makes remapping honest on the `sa` target: pointing a slot at a standard model REPLACES the
 * slot's own native abilities, so the writer has to know what the slot already has before it writes a line.
 */
export function saAbilitiesOf(model: string): readonly string[] {
  return CARRIER_ABILITIES.get(model.toLowerCase()) ?? [];
}

/**
 * Pick the ONE stock model whose native abilities cover as much of `tokens` as possible — what FLA's
 * special-feature loader can express, since it maps a model onto a single standard model.
 *
 * Prefers a carrier covering EVERY declared vocabulary token (`swatvan` for `TURRETs_1` + `WATER_JETs`);
 * otherwise the carrier covering the most of them, ties broken by table order so a build is reproducible.
 * Tokens outside the vocabulary are neither covered nor `dropped` — they are carried and ignored, as they
 * are everywhere else in the chain, and a declaration of nothing but those resolves to `null`.
 */
export function saCarrierFor(tokens: readonly string[]): null | VehicleFeatureCarrier {
  const declared: string[] = [];
  for (const token of tokens) {
    const known = vehicleFeatureToken(token);
    if (known && !declared.includes(known)) {
      declared.push(known);
    }
  }

  if (declared.length === 0) {
    return null;
  }

  let best: null | VehicleFeatureCarrier = null;
  for (const [model, carried] of CARRIER_ABILITIES) {
    const covers = declared.filter((token) => carried.includes(token));
    if (covers.length > (best?.covers.length ?? 0)) {
      best = { covers, dropped: declared.filter((token) => !covers.includes(token)), model };
      if (best.dropped.length === 0) {
        break;
      }
    }
  }

  return best;
}

/** The vocabulary token a declaration spells, whatever its case, or `undefined` if it is not one of ours. */
export function vehicleFeatureToken(declared: string): string | undefined {
  const folded = declared.toUpperCase();

  return VEHICLE_FEATURE_TOKENS.find((row) => row.token.toUpperCase() === folded)?.token;
}

function buildCarrierAbilities(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { saCarriers, token } of VEHICLE_FEATURE_TOKENS) {
    for (const carrier of saCarriers) {
      const carried = out.get(carrier);
      if (carried) {
        carried.push(token);
      } else {
        out.set(carrier, [token]);
      }
    }
  }

  return out;
}
