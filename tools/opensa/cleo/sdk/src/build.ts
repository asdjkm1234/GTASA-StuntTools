/**
 * The SDK build pipeline (plans cleo-sdk/001+004): discover authored script folders under
 * `cleo/scripts/`, run each definition through build IR → whitelist gate → assemble →
 * decode-verify, and hand back the artifact. Deterministic: identical sources, identical bytes.
 */
import { decodeScript, disassemble } from '@opensa/cleo';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { ScriptDefinition } from './dsl/script';

import { assembleScript } from './assemble/assemble';
import { buildScript } from './dsl/script';
import { artifactName, checkWhitelist } from './whitelist/gate';

/** The file that makes a `cleo/scripts/` folder a script source (the DSL entry, plan 004). */
export const SCRIPT_ENTRY = 'script.ts';

export interface CompiledScript {
  /** The contract-carrying filename: `<name>.cs`, `<name>.opensa-only.cs` or `<name>.sa-only.cs`. */
  readonly artifact: string;
  readonly bytes: Uint8Array;
  /** The disasm listing of the emitted bytes — the human review surface (snapshot in tests). */
  readonly listing: string;
  readonly warnings: readonly string[];
}

/** Definition → verified artifact: IR, gate, assemble, then decode our own bytes back as proof. */
export function compileScript(definition: ScriptDefinition): CompiledScript {
  const built = buildScript(definition);
  checkWhitelist(built.instructions, built.target);
  const bytes = assembleScript(built.instructions);
  const listing = disassemble(decodeScript(bytes));

  return {
    artifact: artifactName(definition.name, built.target),
    bytes,
    listing,
    warnings: built.warnings,
  };
}

/** Script source folders under the scripts home: every directory carrying a `script.ts`, sorted. */
export function discoverScriptDirs(scriptsRoot: string): readonly string[] {
  if (!existsSync(scriptsRoot)) {
    throw new Error(`scripts home not found: ${scriptsRoot} (expected the repo's cleo/scripts/)`);
  }

  return readdirSync(scriptsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(scriptsRoot, entry.name, SCRIPT_ENTRY)))
    .map((entry) => entry.name)
    .sort();
}
