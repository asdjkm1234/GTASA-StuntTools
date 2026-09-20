import { decodeOsm, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { stepUvAnimation, type UvAnimation } from '@opensa/engine/render/uv-anim';
import { openArchive } from '@opensa/renderware/archive/img-archive';
/**
 * What a model's UV animation actually DOES when the engine plays it, and what one advance costs
 * (plan 099's owed numbers). Reads the animation out of a BUILT `.osm` and steps it through the engine's
 * own walker, so the answer describes the shipping bytes rather than the source DFF:
 *
 * - the OBSERVED cadence — how often the strip moves, against the keyframe gaps the author wrote;
 * - the per-frame cost of `stepUvAnimation` in ns, which is the whole CPU cost of one animated model
 *   (plus one 16-byte `writeBuffer` the engine issues beside it).
 *
 * The observed gaps carry ±one sampling tick: at 120 Hz an authored 0.225 s reads as 0.2167–0.2333.
 * Run: `npx tsx scripts/debug/uv-anim-measure.ts [modelName] [--pak build/original/opensa] [--hz 120]`.
 */
import { readFileSync } from 'node:fs';

interface Fixture {
  uvAnimations?: { duration: number; keyframes: { time: number; uv: number[] }[]; name: string }[];
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);

  return at === -1 ? fallback : args[at + 1];
};
const pak = flag('pak', 'build/original/opensa');
const hz = Number(flag('hz', '120'));
const model =
  args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--')) ?? 'ferriswheel_lights';

const archive = openArchive(new Uint8Array(readFileSync(`${pak}/models/gta3.img`)));
const osm = archive.get(`${model}.osm`);
if (!osm) {
  console.error(`${model}.osm is not in ${pak}/models/gta3.img`);
  process.exit(1);
}
const desc = osmSection(decodeOsm(new Uint8Array(osm)), OsmSectionTag.DESC);
if (!desc) {
  console.error('no DESC section');
  process.exit(1);
}
const authored = (JSON.parse(new TextDecoder().decode(desc)) as Fixture).uvAnimations?.[0];
if (!authored) {
  console.error(`${model} carries no uvAnimations — nothing to measure`);
  process.exit(1);
}

const animation: UvAnimation = { duration: authored.duration, keyframes: authored.keyframes };
console.log(
  `${model}: ${authored.name} · ${authored.keyframes.length} keyframes · loop ${authored.duration.toFixed(3)} s`,
);

// --- observed cadence: step the ENGINE's own walker over one loop and watch when the strip moves ---------
const out = new Float32Array(4);
const tick = 1 / hz;
const changes: number[] = [];
let previous = Number.NaN;
for (let step = 0; step * tick <= animation.duration; step += 1) {
  const seconds = step * tick;
  stepUvAnimation(animation, seconds, out);
  if (!Number.isNaN(previous) && out[0] !== previous) {
    changes.push(seconds);
  }
  previous = out[0];
}
const gaps = changes.slice(1).map((at, index) => at - changes[index]);
const authoredGaps = new Set(
  authored.keyframes
    .map((keyframe, index) => (index === 0 ? 0 : keyframe.time - authored.keyframes[index - 1].time))
    .filter((gap) => gap > 0)
    .map((gap) => gap.toFixed(3)),
);
console.log(
  gaps.length === 0
    ? 'observed: the transform never steps (a continuous scroll, or a held first keyframe)'
    : `observed: ${changes.length} steps per loop · gaps ${Math.min(...gaps).toFixed(4)}..${Math.max(...gaps).toFixed(4)} s` +
        ` (sampling tick ${tick.toFixed(5)} s)`,
);
console.log(`authored keyframe gaps: ${[...authoredGaps].join(', ')} s`);

// --- per-frame cost of the advance -----------------------------------------------------------------------
const RUNS = 2_000_000;
for (let at = 0; at < 100_000; at += 1) {
  stepUvAnimation(animation, at * tick, out); // warm
}
const started = process.hrtime.bigint();
for (let at = 0; at < RUNS; at += 1) {
  stepUvAnimation(animation, at * tick, out);
}
const nanos = Number(process.hrtime.bigint() - started) / RUNS;
console.log(`stepUvAnimation: ${nanos.toFixed(1)} ns/call over ${RUNS.toLocaleString('en-US')} calls`);
console.log('per animated model per frame: one such call + one 16-byte writeBuffer');
