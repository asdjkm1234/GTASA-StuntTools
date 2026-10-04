import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Finding a pak, and — when there is none where the caller looked — SAYING so.
 *
 * The inspectors used to hand the path straight to `readFileSync`, which on a missing pak prints a Node
 * stack trace over `manifest.json`. On a phone that is a wall of text that answers nothing: the reader's
 * actual question is "which paks do I have, then", and the answer is one directory listing away.
 */

/** The pak layouts a build can have, newest first (plan 086 phase 8 put it at `<game>/opensa/pak`). */
const LAYOUTS = ['pak', 'opensa/pak', 'opensa-pack', 'opensa/opensa'];

/** Every pak under `build/` — what an error message should offer instead of a stack. */
export function findPaks(root = 'build'): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    for (const layout of LAYOUTS) {
      const dir = join(root, entry.name, layout);
      if (existsSync(join(dir, 'manifest.json'))) {
        found.push(dir);
      }
    }
    // A pak passed as the game dir itself (`--out` of a standalone opensa-pack run).
    if (existsSync(join(root, entry.name, 'manifest.json'))) {
      found.push(join(root, entry.name));
    }
  }

  return found;
}

/**
 * Read a pak's manifest, or exit with a message a person can act on: what was looked for, and every pak
 * that does exist. Typed loosely on purpose — each caller knows which fields it needs.
 */
export function readPakManifest<T>(pakDir: string): T {
  const path = join(pakDir, 'manifest.json');
  if (!existsSync(path)) {
    const paks = findPaks();
    console.error(`no pak at ${path}`);
    console.error(
      paks.length > 0
        ? `paks that DO exist:\n  ${paks.join('\n  ')}`
        : 'no pak under build/ at all — convert one first (npm run phone, or opensa-pack --game … --out …)',
    );
    process.exit(1);
  }

  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
