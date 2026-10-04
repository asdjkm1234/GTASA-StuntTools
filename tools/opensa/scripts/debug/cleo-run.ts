import { createRecordingHost, decodeScript, ScriptRunner } from '@opensa/cleo';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Headless CLEO script runner (plan 097/02 decision 3): decode + VM + the recording mock host —
 * the host-call trace per tick reads as a story ("create 14645 at …, rotate 4.8°, wait"). Asserts
 * DECISIONS, not API calls (the fake-GPU philosophy). Grows `--atlas` with plan 05 (native calls
 * resolve against a recorded atlas stub and appear in the trace).
 *
 * Run: `npx tsx scripts/debug/cleo-run.ts <file.cs> [--ticks 60] [--fps 60] [--calls 60]
 *       [--cars 257:544,513:582] [--door 0.5]`
 *
 * `--cars` populates the fake world with live vehicles (scriptHandle:modelId) — the pool walk, the
 * car finds and `GET_CAR_MODEL` all see them, which is how the class-B scripts (firela, vandoor,
 * rhino) run their whole native path headless; the trace then shows RESOLVED operations
 * ("natives.setPartRotation car#257 misc_a#0 …"), never raw addresses (plan 097/05).
 */

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const file = positional[0];
if (!file) {
  console.error('usage: cleo-run.ts <file.cs> [--ticks 60] [--fps 60] [--calls 60]');
  process.exit(1);
}
const flag = (name: string, fallback: number): number => {
  const index = args.indexOf(`--${name}`);

  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const ticks = flag('ticks', 60);
const fps = flag('fps', 60);
const callLimit = flag('calls', 60);
const carsIndex = args.indexOf('--cars');
const cars =
  carsIndex >= 0
    ? args[carsIndex + 1].split(',').map((pair) => {
        const [handle, model] = pair.split(':').map(Number);

        return { handle, model };
      })
    : [];

const host = createRecordingHost({ cars, doorAngleRatio: flag('door', 0.5) });
const runner = new ScriptRunner({ host });
const script = decodeScript(new Uint8Array(readFileSync(file)));
const thread = runner.spawn(script, basename(file, '.cs'));

let peak = 0;
const started = performance.now();
for (let frame = 0; frame < ticks; frame += 1) {
  runner.tick(1000 / fps);
  peak = Math.max(peak, runner.instructionsLastTick);
}
const elapsed = performance.now() - started;

console.log(`${file}: ${script.instructions.length} instructions decoded, ${ticks} ticks @ ${fps} fps`);
console.log(
  `thread ${thread.terminated ? 'TERMINATED' : 'alive'} · ${host.calls.length} host calls · peak ${peak} instr/tick · ${(elapsed / ticks).toFixed(3)} ms/tick`,
);
for (const fault of runner.faults) {
  console.log(`FAULT [${fault.thread}] ${fault.message}`);
}
console.log(`\n--- first ${Math.min(callLimit, host.calls.length)} host calls ---`);
for (const line of host.calls.slice(0, callLimit)) {
  console.log(`  ${line}`);
}
if (host.calls.length > callLimit) {
  const counts = new Map<string, number>();
  for (const line of host.calls) {
    const kind = line.split(' ')[0];
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  console.log(`\n--- all ${host.calls.length} calls by kind ---`);
  for (const [kind, count] of [...counts.entries()].sort(([, a], [, b]) => b - a)) {
    console.log(`  ${String(count).padStart(6)}  ${kind}`);
  }
}
