import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Per-model crease-angle overrides (plan 023A): lowercased model name → degrees. The curated default
 * lives in `data/crease-overrides.json`; the curation loop is field report → add entry → rebuild →
 * eyeball. Loaded HERE (not in the CLI) so every entry point gets it — plan 024 phase 5 found the pmb
 * pipeline never passed overrides at all, making `--crease`-style curation unreachable in real builds.
 */

const DEFAULT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'crease-overrides.json');

/** Parse a crease-override JSON (the curated default when no path is given). `_`-keys are comments. */
export function loadCreaseOverrides(path: string = DEFAULT_PATH): ReadonlyMap<string, number> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const overrides = new Map<string, number>();
  for (const [model, degrees] of Object.entries(raw)) {
    if (model.startsWith('_')) {
      continue; // comment keys
    }
    if (typeof degrees !== 'number' || !Number.isFinite(degrees) || degrees <= 0 || degrees >= 180) {
      throw new Error(`crease override '${model}' must be an angle in (0, 180) degrees, got ${String(degrees)}`);
    }
    overrides.set(model.toLowerCase(), degrees);
  }

  return overrides.size > 0 ? overrides : undefined;
}
