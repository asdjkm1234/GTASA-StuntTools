/**
 * Cross-cutting audio acceptance tests (plan todo 20, synthetic fixtures only).
 *
 * This lane binds the three audio deliverables together and answers the acceptance questions end to end:
 * - replay audio is deterministic across runs: the cue stream the live scheduler would fire is hashed, and
 *   two fresh builds of the same recording produce the same sha256 digest;
 * - export audio is deterministic across runs: the offline PCM/WAV renderer produces byte-identical sha256;
 * - selection is stable on scrub: a seek never fires an event, replay after a seek picks exactly the same
 *   member/rate per event, and traversal order (forward or backward) cannot change a cue;
 * - no GTA sample enters git or evidence: `scripts/scan-no-assets.mjs` is executed for real and must exit 0,
 *   and a planted audio file in a throwaway root must make it exit non-zero (the scanner reads git and the
 *   directory on every run - nothing here mocks or stubs it).
 *
 * No GTA bytes are used anywhere: the manifest is metadata with `pcmBytes: 0`, and every sample in the bank
 * is a tone generated in this file. The live Web Audio renderer (`audio-engine-web.ts`) cannot run in node,
 * so its firing rule is mirrored below from `applyPlayingFrame`/`triggerEvents` (continuous steps <= 1 s;
 * events in `(lastS, s]`) - the selection it consumes comes from the same core timeline that is hashed here.
 */
/* eslint-disable no-console -- the [t20] determinism hashes are printed for the .omo/evidence capture */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { AudioBankManifest, AudioTimeline, TimelineEvent } from './audio-engine';
import type { OfflineSample, OfflineSampleBank } from './audio-offline';
import type { FlightTrack } from './csv';

import { buildAudioTimeline } from './audio-engine';
import { renderOfflineWav } from './audio-offline';
import { parseFlightCsv } from './csv';

const OPENSA_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCANNER = join(OPENSA_ROOT, 'scripts', 'scan-no-assets.mjs');
const RATE = 8000;
const DURATION = 1;
const STEP_S = 1 / 25;
/** Mirrors `MAX_CONTINUOUS_STEP_S` in `audio-engine-web.ts`: a larger jump is a seek and fires nothing. */
const MAX_CONTINUOUS_STEP_S = 1;

/** Synthetic manifest: the four cue categories the core needs, zero PCM bytes (metadata only). */
const MANIFEST: AudioBankManifest = {
  samples: [
    {
      bankName: 'SYNTH',
      category: 'engine accelerate',
      file: 'engine-accelerate.wav',
      globalBankId: 1,
      headroom: 0,
      loopStartFrame: 0,
      packageBankIndex: 1,
      pcmBytes: 0,
      sampleRateHz: RATE,
      setSoundCount: 1,
      slotId: 1,
      slotName: 'ENGINE',
      soundIndex: 0,
      wavBytes: 0,
      wavFrames: 400,
    },
    {
      bankName: 'SYNTH',
      category: 'engine decelerate',
      file: 'engine-decelerate.wav',
      globalBankId: 1,
      headroom: 0,
      loopStartFrame: 0,
      packageBankIndex: 1,
      pcmBytes: 0,
      sampleRateHz: RATE,
      setSoundCount: 1,
      slotId: 1,
      slotName: 'ENGINE',
      soundIndex: 1,
      wavBytes: 0,
      wavFrames: 400,
    },
    {
      bankName: 'SYNTH',
      category: 'collision set',
      file: 'collision-set.wav',
      globalBankId: 2,
      headroom: 0,
      loopStartFrame: 0,
      packageBankIndex: 2,
      pcmBytes: 0,
      sampleRateHz: RATE,
      setSoundCount: 4,
      slotId: 2,
      slotName: 'COLLISIONS',
      soundIndex: 0,
      wavBytes: 0,
      wavFrames: 120,
    },
    {
      bankName: 'SYNTH',
      category: 'explosion set',
      file: 'explosion-set.wav',
      globalBankId: 3,
      headroom: 0,
      loopStartFrame: 0,
      packageBankIndex: 3,
      pcmBytes: 0,
      sampleRateHz: RATE,
      setSoundCount: 3,
      slotId: 3,
      slotName: 'EXPLOSIONS',
      soundIndex: 0,
      wavBytes: 0,
      wavFrames: 160,
    },
  ],
  source: 'synthetic (no GTA bytes)',
  version: 1,
};

