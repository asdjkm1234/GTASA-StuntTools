import { fetchPack } from './fetch-pack';

/**
 * CLI for the plan-086 finishing tool: pmb build → fetch chunks.
 * Run: `npx tsx tools/fetch-pack/src/cli.ts [--build ./build/original] [--out <root>]`
 * (`--out` default: `<build>/opensa-pack` — the fetch build beside the game build; use
 * `--out ./static/games` to stage a local fetch-mode test).
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

fetchPack({
  buildDir: arg('build') ?? './build/original',
  ...(arg('out') ? { outRoot: arg('out') } : {}),
});
