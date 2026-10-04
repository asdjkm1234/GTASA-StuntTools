import { isAbsolute, resolve } from 'node:path';

/**
 * Tiny shared CLI-argument helpers for the offline tools (deduped from per-tool copies). Convention across the
 * toolbox: `--flag value` pairs read with {@link argValue}, presence flags via `process.argv.includes`, and
 * every path argument resolved against the invocation cwd with {@link fromCwd}.
 */

/** The value following `--flag`, or undefined when the flag is absent (or is the last token). */
export function argValue(flag: string, argv: readonly string[] = process.argv): string | undefined {
  const index = argv.indexOf(flag);

  return index >= 0 ? argv[index + 1] : undefined;
}

/** Resolve a CLI path argument against the current working directory (absolute paths pass through). */
export function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}