/** Six events with distinct strengths so every deterministic selection rule participates. */
const EVENT_LINES = [
  '# event,0.10,explosion,0,0,90',
  '# event,0.25,collision,inferred,10,0,0,90',
  '# event,0.40,explosion,0,0,90',
  '# event,0.55,collision,inferred,55,0,0,90',
  '# event,0.70,explosion,0,0,90',
  '# event,0.85,collision,inferred,25,0,0,90',
] as const;

interface FiredCue {
  readonly eventId: string;
  readonly gain: number;
  readonly kind: string;
  readonly pan: number;
  readonly playbackRate: number;
  readonly s: number;
  readonly soundIndex: number;
}

interface ScannerRun {
  readonly output: string;
  readonly status: null | number;
}

/** One `WebAudioReplay.sync()` call: the replay clock value and whether the lane is playing. */
interface SyncSample {
  readonly playing: boolean;
  readonly s: number;
}

function digest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function loopSample(hz: number): OfflineSample {
  return { frames: tone(400, hz), loop: true, loopStartFrame: 0, sampleRateHz: RATE };
}

/** Synthetic v9 recording: generated columns only. Two calls produce two independent tracks. */
function makeTrack(): FlightTrack {
  const header =
    'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake,transmission_gear_inferred,engine_load_inferred';
  const rows: string[] = [];
  for (let index = 0; index <= 25; index += 1) {
    const t = index * STEP_S;
    const throttle = index % 5 === 0 ? 0.25 : 1;
    const brake = index % 7 === 0 ? 0.5 : 0;
    const gear = Math.min(6, Math.floor(index / 4));
    const load = (index % 10) / 10;
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, Math.round(t * 1000))).toISOString();
    rows.push(
      `${timestamp},${t.toFixed(3)},520,100,${(index * 2).toFixed(1)},0,100,${throttle},${brake},${gear},${load}`,
    );
  }

  return parseFlightCsv(
    ['# gtasa_flight_recorder,version=9,sample_hz=25', header, ...rows, ...EVENT_LINES].join('\n'),
    'acceptance',
  );
}

function oneShotSample(hz: number, frames: number): OfflineSample {
  return { frames: tone(frames, hz), loop: false, loopStartFrame: 0, sampleRateHz: RATE };
}

function playbackSamples(fromS: number, toS: number): SyncSample[] {
  const samples: SyncSample[] = [];
  for (let s = fromS; s <= toS + 1e-9; s += STEP_S) {
    samples.push({ playing: true, s: Math.min(s, toS) });
  }

  return samples;
}

/** Rising zero crossings per second, used to prove the fixtures are generated tones. */
function risingZeroCrossingsPerSecond(frames: Float32Array): number {
  let crossings = 0;
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index - 1] < 0 && frames[index] >= 0) {
      crossings += 1;
    }
  }

  return (crossings * RATE) / frames.length;
}

/** Runs the real scanner as a child process (fresh `git ls-files` + fresh directory walk on every call). */
function runScanner(args: readonly string[]): ScannerRun {
  const result = spawnSync(process.execPath, [SCANNER, ...args], { cwd: OPENSA_ROOT, encoding: 'utf8' });

  return { output: `${result.stdout ?? ''}${result.stderr ?? ''}`, status: result.status };
}

/** The cue a direct seek to an event's recorded time resolves, independent of playback history. */
function seekCue(timeline: AudioTimeline, event: TimelineEvent): FiredCue | null {
  const cue = timeline.frameAt(event.s).events.find((entry) => entry.eventId === event.id);
  if (!cue) {
    return null;
  }

  return {
    eventId: cue.eventId,
    gain: cue.cue.gain,
    kind: cue.kind,
    pan: cue.cue.pan,
    playbackRate: cue.cue.playbackRate,
    s: event.s,
    soundIndex: cue.cue.soundIndex,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value))
    .digest('hex');
}

/**
 * Mirror of the live scheduler's firing rule (`audio-engine-web.ts`): an event fires when a CONTINUOUS step
 * crosses it (`event.s > lastS && event.s <= s`, step <= 1 s). A seek, a pause or a large jump fires nothing.
 */
