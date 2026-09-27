import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

class WatcherError extends Error {}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const directory = resolve(option('--dir', '../../GTA San Andreas/flight_recordings'));
const models = option('--models', '520,476')
  .split(',')
  .map((value) => Number(value));
const timeout = Number(option('--timeout', '1800000'));
const requireCollision = process.argv.includes('--require-collision');
if (
  models.length === 0 ||
  models.some((model) => !Number.isInteger(model)) ||
  !Number.isFinite(timeout) ||
  timeout < 0
) {
  throw new WatcherError('invalid --models or --timeout argument');
}

async function candidates() {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csv'));
  const inspected = await Promise.all(
    files.map(async (entry) => {
      const file = resolve(directory, entry.name);
      const [recording, metadata] = await Promise.all([inspect(file), stat(file)]);
      return { file, metadata, recording };
    }),
  );
  return inspected.sort((left, right) => right.metadata.mtimeMs - left.metadata.mtimeMs);
}

async function inspect(file) {
  const text = await readFile(file, 'utf8');
  const version = Number(text.match(/^# gtasa_flight_recorder,.*?version=(\d+)(?:,|$)/m)?.[1] ?? '0');
  const model = Number(text.match(/^# session_start,.*,model=(\d+)(?:,|$)/m)?.[1] ?? '0');
  const collision = /^# event,[^\r\n]*,collision(?:,|$)/m.test(text);
  return { collision, model, version };
}

async function main() {
  const deadline = Date.now() + timeout;
  while (true) {
    const recordings = await candidates();
    const selected = models.map((model) =>
      recordings.find(({ recording }) => recording.version === 9 && recording.model === model),
    );
    const complete = selected.every((recording) => recording !== undefined);
    const collisionComplete = !requireCollision || selected.some((entry) => entry?.recording.collision === true);
    if (complete && collisionComplete) {
      for (const entry of selected) await validate(entry.file);
      console.log(
        `found validated v9 recordings for models ${models.join(',')}${requireCollision ? ' with collision' : ''}`,
      );
      return;
    }
    if (Date.now() >= deadline) {
      if (requireCollision) throw new WatcherError('timed out waiting for a collision-bearing recording');
      const missing = models.filter((model, index) => selected[index] === undefined);
      throw new WatcherError(`timed out waiting for a v9 recording (missing model ${missing.join('/')})`);
    }
    await new Promise((accept) => setTimeout(accept, Math.min(500, Math.max(1, deadline - Date.now()))));
  }
}

async function validate(file) {
  const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
  const validator = resolve(import.meta.dirname, 'validate-recorder-csv.mts');
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [tsxCli, validator, file], { cwd: import.meta.dirname, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? accept() : reject(new WatcherError(`validator rejected ${file}`))));
  });
}

main().catch((error) => {
  // CLI boundary
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
