/**
 * Offline PCM renderer tests (plan todo 19).
 *
 * Negative cases come first. The test never uses GTA bytes: the manifest is a synthetic metadata object and the
 * bank is built from generated tones, so the renderer is exercised through its documented contract rather than
 * against a baked sample. Determinism is asserted by comparing SHA-256 of the WAV bytes, never by listening.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { AudioBankManifest, AudioFrame } from './audio-engine';
import type { FlightTrack } from './csv';

import { buildAudioTimeline } from './audio-engine';
import {
  EMPTY_SAMPLE_BANK,
  encodeWavPcm16,
  OFFLINE_CHANNELS,
  OFFLINE_INFERRED_INPUTS,
  OFFLINE_SAMPLE_RATE,
  type OfflineSample,
  type OfflineSampleBank,
  renderOfflineTimeline,
  renderOfflineWav,
} from './audio-offline';
import { DEFAULT_AUDIO_MIX_TUNING, normalizeAudioMixTuning } from './audio-tuning';
import { parseFlightCsv } from './csv';

const RENDER_RATE = 8000;
const RENDER_DURATION = 0.5;

/** A synthetic manifest with the four categories the core needs; zero PCM bytes (metadata only). */
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
      sampleRateHz: RENDER_RATE,
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
      sampleRateHz: RENDER_RATE,
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
      sampleRateHz: RENDER_RATE,
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
      sampleRateHz: RENDER_RATE,
      setSoundCount: 2,
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

const EVENTS = ['# event,0.2,explosion,0,0,100', '# event,0.4,collision,inferred,40,0,0,100'] as const;

function loopSample(hz: number): OfflineSample {
  return { frames: tone(400, hz), loop: true, loopStartFrame: 0, sampleRateHz: RENDER_RATE };
}

/** Synthetic v9 recording: columns only, no game bytes. */
function makeTrack(name: string, events: readonly string[] = EVENTS): FlightTrack {
  const header =
    'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake,transmission_gear_inferred,engine_load_inferred';
  const text = [
    '# gtasa_flight_recorder,version=9,sample_hz=25',
    header,
    '2026-01-01T00:00:00.000,0,520,100,0,0,100,1,0,3,1',
    '2026-01-01T00:00:00.500,0.5,520,100,0,0,100,1,0,3,1',
    '2026-01-01T00:00:01.000,1.0,520,100,0,0,100,1,0,4,1',
    ...events,
  ].join('\n');

  return parseFlightCsv(text, name);
}

function oneShotSample(hz: number, frames: number): OfflineSample {
  return { frames: tone(frames, hz), loop: false, loopStartFrame: 0, sampleRateHz: RENDER_RATE };
}

function renderPresenceTone(hz: number, presenceGain: number): number {
  const base = buildAudioTimeline(makeTrack('presence', []), MANIFEST);
  const timeline = {
    ...base,
    frameAt: (seconds: number, listener?: Parameters<typeof base.frameAt>[1]): AudioFrame => {
      const frame = base.frameAt(seconds, listener);

      return frame.engine
        ? {
            ...frame,
            engine: {
              ...frame.engine,
              layers: frame.engine.layers.map((layer) => ({ ...layer, presenceGain })),
            },
          }
        : frame;
    },
  };
  const sample = { frames: tone(400, hz, 0.05), loop: true, loopStartFrame: 0, sampleRateHz: RENDER_RATE };
  const bank: OfflineSampleBank = { get: (file): null | OfflineSample => (file.startsWith('engine-') ? sample : null) };
  const pcm = renderOfflineTimeline(timeline, bank, { duration: 0.5, reverb: false, sampleRate: RENDER_RATE }).pcm;
  const steady = pcm.subarray(Math.round(0.1 * RENDER_RATE) * 2);

  return Math.sqrt(steady.reduce((sum, value) => sum + value * value, 0) / steady.length);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

/** A bank of generated tones keyed by manifest file (no asset bytes). */
function syntheticBank(): OfflineSampleBank {
  const engineAccelerate = loopSample(220);
  const engineDecelerate = loopSample(180);
  const collision = oneShotSample(90, 120);
  const explosion = oneShotSample(60, 160);

  return {
    get: (file): null | OfflineSample => {
      if (file.startsWith('engine-accelerate')) return engineAccelerate;
      if (file.startsWith('engine-decelerate')) return engineDecelerate;
      if (file === 'collision-set.wav') return collision;
      if (file === 'explosion-set.wav') return explosion;

      return null;
    },
  };
}

function tone(frames: number, hz: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RENDER_RATE);
  }

  return out;
}