function simulateReplay(timeline: AudioTimeline, samples: readonly SyncSample[]): FiredCue[] {
  const fired: FiredCue[] = [];
  let lastS = 0;
  let previousPlaying = false;
  for (const sample of samples) {
    const continuous =
      sample.playing && previousPlaying && sample.s > lastS && sample.s - lastS <= MAX_CONTINUOUS_STEP_S;
    if (continuous) {
      for (const event of timeline.events) {
        if (event.s > lastS && event.s <= sample.s) {
          const cue = timeline.frameAt(event.s).events.find((entry) => entry.eventId === event.id);
          if (cue) {
            fired.push({
              eventId: cue.eventId,
              gain: cue.cue.gain,
              kind: cue.kind,
              pan: cue.cue.pan,
              playbackRate: cue.cue.playbackRate,
              s: event.s,
              soundIndex: cue.cue.soundIndex,
            });
          }
        }
      }
    }
    lastS = sample.s;
    previousPlaying = sample.playing;
  }

  return fired;
}

/** A bank of generated tones keyed by (file, soundIndex): a selection change changes the rendered PCM. */
function syntheticBank(): OfflineSampleBank {
  return {
    get: (file, soundIndex): null | OfflineSample => {
      if (file.startsWith('engine-accelerate')) return loopSample(200);
      if (file.startsWith('engine-decelerate')) return loopSample(150);
      if (file === 'collision-set.wav') return oneShotSample(90 + soundIndex * 30, 120);
      if (file === 'explosion-set.wav') return oneShotSample(60 + soundIndex * 40, 160);

      return null;
    },
  };
}

function tone(frames: number, hz: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    out[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / RATE);
  }

  return out;
}

