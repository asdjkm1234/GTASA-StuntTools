/**
 * CLI for the CLEO authoring SDK build: `npm run build:cleo-scripts`
 * (= `npx tsx cleo/sdk/src/cli.ts`). Compiles every script under `cleo/scripts/` to
 * `cleo/sdk/dist/` — the artifact name carries the script's target (`docs/contracts/mods.md`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScriptDefinition } from './dsl/script';

import { compileScript, discoverScriptDirs, SCRIPT_ENTRY } from './build';

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const scriptsRoot = path.resolve(here, '../../scripts');
  const distDir = path.resolve(here, '../dist');

  const names = discoverScriptDirs(scriptsRoot);
  console.log(`[cleo-sdk] ${names.length} script(s) discovered${names.length > 0 ? `: ${names.join(', ')}` : ''}`);

  for (const name of names) {
    const module = (await import(path.join(scriptsRoot, name, SCRIPT_ENTRY))) as { script?: ScriptDefinition };
    if (!module.script) {
      throw new Error(`[cleo-sdk] ${name}/${SCRIPT_ENTRY} must export "script" (a ScriptDefinition)`);
    }
    const compiled = compileScript(module.script);
    for (const warning of compiled.warnings) {
      console.warn(`[cleo-sdk] ${name}: WARNING ${warning}`);
    }
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, compiled.artifact), compiled.bytes);
    console.log(`[cleo-sdk] ${compiled.artifact}: ${compiled.bytes.length} bytes`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