describe('offline PCM renderer (negative cases first)', () => {
  it('uses the selected live mixer profile when rendering synthesized export audio', () => {
    const track = makeTrack('mixer-export', []);
    const baseline = renderOfflineWav(track, MANIFEST, syntheticBank(), { duration: 0.5, sampleRate: RENDER_RATE });
    const muted = renderOfflineWav(track, MANIFEST, syntheticBank(), {
      duration: 0.5,
      sampleRate: RENDER_RATE,
      tuning: normalizeAudioMixTuning({ ...DEFAULT_AUDIO_MIX_TUNING, master: 0 }),
    });
    expect(baseline.pcm.some((sample) => sample !== 0)).toBe(true);
    expect(muted.pcm.every((sample) => sample === 0)).toBe(true);
  });

  it('the Hydra presence path adds middle frequencies while leaving bass nearly unchanged', () => {
    const middle = renderPresenceTone(2000, 1.5) / renderPresenceTone(2000, 0);
    const bass = renderPresenceTone(100, 1.5) / renderPresenceTone(100, 0);
    expect(middle).toBeGreaterThan(1.8);
    expect(bass).toBeLessThan(1.15);
  });

  it('zero or non-finite duration yields an empty-but-valid WAV track', () => {
    const track = makeTrack('zero');
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = renderOfflineWav(track, MANIFEST, syntheticBank(), { duration, sampleRate: RENDER_RATE });
      expect(result.frames).toBe(0);
      expect(result.pcm).toHaveLength(0);
      expect(result.peak).toBe(0);
      expect(result.wav).toHaveLength(44);
      expect(String.fromCharCode(result.wav[0], result.wav[1], result.wav[2], result.wav[3])).toBe('RIFF');
      expect(String.fromCharCode(result.wav[8], result.wav[9], result.wav[10], result.wav[11])).toBe('WAVE');
      expect(new DataView(result.wav.buffer, result.wav.byteOffset, result.wav.byteLength).getUint32(40, true)).toBe(0);
    }
  });

  it('a missing sample bank yields documented silence, never NaN and never a throw', () => {
    const result = renderOfflineWav(makeTrack('silent'), MANIFEST, EMPTY_SAMPLE_BANK, {
      duration: RENDER_DURATION,
      sampleRate: RENDER_RATE,
    });
    expect(result.peak).toBe(0);
    expect(result.clipped).toBe(false);
    for (const sample of result.pcm) {
      expect(sample).toBe(0);
    }

    // A manifest without the engine categories makes the core emit `engine: null`; the renderer still succeeds.
    const emptyManifest: AudioBankManifest = { samples: [], source: 'synthetic (no samples)', version: 1 };
    const timeline = buildAudioTimeline(makeTrack('no-manifest'), emptyManifest);
    const noManifest = renderOfflineTimeline(timeline, EMPTY_SAMPLE_BANK, {
      duration: RENDER_DURATION,
      sampleRate: RENDER_RATE,
    });
    expect(noManifest.frames).toBe(Math.round(RENDER_DURATION * RENDER_RATE));
    expect(noManifest.peak).toBe(0);
  });

  it('non-finite sample frames are floored to silence instead of poisoning the mix', () => {
    const poisoned: OfflineSampleBank = {
      get: (file) => {
        const frames = new Float32Array(64).fill(Number.NaN);

        return { frames, loop: file.startsWith('engine'), loopStartFrame: 0, sampleRateHz: RENDER_RATE };
      },
    };
    const result = renderOfflineWav(makeTrack('poisoned'), MANIFEST, poisoned, {
      duration: 0.1,
      sampleRate: RENDER_RATE,
    });
    expect(result.frames).toBe(800);
    expect(Number.isFinite(result.peak)).toBe(true);
    for (const sample of result.pcm) {
      expect(Number.isFinite(sample)).toBe(true);
      expect(sample).toBe(0);
    }
  });

  it('keeps no cached PCM: identical bytes but a fresh buffer, even after a different render', () => {
    const track = makeTrack('cache');
    const bank = syntheticBank();
    const first = renderOfflineWav(track, MANIFEST, bank, { duration: RENDER_DURATION, sampleRate: RENDER_RATE });
    const other = renderOfflineWav(track, MANIFEST, bank, { duration: 0.25, sampleRate: RENDER_RATE });
    const again = renderOfflineWav(track, MANIFEST, bank, { duration: RENDER_DURATION, sampleRate: RENDER_RATE });

    expect(other.frames).not.toBe(first.frames);
    expect(again.wav).not.toBe(first.wav);
    expect(again.pcm).not.toBe(first.pcm);
    expect(sha256(again.wav)).toBe(sha256(first.wav));
  });
});

