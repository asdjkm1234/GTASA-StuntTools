/**
 * `data/model_special_features.dat` — how a mod's `features.txt` reaches the REAL game (plan 011).
 *
 * In SA every special ability is a branch on a MODEL ID (`docs/gta-sa-original/vehicle-special-features.md`),
 * so a mod SL-Class in the `feltzer` slot has pop-up pods and no code that opens them. The install we ship to
 * has exactly one lever for that and it is already on: fastman92's limit adjuster ships this file and its ini
 * enables the **model special feature loader** — `CustomModelName StandardModelName` per line, the named model
 * behaves like the standard one. So the `sa` target translates each declaration into one stock CARRIER
 * (`saCarrierFor`) and writes the pairs here.
 *
 * The file belongs to the adjuster, not to us: every line we did not write is kept verbatim, ours live inside
 * ONE marked block, and the block is rewritten sorted so a rebuild is byte-identical. A rebake of one car
 * MERGES — it may only speak for the models it rebaked.
 */
import { saAbilitiesOf, saCarrierFor } from '@opensa/renderware/parsers/text/vehicle-features.parser';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** FLA's mapping file in the built game dir — written on the `sa` target only. */
export const SPECIAL_FEATURES_DAT = join('data', 'model_special_features.dat');

/** Everything our block starts with; matched by prefix so the wording can change without orphaning a block. */
const BLOCK_START = '# --- vehicle-installer:';
const BLOCK_END = '# --- end vehicle-installer ---';
const BLOCK_HEADER = [
  `${BLOCK_START} features.txt -> standard model. Do not edit, rewritten on every install ---`,
  '# Each line gives the model the abilities the standard one has natively (fastman92 model special feature',
  '# loader). Lines outside this block belong to the adjuster mod and are never touched.',
];

export interface SpecialFeaturesReport {
  /** Models this run wrote a line for, `<model> <carrier>`, in written order. */
  readonly lines: readonly string[];
  /** What the install log has to say — each one is silent in the real game otherwise. */
  readonly warnings: readonly string[];
  /** Whether the file was written at all (a tree without the adjuster's file is left alone). */
  readonly written: boolean;
}

/**
 * Point every declared model at a stock carrier in the target tree's `model_special_features.dat`.
 *
 * `authoritative` is the set of models this run may speak for — absent means all of them (a full install
 * rewrites the block), a rebake passes the cars it rebaked so the rest of the fleet keeps its lines. A model
 * that is authoritative and declares nothing loses its line, which is how a removed `features.txt` takes
 * effect.
 */
export function writeModelSpecialFeatures(
  targetPath: string,
  features: ReadonlyMap<string, readonly string[]>,
  authoritative?: ReadonlySet<string>,
): SpecialFeaturesReport {
  const path = join(targetPath, SPECIAL_FEATURES_DAT);
  const warnings: string[] = [];
  if (!existsSync(path)) {
    // Writing the file ourselves would lie about being applied: without the adjuster nothing reads it.
    return {
      lines: [],
      warnings:
        features.size > 0
          ? [
              `${features.size} model(s) declare special features but the target has no ${SPECIAL_FEATURES_DAT} — ` +
                "fastman92's limit adjuster is not installed for this target, so the declarations reach nothing " +
                '(they stay in vehicle-features.txt for the OpenSA build)',
            ]
          : [],
      written: false,
    };
  }

  const existing = readFileSync(path, 'utf8');
  const { block, foreign } = splitOurBlock(existing);
  // A full install speaks for the whole fleet, so its block is rebuilt from scratch; a rebake keeps the lines of
  // every model it did not touch.
  const kept = new Map(authoritative === undefined ? [] : block.filter(([model]) => !authoritative.has(model)));
  for (const [model, declared] of features) {
    const resolved = resolveLine(model, declared);
    warnings.push(...resolved.warnings);
    if (resolved.carrier === null) {
      kept.delete(model);
    } else {
      kept.set(model, resolved.carrier);
    }
  }

  const lines = [...kept].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([model, carrier]) => `${model} ${carrier}`);
  for (const [model] of activePairs(foreign)) {
    if (kept.has(model)) {
      warnings.push(
        `${model}: ${SPECIAL_FEATURES_DAT} already maps it outside our block — the mod's own line and ours both ` +
          'name the model and only one of them wins in the game; remove one',
      );
    }
  }
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const body = [...foreign, ...BLOCK_HEADER, ...lines, BLOCK_END, ''].join(eol);
  writeFileSync(path, body);
  warnings.push(...loaderEnabledWarnings(targetPath));

  return { lines, warnings, written: true };
}

