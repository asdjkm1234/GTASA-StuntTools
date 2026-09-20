/**
 * The plugin the converted fleet REQUIRES, embedded at build time.
 *
 * `asi/perfect-cutscene/dist/` is gitignored — the binary is cross-compiled locally with mingw — so the app
 * can be built on a tree that does not carry it. It must never ship without it: an app that quietly produces
 * a fleet with no plugin produces cutscenes that lose their actors behind car glass, and the user has no way
 * to know which half is missing. So the build FAILS, and says how to produce the file.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const APP_DIR = dirname(import.meta.dirname);
const REPO_ROOT = dirname(dirname(APP_DIR));

export const ASI_NAME = 'perfect-cutscene.asi';
export const ASI_SOURCE = join(REPO_ROOT, 'asi/perfect-cutscene/dist', ASI_NAME);

const HOW_TO_BUILD = `Build it first:\n  cd asi/perfect-cutscene && npm run build:asi\n(needs the mingw-w64 cross toolchain; see asi/perfect-cutscene/README.md)`;

export interface AsiResource {
  readonly bytes: number;
  readonly path: string;
  /** Lowercase 40-hex SHA1, shown in the app's about screen so a bug report names the plugin inside. */
  readonly sha1: string;
}

/** The resource, or `undefined` when the binary has not been built. */
export function readAsi(source: string = ASI_SOURCE): AsiResource | undefined {
  try {
    const contents = readFileSync(source);

    return {
      bytes: statSync(source).size,
      path: source,
      sha1: createHash('sha1').update(contents).digest('hex'),
    };
  } catch {
    return undefined;
  }
}

/** The resource, or a build failure naming the command that produces it. */
export function requireAsi(source: string = ASI_SOURCE): AsiResource {
  const asi = readAsi(source);

  if (!asi) {
    throw new Error(`cutscene-converter: ${ASI_NAME} is missing at ${source}.\n${HOW_TO_BUILD}`);
  }

  return asi;
}