describe('offline PCM renderer (positive cases)', () => {
  it('renders N seconds twice to byte-identical PCM hashes', () => {
    const track = makeTrack('deterministic');
    const bank = syntheticBank();
    const first = renderOfflineWav(track, MANIFEST, bank, { duration: RENDER_DURATION, sampleRate: RENDER_RATE });
    const second = renderOfflineWav(track, MANIFEST, bank, { duration: RENDER_DURATION, sampleRate: RENDER_RATE });
    const hashFirst = sha256(first.wav);
    const hashSecond = sha256(second.wav);

    expect(hashSecond).toBe(hashFirst);
    process.stdout.write(
      `[t19] offline PCM sha256 run1=${hashFirst} run2=${hashSecond} frames=${first.frames} rate=${first.sampleRateHz}\n`,
    );
  });

  it('encodes a canonical 16-bit stereo PCM WAV header', () => {
    const result = renderOfflineWav(makeTrack('header'), MANIFEST, syntheticBank(), {
      duration: RENDER_DURATION,
      sampleRate: RENDER_RATE,
    });
    const view = new DataView(result.wav.buffer, result.wav.byteOffset, result.wav.byteLength);
    expect(result.channels).toBe(OFFLINE_CHANNELS);
    expect(result.sampleRateHz).toBe(RENDER_RATE);
    expect(result.frames).toBe(Math.round(RENDER_DURATION * RENDER_RATE));
    expect(result.wav).toHaveLength(44 + result.frames * OFFLINE_CHANNELS * 2);
    expect(String.fromCharCode(result.wav[12], result.wav[13], result.wav[14], result.wav[15])).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(OFFLINE_CHANNELS);
    expect(view.getUint32(24, true)).toBe(RENDER_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(result.frames * OFFLINE_CHANNELS * 2);
  });

  it('produces non-silent output from the synthetic engine loop and one-shots', () => {
    const result = renderOfflineWav(makeTrack('audible'), MANIFEST, syntheticBank(), {
      duration: RENDER_DURATION,
      sampleRate: RENDER_RATE,
    });
    expect(result.peak).toBeGreaterThan(0);
    expect(result.pcm.some((sample) => sample !== 0)).toBe(true);
  });

  it('labels the inferred inputs as inferred', () => {
    const result = renderOfflineWav(makeTrack('labels'), MANIFEST, syntheticBank(), {
      duration: RENDER_DURATION,
      sampleRate: RENDER_RATE,
    });
    expect(result.inferredInputs).toBe(OFFLINE_INFERRED_INPUTS);
    expect(OFFLINE_INFERRED_INPUTS).toHaveLength(3);
    for (const label of OFFLINE_INFERRED_INPUTS) {
      expect(label).toMatch(/INFERRED/);
    }
    expect(OFFLINE_SAMPLE_RATE).toBe(44100);
  });

  it('encodeWavPcm16 writes a valid header for zero samples', () => {
    const wav = encodeWavPcm16(new Int16Array(0), OFFLINE_SAMPLE_RATE, OFFLINE_CHANNELS);
    expect(wav).toHaveLength(44);
    expect(String.fromCharCode(wav[0], wav[1], wav[2], wav[3])).toBe('RIFF');
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(0);
  });
});