describe('audio acceptance (negative cases)', () => {
  it('the export hash is sensitive to a selection change, not a constant digest', () => {
    const bank = syntheticBank();
    const baseline = renderOfflineWav(makeTrack(), MANIFEST, bank, { duration: DURATION, sampleRate: RATE });
    const changedManifest: AudioBankManifest = {
      ...MANIFEST,
      samples: MANIFEST.samples.map((sample) =>
        sample.category === 'collision set' ? { ...sample, setSoundCount: 2 } : sample,
      ),
    };
    const changed = renderOfflineWav(makeTrack(), changedManifest, bank, { duration: DURATION, sampleRate: RATE });

    expect(baseline.peak).toBeGreaterThan(0);
    expect(sha256(changed.wav)).not.toBe(sha256(baseline.wav));
  });

  it('a seek fires no event and replay after it fires only the events after the seek point, each once', () => {
    const timeline = buildAudioTimeline(makeTrack(), MANIFEST);
    const samples: SyncSample[] = [
      ...playbackSamples(0, 0.2),
      { playing: false, s: 0.2 },
      { playing: false, s: 0.6 },
      ...playbackSamples(0.64, DURATION),
    ];
    const fired = simulateReplay(timeline, samples);
    const ids = fired.map((cue) => cue.eventId);

    // The paused seek from 0.20 to 0.60 must have skipped the events in between: they never fire here.
    expect(ids).toEqual(['explosion#0', 'explosion#4', 'collision#5']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the leak scanner exits non-zero on a planted audio file and a GENRL-named file in an extra root', () => {
    const directory = mkdtempSync(join(tmpdir(), 'scan-no-assets-'));
    try {
      writeFileSync(join(directory, 'planted-tone.wav'), Buffer.from('RIFF planted, not a real sample'));
      writeFileSync(join(directory, 'GENRL'), Buffer.from('pretend bank'));
      const result = runScanner([directory]);

      expect(result.status).toBe(1);
      expect(result.output).toContain('planted-tone.wav');
      expect(result.output).toContain('GENRL');
      expect(result.output).toContain('RESULT: 2 violations');
      expect(result.output).toContain('scan-no-assets: FAIL');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('the leak scanner refuses a missing extra path instead of silently passing', () => {
    const missing = join(tmpdir(), 'scan-no-assets-missing-root');
    rmSync(missing, { force: true, recursive: true });
    const result = runScanner([missing]);

    expect(result.status).toBe(2);
    expect(result.output).toContain('ERROR');
  });
});

describe('audio acceptance (positive cases)', () => {
  it('replay cue stream is deterministic across runs: identical sha256 digests', () => {
    const first = simulateReplay(buildAudioTimeline(makeTrack(), MANIFEST), playbackSamples(0, DURATION));
    const second = simulateReplay(buildAudioTimeline(makeTrack(), MANIFEST), playbackSamples(0, DURATION));
    const firstDigest = digest(first);
    const secondDigest = digest(second);

    expect(first).toHaveLength(6);
    expect(first.map((cue) => cue.eventId)).toEqual([
      'explosion#0',
      'collision#1',
      'explosion#2',
      'collision#3',
      'explosion#4',
      'collision#5',
    ]);
    expect(secondDigest).toBe(firstDigest);
    console.log(`[t20] replay cue digest sha256=${firstDigest} events=${first.length}`);
  });

  it('export WAV/PCM is deterministic across runs: identical sha256 hashes', () => {
    const bank = syntheticBank();
    const first = renderOfflineWav(makeTrack(), MANIFEST, bank, { duration: DURATION, sampleRate: RATE });
    const second = renderOfflineWav(makeTrack(), MANIFEST, bank, { duration: DURATION, sampleRate: RATE });
    const firstHash = sha256(first.wav);
    const secondHash = sha256(second.wav);

    expect(first.wav).not.toBe(second.wav);
    expect(secondHash).toBe(firstHash);
    expect(first.peak).toBeGreaterThan(0);
    expect(first.frames).toBe(Math.round(DURATION * RATE));
    console.log(
      `[t20] export wav sha256=${firstHash} frames=${first.frames} rate=${first.sampleRateHz} peak=${first.peak.toFixed(4)}`,
    );
  });

  it('selection is stable across scrubbing: seek order does not change any event cue', () => {
    const timeline = buildAudioTimeline(makeTrack(), MANIFEST);
    const forward = timeline.events.map((event) => seekCue(timeline, event));
    const backward = [...timeline.events]
      .reverse()
      .map((event) => seekCue(timeline, event))
      .reverse();

    expect(digest(backward)).toBe(digest(forward));
    for (const [index, cue] of forward.entries()) {
      expect(cue, `event ${index}`).not.toBeNull();
      expect(cue?.soundIndex).toBe(timeline.events[index]?.soundIndex);
      expect(Number.isFinite(cue?.playbackRate)).toBe(true);
      expect(Number.isFinite(cue?.gain)).toBe(true);
    }

    // Scrub back to the start and replay: the second pass reproduces the first cue-for-cue.
    const firstPass = simulateReplay(timeline, playbackSamples(0, DURATION));
    const afterRewind = simulateReplay(timeline, [
      ...playbackSamples(0, DURATION),
      { playing: false, s: DURATION },
      ...playbackSamples(0, DURATION),
    ]);
    expect(digest(afterRewind.slice(firstPass.length))).toBe(digest(firstPass));
    expect(afterRewind.slice(0, firstPass.length)).toEqual(firstPass);
  });

  it('a continuous replay pass fires every event exactly once at its recorded time', () => {
    const timeline = buildAudioTimeline(makeTrack(), MANIFEST);
    const fired = simulateReplay(timeline, playbackSamples(0, DURATION));

    expect(fired.map((cue) => cue.eventId)).toEqual(timeline.events.map((event) => event.id));
    expect(fired.map((cue) => cue.s)).toEqual(timeline.events.map((event) => event.s));
    for (const [index, cue] of fired.entries()) {
      expect(cue.soundIndex).toBe(timeline.events[index]?.soundIndex);
      expect(Number.isFinite(cue.playbackRate)).toBe(true);
      expect(Number.isFinite(cue.gain)).toBe(true);
      expect(Number.isFinite(cue.pan)).toBe(true);
    }
  });

  it('no GTA sample is tracked by git or present under .omo/evidence: the scanner exits 0 on the live repo', () => {
    const result = runScanner([]);
    const tracked = /tracked files:\s*(\d+)/.exec(result.output);

    expect(result.status).toBe(0);
    expect(tracked, 'the scanner must report how many git-tracked files it read').not.toBeNull();
    expect(Number(tracked?.[1])).toBeGreaterThan(500);
    expect(result.output).toContain('evidence dir:');
    expect(result.output).toContain('RESULT: 0 violations');
    expect(result.output).toContain('scan-no-assets: OK');
  });

  it('the synth bank is generated tones only (fixture manifest carries zero PCM bytes)', () => {
    expect(MANIFEST.samples.every((sample) => sample.pcmBytes === 0)).toBe(true);
    const bank = syntheticBank();
    const collision = bank.get('collision-set.wav', 0);
    expect(collision).not.toBeNull();
    expect(collision?.frames.some((sample) => sample !== 0)).toBe(true);
    // One generated second of the bank's 90 Hz tone family: the measured rate is within 3% of the generator.
    const measured = risingZeroCrossingsPerSecond(tone(RATE, 90));
    expect(measured).toBeGreaterThanOrEqual(87);
    expect(measured).toBeLessThanOrEqual(91);
  });
});
