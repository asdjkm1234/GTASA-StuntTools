/** Compare throttle-step envelopes in a local v9 CSV/WAV with the replay's deterministic synthesized audio.
 * Prints numbers only; never copies game audio into the repository or evidence. Run from tools/opensa:
 *   npx tsx scripts/analyze-flight-audio.mts "../../GTA San Andreas/flight_recordings/<name>.csv"
 * Append `map-pak --layers` to inspect each engine layer's steady-level range.
 * Append `map-pak --texture [--texture-from=1 --texture-to=4]` to inspect 48 kHz spectrum and short transients without saving audio.
 * Append `map-pak --metadata` to inspect the local GENRL source loop metadata and seam diagnostics (numbers only).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import type { AudioBankManifest } from '../apps/web/src/flight/audio-engine';
import type { OfflineSample, OfflineSampleBank } from '../apps/web/src/flight/audio-offline';
import type { FlightTrack } from '../apps/web/src/flight/csv';

import { coreManifestFromPak, decodePcmWavSample } from '../apps/web/src/flight/audio-sample-bank';
import { buildAudioTimeline } from '../apps/web/src/flight/audio-engine';
import { renderOfflineWav } from '../apps/web/src/flight/audio-offline';
import { parseFlightCsv } from '../apps/web/src/flight/csv';
import {
  decodeGenrlSample,
  genrlBanks,
  genrlPackageIndex,
  genrlPackageNames,
  GENRL_SAMPLE_SPECS,
  makeSeamlessLoop,
} from './lib/genrl';

const SAMPLE_RATE = 8000;
const WINDOW_S = 0.05;
const EPSILON = 1e-8;

interface Envelope {
  readonly bands: readonly Float64Array[];
  readonly clipping: number;
  readonly duration: number;
}

interface Step {
  readonly control: 'plane-power-proxy' | 'throttle';
  readonly from: number;
  readonly kind: 'on' | 'off';
  readonly rowIndex: number;
  readonly s: number;
  readonly to: number;
}

function readPcmWav(bytes: Uint8Array): { channels: number; frames: number; offset: number; rate: number } {
  if (
    bytes.length < 44 ||
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') !== 'RIFF' ||
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') !== 'WAVE'
  )
    throw new Error('expected RIFF/WAVE');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let channels = 0;
  let rate = 0;
  let offset = -1;
  let frames = 0;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const tag = Buffer.from(bytes.subarray(at, at + 4)).toString('ascii');
    const size = view.getUint32(at + 4, true);
    const next = at + 8;
    if (next + size > bytes.length) throw new Error('truncated WAV chunk');
    if (tag === 'fmt ') {
      if (size < 16) throw new Error('truncated WAV fmt chunk');
      if (view.getUint16(next, true) !== 1 || view.getUint16(next + 14, true) !== 16) {
        throw new Error('expected PCM16 WAV');
      }
      channels = view.getUint16(next + 2, true);
      rate = view.getUint32(next + 4, true);
    }
    if (tag === 'data') {
      offset = next;
      frames = size;
    }
    at = next + size + (size % 2);
  }
  if (channels < 1 || rate < 1 || offset < 0 || frames % (channels * 2) !== 0) throw new Error('invalid WAV layout');
  return { channels, frames: frames / (channels * 2), offset, rate };
}

function monoAt(view: DataView, index: number, layout: ReturnType<typeof readPcmWav>): number {
  let value = 0;
  for (let ch = 0; ch < layout.channels; ch++)
    value += view.getInt16(layout.offset + index * layout.channels * 2 + ch * 2, true);
  return value / (32768 * layout.channels);
}

function readMonoAt8k(bytes: Uint8Array): { clipping: number; mono: Float32Array } {
  const layout = readPcmWav(bytes);
  if (layout.rate !== 48000 && layout.rate !== SAMPLE_RATE) throw new Error(`unsupported WAV rate ${layout.rate}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ratio = layout.rate / SAMPLE_RATE;
  const mono = new Float32Array(Math.floor(layout.frames / ratio));
  let clipped = 0;
  for (let index = 0; index < mono.length; index++) {
    let value = 0;
    for (let j = 0; j < ratio; j++) {
      const sample = monoAt(view, index * ratio + j, layout);
      value += sample;
      if (Math.abs(sample) >= 0.999) clipped++;
    }
    mono[index] = value / ratio;
  }
  return { clipping: clipped / layout.frames, mono };
}

function envelope(mono: Float32Array, clipping: number): Envelope {
  const block = Math.round(SAMPLE_RATE * WINDOW_S);
  const sums = Array.from({ length: 3 }, () => new Float64Array(Math.ceil(mono.length / block)));
  let low = 0;
  let mid = 0;
  const alphaLow = 1 - Math.exp((-2 * Math.PI * 400) / SAMPLE_RATE);
  const alphaMid = 1 - Math.exp((-2 * Math.PI * 1500) / SAMPLE_RATE);
  for (let i = 0; i < mono.length; i++) {
    const sample = mono[i];
    low += alphaLow * (sample - low);
    mid += alphaMid * (sample - mid);
    const bin = Math.floor(i / block);
    sums[0][bin] += sample * sample;
    sums[1][bin] += (mid - low) ** 2;
    sums[2][bin] += (sample - mid) ** 2;
  }
  for (const band of sums) {
    for (let bin = 0; bin < band.length; bin++) {
      band[bin] = Math.sqrt(band[bin] / Math.min(block, mono.length - bin * block));
    }
  }
  return { bands: sums, clipping, duration: mono.length / SAMPLE_RATE };
}

function detectSteps(track: FlightTrack): Step[] {
  const candidates: Step[] = [];
  const rows = track.rows;
  const useBrake = rows.every((row) => Math.abs(row.throttle) < 0.05);
  const control = useBrake ? 'plane-power-proxy' : 'throttle';
  for (let i = 3; i < rows.length - 3; i++) {
    const from = useBrake ? 1 - rows[i - 2].brake : rows[i - 2].throttle;
    const to = useBrake ? 1 - rows[i + 2].brake : rows[i + 2].throttle;
    if (Math.abs(to - from) < 0.45 || rows[i].s < 0.65 || rows[i].s + 0.6 > track.duration) continue;
    candidates.push({ control, from, kind: to > from ? 'on' : 'off', rowIndex: i, s: rows[i].s, to });
  }
  const result: Step[] = [];
  for (const candidate of candidates) {
    const last = result[result.length - 1];
    if (last && candidate.s - last.s < 0.55) {
      if (Math.abs(candidate.to - candidate.from) > Math.abs(last.to - last.from))
        result[result.length - 1] = candidate;
    } else result.push(candidate);
  }
  return result;
}

function bandDb(audio: Envelope, band: number, start: number, end: number): number {
  const values = audio.bands[band];
  const from = Math.max(0, Math.ceil(start / WINDOW_S));
  const to = Math.min(values.length, Math.floor(end / WINDOW_S));
  let power = 0;
  for (let i = from; i < to; i++) power += values[i] ** 2;
  return 20 * Math.log10(Math.sqrt(power / Math.max(1, to - from)) + EPSILON);
}

function differences(audio: Envelope, step: Step): number[][] {
  const before = [step.s - 0.45, step.s - 0.1] as const;
  const after = [
    [step.s + 0.05, step.s + 0.2],
    [step.s + 0.2, step.s + 0.45],
  ] as const;
  return audio.bands.map((_, band) =>
    after.map(([start, end]) =>
      Number((bandDb(audio, band, start, end) - bandDb(audio, band, before[0], before[1])).toFixed(2)),
    ),
  );
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function steadyLevel(audio: Envelope, from: number, to: number): { range90Db: number; stdDb: number } {
  const values = audio.bands[0].slice(Math.ceil(from / WINDOW_S), Math.floor(to / WINDOW_S));
  const db = [...values].map((value) => 20 * Math.log10(value + EPSILON)).sort((a, b) => a - b);
  const mean = db.reduce((sum, value) => sum + value, 0) / db.length;
  return {
    range90Db: Number((db[Math.floor(db.length * 0.95)] - db[Math.floor(db.length * 0.05)]).toFixed(2)),
    stdDb: Number(Math.sqrt(db.reduce((sum, value) => sum + (value - mean) ** 2, 0) / db.length).toFixed(2)),
  };
}

function textureMetrics(bytes: Uint8Array, from: number, to: number): object {
  const layout = readPcmWav(bytes);
  if (layout.rate !== 48000) throw new Error('texture comparison requires 48 kHz WAV');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.floor(from * layout.rate);
  const end = Math.min(layout.frames, Math.floor(to * layout.rate));
  const cutoffs = [400, 1500, 4000, 8000, 16000];
  const alpha = cutoffs.map((cutoff) => 1 - Math.exp((-2 * Math.PI * cutoff) / layout.rate));
  const lowpass = cutoffs.map(() => 0);
  const powers = Array.from({ length: cutoffs.length + 1 }, () => 0);
  const blockSize = layout.rate / 200;
  const blockPowers: number[] = [];
  let blockPower = 0;
  let peak = 0;
  let clipping = 0;
  let previous = start > 0 ? monoAt(view, start - 1, layout) : 0;
  let maxDifference = 0;
  for (let index = start; index < end; index++) {
    const sample = monoAt(view, index, layout);
    peak = Math.max(peak, Math.abs(sample));
    if (Math.abs(sample) >= 0.999) clipping++;
    maxDifference = Math.max(maxDifference, Math.abs(sample - previous));
    previous = sample;
    for (let band = 0; band < lowpass.length; band++) lowpass[band] += alpha[band] * (sample - lowpass[band]);
    const values = [
      lowpass[0],
      lowpass[1] - lowpass[0],
      lowpass[2] - lowpass[1],
      lowpass[3] - lowpass[2],
      lowpass[4] - lowpass[3],
      sample - lowpass[4],
    ];
    for (let band = 0; band < values.length; band++) powers[band] += values[band] ** 2;
    blockPower += sample * sample;
    if ((index - start + 1) % blockSize === 0) {
      blockPowers.push(blockPower / blockSize);
      blockPower = 0;
    }
  }
  const count = Math.max(1, end - start);
  const bandDb = powers.map((power) => 10 * Math.log10(power / count + EPSILON ** 2));
  const shortDb = blockPowers.map((power) => 10 * Math.log10(power + EPSILON ** 2));
  const jumps = shortDb.slice(1).map((value, index) => Math.abs(value - shortDb[index]));
  const topJumps = jumps
    .map((db, index) => ({ db, s: from + (index + 1) / 200 }))
    .sort((a, b) => b.db - a.db)
    .slice(0, 6)
    .map(({ db, s }) => ({ db: Number(db.toFixed(2)), s: Number(s.toFixed(3)) }));
  return {
    bandsDb: bandDb.map((value) => Number(value.toFixed(2))),
    clipFraction: Number((clipping / count).toFixed(6)),
    maxAdjacent5msDb: Number(Math.max(...jumps).toFixed(2)),
    maxDifference: Number(maxDifference.toFixed(3)),
    peak: Number(peak.toFixed(3)),
    relativeAbove4kDb: Number(
      (10 * Math.log10((powers[3] + powers[4] + powers[5]) / (powers[1] + EPSILON))).toFixed(2),
    ),
    topJumps,
  };
}

function createBank(pak: string, manifest: AudioBankManifest): OfflineSampleBank {
  const samples = new Map<string, OfflineSample>();
  for (const sample of manifest.samples) {
    samples.set(
      sample.file,
      decodePcmWavSample(readFileSync(join(pak, 'audio', sample.file)), {
        loop: sample.category.startsWith('engine '),
        loopStartFrame: sample.loopStartFrame,
      }),
    );
  }
  return { get: (file) => samples.get(file) ?? null };
}

const csv = process.argv[2];
if (!csv) throw new Error('usage: npx tsx scripts/analyze-flight-audio.mts <recording.csv> [pak directory]');
const csvPath = resolve(csv);
const wavPath = join(dirname(csvPath), `${basename(csvPath, '.csv')}.wav`);
const pak = resolve(process.argv[3] ?? 'map-pak');
const track = parseFlightCsv(readFileSync(csvPath, 'utf8'), basename(csvPath));
if (track.version < 9) throw new Error('use a v9 recording with QPC-aligned capture_elapsed_s');
const steps = detectSteps(track);
const originalPcm = readMonoAt8k(readFileSync(wavPath));
const original = envelope(originalPcm.mono, originalPcm.clipping);
const manifest = coreManifestFromPak(JSON.parse(readFileSync(join(pak, 'audio', 'manifest.json'), 'utf8')));
if (manifest.version < 8) throw new Error('re-bake the audio pak before comparing');
const bank = createBank(pak, manifest);
const synthWavPath = process.argv.find((arg) => arg.startsWith('--write-synth='))?.slice('--write-synth='.length);
if (synthWavPath) {
  // Only a synthetic render is written. The game's process WAV stays read-only and outside the repository.
  writeFileSync(
    resolve(synthWavPath),
    renderOfflineWav(track, manifest, bank, { duration: track.duration, reverb: false, sampleRate: 48000 }).wav,
  );
}
const layerWavDirectory = process.argv
  .find((arg) => arg.startsWith('--write-layers='))
  ?.slice('--write-layers='.length);
if (layerWavDirectory) {
  const output = resolve(layerWavDirectory);
  mkdirSync(output, { recursive: true });
  const roles = new Set(
    manifest.samples.filter((sample) => sample.model === track.model).map((sample) => sample.layer),
  );
  for (const role of roles) {
    const isolated: AudioBankManifest = {
      ...manifest,
      samples: manifest.samples.filter((sample) => sample.model !== track.model || sample.layer === role),
    };
    writeFileSync(
      join(output, `${track.model}-${role}.wav`),
      renderOfflineWav(track, isolated, bank, {
        duration: Math.min(track.duration, 16),
        reverb: false,
        sampleRate: 48000,
      }).wav,
    );
  }
}
const sourceLoopMetadata = process.argv.includes('--metadata')
  ? (() => {
      const root = resolve(dirname(csvPath), '..', 'audio');
      const config = (name: string): Uint8Array => readFileSync(join(root, 'CONFIG', name));
      const packages = genrlPackageNames(config('PakFiles.dat'));
      const banks = genrlBanks(config('BankLkup.dat'), genrlPackageIndex(packages), packages.length);
      const genrl = readFileSync(join(root, 'SFX', 'GENRL'));
      return GENRL_SAMPLE_SPECS.filter((sample) => sample.model === track.model && sample.rate === 1).map((sample) => {
        const decoded = decodeGenrlSample(genrl, banks.get(sample.globalBankId)!, sample);
        const pcm = new DataView(decoded.pcm.buffer, decoded.pcm.byteOffset, decoded.pcm.byteLength);
        const first = pcm.getInt16(0, true);
        const last = pcm.getInt16(decoded.pcm.byteLength - 2, true);
        const joins =
          sample.model === 520 && (sample.layer === 'front' || sample.layer === 'rear')
            ? [0, 0.001, 0.002, 0.005, 0.02].map((seconds) => {
                const bytes = makeSeamlessLoop(
                  decoded.pcm,
                  Math.round(seconds * decoded.sound.sampleRateHz),
                  'equal-power',
                );
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                const count = bytes.byteLength / 2;
                let maxDerivative = 0;
                let previous = view.getInt16((count - 1) * 2, true);
                for (let frame = 0; frame < count; frame++) {
                  const value = view.getInt16(frame * 2, true);
                  maxDerivative = Math.max(maxDerivative, Math.abs(value - previous));
                  previous = value;
                }
                return {
                  seconds,
                  duration: count / decoded.sound.sampleRateHz,
                  maxDerivative,
                  seamDelta: Math.abs(view.getInt16(0, true) - view.getInt16((count - 1) * 2, true)),
                };
              })
            : null;
        return {
          role: sample.layer,
          sound: decoded.sound,
          duration: decoded.pcm.byteLength / 2 / decoded.sound.sampleRateHz,
          first,
          last,
          seamJump: first - last,
          joins,
        };
      });
    })()
  : null;
const timeline = buildAudioTimeline(track, manifest);
const synth = renderOfflineWav(track, manifest, bank, {
  duration: track.duration,
  reverb: false,
  sampleRate: SAMPLE_RATE,
});
const synthesizedPcm = readMonoAt8k(synth.wav).mono;
const synthesized = envelope(synthesizedPcm, synth.clipped ? 1 : 0);
const layerSteady5to10 = process.argv.includes('--layers')
  ? Object.fromEntries(
      [...new Set(manifest.samples.filter((sample) => sample.model === track.model).map((sample) => sample.layer))].map(
        (role) => {
          const onlyLayer: AudioBankManifest = {
            ...manifest,
            samples: manifest.samples.filter((sample) => sample.model !== track.model || sample.layer === role),
          };
          const rendered = renderOfflineWav(track, onlyLayer, bank, {
            duration: track.duration,
            reverb: false,
            sampleRate: SAMPLE_RATE,
          });
          return [role, steadyLevel(envelope(readMonoAt8k(rendered.wav).mono, 0), 5, 10)];
        },
      ),
    )
  : null;
const textureFrom = Number(process.argv.find((arg) => arg.startsWith('--texture-from='))?.split('=')[1] ?? 5);
const textureTo = Number(process.argv.find((arg) => arg.startsWith('--texture-to='))?.split('=')[1] ?? 10);
if (!Number.isFinite(textureFrom) || !Number.isFinite(textureTo) || textureFrom < 0 || textureTo <= textureFrom)
  throw new Error('invalid --texture-from/--texture-to interval');
const textureInterval = process.argv.includes('--texture')
  ? (() => {
      const render = (audioManifest: AudioBankManifest): Uint8Array =>
        renderOfflineWav(track, audioManifest, bank, {
          duration: Math.ceil(textureTo + 1),
          reverb: false,
          sampleRate: 48000,
        }).wav;
      const roles = [
        ...new Set(manifest.samples.filter((sample) => sample.model === track.model).map((sample) => sample.layer)),
      ];
      return {
        from: textureFrom,
        to: textureTo,
        original: textureMetrics(readFileSync(wavPath), textureFrom, textureTo),
        synth: textureMetrics(render(manifest), textureFrom, textureTo),
        layers: Object.fromEntries(
          roles.map((role) => [
            role,
            textureMetrics(
              render({
                ...manifest,
                samples: manifest.samples.filter((sample) => sample.model !== track.model || sample.layer === role),
              }),
              textureFrom,
              textureTo,
            ),
          ]),
        ),
      };
    })()
  : null;
const valid = steps.filter((step) => step.s + 0.5 < original.duration && step.s + 0.5 < synthesized.duration);
const rows = valid.map((step) => ({
  context: {
    altitude: Number(track.rows[step.rowIndex].pos[2].toFixed(1)),
    health: track.rows[step.rowIndex].health,
    speedMps: Number(
      (
        Math.hypot(
          ...track.rows[step.rowIndex].pos.map(
            (value, axis) => value - track.rows[Math.max(0, step.rowIndex - 2)].pos[axis],
          ),
        ) / Math.max(0.001, step.s - track.rows[Math.max(0, step.rowIndex - 2)].s)
      ).toFixed(1),
    ),
  },
  control: step.control,
  kind: step.kind,
  original: differences(original, step),
  s: Number(step.s.toFixed(3)),
  synth: differences(synthesized, step),
  values: [step.from, step.to],
}));
// A quiet dropout in the before window can make S look like a large positive response. Keep it visible
// in steps/stallInspection, but do not count it as an ordinary control transition in the summary.
const stallStep = rows.find((row) => row.values[1] === 0 && row.context.speedMps < 25 && row.original[0][1] > 3);
const summary = ['on', 'off'].map((kind) => {
  const selected = rows.filter((row) => row.kind === kind && row !== stallStep);
  return {
    count: selected.length,
    excludedDropoutWindow: rows.some((row) => row.kind === kind && row === stallStep),
    kind,
    original: [0, 1, 2].map((band) => median(selected.map((row) => row.original[band][1]))),
    synth: [0, 1, 2].map((band) => median(selected.map((row) => row.synth[band][1]))),
  };
});
function dropoutIntervals(mono: Float32Array, from: number, to: number, thresholdDb: number): number[][] {
  const block = SAMPLE_RATE / 100;
  const intervals: number[][] = [];
  let active: number | null = null;
  let deepest = 0;
  for (let i = Math.floor(from * 100); i <= Math.floor(to * 100); i++) {
    let power = 0;
    for (let j = i * block; j < (i + 1) * block; j++) power += (mono[j] ?? 0) ** 2;
    const db = 20 * Math.log10(Math.sqrt(power / block) + EPSILON);
    if (db < thresholdDb) {
      if (active === null) active = i;
      deepest = Math.min(db, deepest || db);
    } else if (active !== null) {
      if (i - active >= 2) intervals.push([active / 100, i / 100, Number(deepest.toFixed(1))]);
      active = null;
      deepest = 0;
    }
  }
  return intervals;
}
const stallInspection = stallStep
  ? {
      s: stallStep.s,
      quietIntervals: dropoutIntervals(originalPcm.mono, stallStep.s - 1, stallStep.s + 2, -23),
      windows: Array.from({ length: 27 }, (_, index) => {
        const t = stallStep.s - 0.7 + index * 0.1;
        const row = track.rows.findIndex((sample) => sample.s >= t);
        const before = track.rows[Math.max(0, row - 1)];
        const after = track.rows[Math.min(track.rows.length - 1, Math.max(1, row))];
        const speed =
          Math.hypot(...after.pos.map((value, axis) => value - before.pos[axis])) / Math.max(0.001, after.s - before.s);
        return {
          t: Number(t.toFixed(2)),
          original: Number(bandDb(original, 0, t, t + 0.1).toFixed(1)),
          synth: Number(bandDb(synthesized, 0, t, t + 0.1).toFixed(1)),
          speed: Number(speed.toFixed(1)),
          power: 1 - after.brake,
        };
      }),
    }
  : null;
console.log(
  JSON.stringify(
    {
      model: track.model,
      csv: basename(csvPath),
      samples: track.rows.length,
      duration: track.duration,
      controls: Object.fromEntries(
        ['throttle', 'brake', 'keyUp', 'keyDown', 'engineLoadInferred', 'transmissionGearInferred'].map((key) => [
          key,
          [...new Set(track.rows.map((row) => row[key as keyof typeof row]))]
            .sort((a, b) => Number(a) - Number(b))
            .slice(0, 30),
        ]),
      ),
      originalDuration: original.duration,
      note: 'QPC aligned; bands: broadband / 400-1500Hz / above 1500Hz (8k downsample); mixed game WAV vs source-position replay approximation, relative dB only',
      originalClipping: original.clipping,
      synthClipping: synthesized.clipping,
      steadyPower5to10: { original: steadyLevel(original, 5, 10), synth: steadyLevel(synthesized, 5, 10) },
      layerSteady5to10,
      textureInterval,
      sourceLoopMetadata,
      pitch5to10: [5, 6, 7, 8, 9, 10].map((s) => Number((timeline.frameAt(s).engine?.pitch ?? 0).toFixed(3))),
      steps: rows,
      summary,
      stallInspection,
    },
    null,
    2,
  ),
);