/** The `<model> <standard>` pairs of some lines — comments and blanks drop, names fold to lower case. */
function activePairs(lines: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (const line of lines) {
    const [model, standard] = line
      .split('#')[0]
      .trim()
      .split(/[\s,;]+/);
    if (model && standard) {
      pairs.push([model.toLowerCase(), standard.toLowerCase()]);
    }
  }

  return pairs;
}

/** Whether the adjuster's ini in the tree actually turns the loader on — a file it ignores is worse than none. */
function loaderEnabledWarnings(targetPath: string): string[] {
  const ini = readdirSync(targetPath).find((name) => /^fastman92limitadjuster.*\.ini$/i.test(name));
  if (ini === undefined) {
    return [
      `${SPECIAL_FEATURES_DAT} was written but no fastman92limitAdjuster*.ini sits in the target — cannot ` +
        'confirm the model special feature loader is enabled, so the mapping may be ignored at boot',
    ];
  }
  // A commented line (`#`/`;`) is the shipped default, which is OFF — matching it would report the opposite.
  const enabled = /^[ \t]*Enable model special feature loader[ \t]*=[ \t]*[1-9]\d*/im.test(
    readFileSync(join(targetPath, ini), 'utf8'),
  );

  return enabled
    ? []
    : [
        `${SPECIAL_FEATURES_DAT} was written but ${ini} does not enable the loader ` +
          '([SPECIAL] Enable model special feature loader = 1) — the real game will ignore every mapping',
      ];
}

/** The carrier a model's declaration collapses onto, plus what the install log must say about the choice. */
function resolveLine(
  model: string,
  declared: readonly string[],
): { carrier: null | string; warnings: readonly string[] } {
  const carrier = saCarrierFor(declared);
  const native = saAbilitiesOf(model);
  if (carrier === null) {
    return {
      carrier: null,
      warnings: [
        `${model}: declares ${declared.join(' ')} — no token of the feature vocabulary, so the sa build maps ` +
          'nothing (the declaration is carried into vehicle-features.txt and ignored)',
      ],
    };
  }
  const warnings: string[] = [];
  if (carrier.dropped.length > 0) {
    warnings.push(
      `${model}: no stock model carries ${declared.join(' ')} at once — mapped to ${carrier.model} for ` +
        `${carrier.covers.join(' ')}, dropping ${carrier.dropped.join(' ')} (the sa target can point a model at ` +
        'ONE standard model)',
    );
  }
  // The slot already carries what it declares — hotknife declaring ADV_HYDRALICs, or bandito, which carries the
  // same ability under another name. A line would remap a model onto its own abilities: nothing to do, silently.
  if (carrier.model === model || carrier.covers.every((token) => native.includes(token))) {
    return { carrier: null, warnings };
  }

  const lost = native.filter((token) => !carrier.covers.includes(token));
  if (lost.length > 0) {
    warnings.push(
      `${model}: the slot natively carries ${lost.join(' ')} and does not declare it — pointing it at ` +
        `${carrier.model} REPLACES the slot's abilities, so that is lost; declare it too if the model has it`,
    );
  }

  return { carrier: carrier.model, warnings };
}

/** Our block's `<model> <carrier>` pairs, and every other line of the file exactly as it stands. */
function splitOurBlock(text: string): { block: [string, string][]; foreign: string[] } {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimStart().startsWith(BLOCK_START));
  if (start === -1) {
    return { block: [], foreign: trimTrailingBlanks(lines) };
  }
  // An unterminated block (hand-edited, or written before the end marker existed) runs to the end of file:
  // guessing where it stops would silently adopt the adjuster's own lines.
  const endOffset = lines.slice(start).findIndex((line) => line.trimStart().startsWith(BLOCK_END));
  const end = endOffset === -1 ? lines.length : start + endOffset + 1;

  return {
    block: activePairs(lines.slice(start, end)),
    foreign: trimTrailingBlanks([...lines.slice(0, start), ...lines.slice(end)]),
  };
}

/** Drop the blank tail so a re-run adds no line: the adjuster's own file ends without a newline. */
function trimTrailingBlanks(lines: readonly string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1].trim() === '') {
    out.pop();
  }

  return out;
}
