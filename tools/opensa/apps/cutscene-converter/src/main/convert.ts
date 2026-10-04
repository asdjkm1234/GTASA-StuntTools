/**
 * Running the conversion. It happens in a CHILD process, not in Electron's main: the tool is synchronous
 * and would freeze the window for the whole run, and a crash in it must not take the app with it.
 *
 * The two flags are not options. `--no-base-copy` is why the output is 600 MB instead of 2 GB, and
 * `--self-contained-txd` is the only correct mode for a game whose mod TXDs are not installed — a choice
 * with exactly one right answer is not a choice (plan 001).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';

import type { ConvertLine, ConvertRequest, ConvertResult } from '../shared/ipc';

let running: ChildProcess | undefined;

export function convert(request: ConvertRequest, onLine: (line: ConvertLine) => void): Promise<ConvertResult> {
  if (running) {
    return Promise.reject(new Error('a conversion is already running'));
  }

  const args = convertArgs(request, childScript());

  const startedAt = Date.now();

  return new Promise<ConvertResult>((resolve, reject) => {
    // ELECTRON_RUN_AS_NODE turns our own binary into a plain Node — a packaged app has no `node` to call.
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    running = child;
    pipeLines(child, onLine);

    child.on('error', (error) => {
      running = undefined;
      reject(error);
    });

    child.on('close', (code) => {
      running = undefined;
      resolve({ code: code ?? 1, ms: Date.now() - startedAt, outPath: request.outPath });
    });
  });
}

/**
 * The argv the child is run with — the ONE thing a facade can get wrong while looking like it works, so it
 * is a plain function with a test rather than an inline array. Both flags are mandatory, not options.
 */
export function convertArgs(request: ConvertRequest, script: string): string[] {
  return [
    script,
    '--game',
    request.gamePath,
    '--in',
    request.carsPath,
    '--out',
    request.outPath,
    '--no-base-copy',
    '--self-contained-txd',
  ];
}

function childScript(): string {
  return join(__dirname, 'convert-child.cjs');
}

function pipeLines(child: ChildProcess, onLine: (line: ConvertLine) => void): void {
  for (const stream of ['stdout', 'stderr'] as const) {
    let carry = '';

    child[stream]?.on('data', (chunk: Buffer) => {
      const parts = (carry + chunk.toString('utf8')).split('\n');
      carry = parts.pop() ?? '';

      for (const text of parts) {
        onLine({ stream, text });
      }
    });

    child[stream]?.on('end', () => {
      if (carry.length > 0) {
        onLine({ stream, text: carry });
      }
    });
  }
}
