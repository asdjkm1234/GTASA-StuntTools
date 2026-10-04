import type { AudioMixTuning } from './audio-tuning';
import type { FlightTrack } from './csv';

/**
 * Offline deterministic PCM renderer for the video export (plan todo 19).
 *
 * It runs the SAME {@link buildAudioTimeline} core as the live renderer, but instead of scheduling Web Audio
 * nodes it mixes the timeline's `(sample, playbackRate, gain, pan)` commands into a stereo 16-bit PCM buffer
 * one sample at a time. There is no Web Audio, no DOM and no wall clock here: the output is a pure function of
 * the track, the manifest, the sample bank and the requested duration, so two renders of the same input are
 * byte-identical and a cached buffer can never leak between runs.
 *
 * Progress toward `renderOfflineWav(track, manifest, bank, options)` is strictly sample-indexed
 * (`s = frame / sampleRate`), so the result never depends on how fast the machine runs or on how many times
 * the function is called.
 *
 * Sample bytes are NEVER embedded in this module. PCM comes from the caller's {@link OfflineSampleBank}
 * (the replay app decodes the pak's baked WAVs into it; the tests pass synthetic tones), and the manifest only
 * supplies bank/slot metadata.
 *
 * Inferred inputs (MUST be reported as inferred, never as measured):
 * - engine pitch is driven by the INFERRED gear/load proxy (see `SIGNAL_PROVENANCE` in `audio-engine.ts`);
 * - collision strength comes from the INFERRED impact proxy;
 * - engine rev/RPM is BLOCKED (G3) and is never read or emitted.
 * They are surfaced as {@link OFFLINE_INFERRED_INPUTS} and echoed on every result.
 *
 * Documented defaults (missing signal never throws and never yields NaN):
 * - a cue whose sample is not in the bank renders as silence;
 * - a manifest without the engine categories makes the timeline's `engine` null, so the engine is silent;
 * - a non-finite or non-positive duration renders an empty-but-valid WAV (44-byte header, zero frames).
 */
import {
  type AudioBankManifest,
  type AudioListener,
  type AudioTimeline,
  buildAudioTimeline,
  type EngineVoiceCue,
  type EventCue,
  JET_THRUST_PRESENCE_HIGH_HZ,
  JET_THRUST_PRESENCE_LOW_HZ,
  type TimelineEvent,
} from './audio-engine';

/** Output sample rate of the offline mix (independent of each source's own rate, which is resampled by rate). */
export const OFFLINE_SAMPLE_RATE = 44100;
/** The export only ever carries stereo. */
export const OFFLINE_CHANNELS = 2;
/** Reverb send delay (seconds) of the documented deterministic feedback network. */
export const REVERB_DELAY_SECONDS = 0.05;
/** Feedback is clamped to this so the offline reverb can never run away. */
export const REVERB_MAX_FEEDBACK = 0.85;

/** Every input that is inferred rather than measured, labelled so the export never presents it as a reading. */
export const OFFLINE_INFERRED_INPUTS = [
  'transmission gear (INFERRED, recorder-labelled)',
  'engine load (INFERRED, recorder-labelled)',
  'collision impact (INFERRED peak-hold proxy)',
] as const;

/** One decoded mono sample. Engine loops wrap at `loopStartFrame`; one-shots have `loop: false`. */
export interface OfflineSample {
  readonly frames: Float32Array;
  readonly loop: boolean;
  readonly loopStartFrame: number;
  readonly sampleRateHz: number;
}

/**
 * Resolves a cue to its decoded PCM by manifest file name and set member, or `null` when the pak has no such
 * sample. `soundIndex` is the core's deterministic member selection (a baked set may carry several members;
 * a single-member file ignores it).
 */
export interface OfflineSampleBank {
  get(file: string, soundIndex: number): null | OfflineSample;
}

/** A bank with no samples: every cue renders silent. The documented default when audio was not baked. */
export const EMPTY_SAMPLE_BANK: OfflineSampleBank = { get: () => null };

export interface OfflineRenderOptions {
  /** Requested output length in seconds. Non-finite or <= 0 produces an empty-but-valid track. */
  readonly duration: number;
  /** Frame width the core uses to decide which events a frame triggers; default `AUDIO_EVENT_WINDOW`. */
  readonly eventWindow?: number;
  /** Optional listener per time; when absent the core uses the aircraft's own pose. */
  readonly listenerAt?: (s: number) => AudioListener;
  /** Apply the deterministic reverb send; default true. */
  readonly reverb?: boolean;
  /** Output rate; defaults to {@link OFFLINE_SAMPLE_RATE}. */
  readonly sampleRate?: number;
  /** The same user mix used by the live Web Audio timeline. */
  readonly tuning?: AudioMixTuning;
}

export interface OfflineRenderResult {
  readonly channels: number;
  /** True when any sample exceeded full scale before clamping. */
  readonly clipped: boolean;
  readonly frames: number;
  readonly inferredInputs: readonly string[];
  /** Interleaved stereo 16-bit samples (L,R,L,R,...). */
  readonly pcm: Int16Array;
  /** Maximum absolute pre-clamp sample value; 0 for silence. */
  readonly peak: number;
  readonly sampleRateHz: number;
  /** The complete RIFF/WAVE file, ready to hand the exporter's FFmpeg mux. */
  readonly wav: Uint8Array;
}

interface BiquadState {
  readonly a1: number;
  readonly a2: number;
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

interface EngineVoice {
  /** One read position per rate-step layer (parallel to `EngineVoiceCue.layers`). */
  phases: number[];
  presence?: { highpass: BiquadState; lowpass: BiquadState }[];
}

interface OneShotVoice {
  readonly gain: number;
  readonly left: number;
  position: number;
  readonly right: number;
  readonly sample: OfflineSample;
  readonly step: number;
}

interface ScheduledShot {
  readonly gain: number;
  readonly left: number;
  readonly right: number;
  readonly sample: OfflineSample;
  readonly startSample: number;
  readonly step: number;
}

/** Encode interleaved 16-bit PCM as a canonical RIFF/WAVE file (mono or stereo). Zero samples is valid. */
export function encodeWavPcm16(pcm: Int16Array, sampleRateHz: number, channels: number): Uint8Array {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i += 1) {
    view.setInt16(44 + i * 2, pcm[i], true);
  }

  return new Uint8Array(buffer);
}

/**
 * Render a prebuilt timeline to PCM. Pure: it keeps no module state, so repeated calls return independent,
 * byte-identical buffers for identical inputs. `bank` defaults to {@link EMPTY_SAMPLE_BANK} (silence).
 */
export function renderOfflineTimeline(
  timeline: AudioTimeline,
  bank: OfflineSampleBank = EMPTY_SAMPLE_BANK,
  options: OfflineRenderOptions,
): OfflineRenderResult {
  const sampleRateHz = Math.max(1, Math.round(finiteOr(options.sampleRate, OFFLINE_SAMPLE_RATE)));
  const durationSeconds = Number.isFinite(options.duration) && options.duration > 0 ? options.duration : 0;
  const frames = Math.round(durationSeconds * sampleRateHz);
  const channels = OFFLINE_CHANNELS;
  const inferredInputs = OFFLINE_INFERRED_INPUTS;

  if (frames === 0) {
    const empty = new Int16Array(0);

    return {
      channels,
      clipped: false,
      frames: 0,
      inferredInputs,
      pcm: empty,
      peak: 0,
      sampleRateHz,
      wav: encodeWavPcm16(empty, sampleRateHz, channels),
    };
  }

  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const shots = scheduleShots(timeline, bank, sampleRateHz, frames, options.listenerAt);
  const active: OneShotVoice[] = [];
  let shotCursor = 0;
  const engineVoices: EngineVoice[] = [];

  const reverbOn = options.reverb !== false;
  const delayFrames = Math.max(1, Math.round(REVERB_DELAY_SECONDS * sampleRateHz));
  const reverbLeft = new Float32Array(delayFrames);
  const reverbRight = new Float32Array(delayFrames);
  let reverbIndex = 0;
  let dampLeft = 0;
  let dampRight = 0;

  for (let i = 0; i < frames; i += 1) {
    const s = i / sampleRateHz;
    const frame = timeline.frameAt(s, options.listenerAt?.(s));
    if (frame.engine) {
      for (let index = 0; index < frame.engine.layers.length; index += 1) {
        const voice = engineVoices[index] ?? (engineVoices[index] = { phases: [] });
        renderEngineVoice(left, right, i, voice, bank, frame.engine.layers[index], sampleRateHz);
      }
    }
    while (shotCursor < shots.length && shots[shotCursor].startSample <= i) {
      const shot = shots[shotCursor];
      active.push({
        gain: shot.gain,
        left: shot.left,
        position: 0,
        right: shot.right,
        sample: shot.sample,
        step: shot.step,
      });
      shotCursor += 1;
    }
    mixActiveShots(active, left, right, i);

    if (reverbOn) {
      const mix = clamp(finiteOr(frame.reverb.mix, 0), 0, 1);
      const damping = clamp(finiteOr(frame.reverb.damping, 0), 0, 1);
      const decay = finiteOr(frame.reverb.decaySeconds, 0);
      const feedback = decay > 0 ? clamp(10 ** ((-3 * REVERB_DELAY_SECONDS) / decay), 0, REVERB_MAX_FEEDBACK) : 0;
      const dryLeft = left[i];
      const dryRight = right[i];
      const wetLeft = reverbLeft[reverbIndex] * (1 - damping) + dampLeft * damping;
      const wetRight = reverbRight[reverbIndex] * (1 - damping) + dampRight * damping;
      dampLeft = wetLeft;
      dampRight = wetRight;
      reverbLeft[reverbIndex] = dryLeft + wetLeft * feedback;
      reverbRight[reverbIndex] = dryRight + wetRight * feedback;
      reverbIndex = (reverbIndex + 1) % delayFrames;
      left[i] = dryLeft * (1 - mix) + wetLeft * mix;
      right[i] = dryRight * (1 - mix) + wetRight * mix;
    }
  }

  const pcm = new Int16Array(frames * channels);
  let peak = 0;
  for (let i = 0; i < frames; i += 1) {
    const sampleLeft = finiteOr(left[i], 0);
    const sampleRight = finiteOr(right[i], 0);
    peak = Math.max(peak, Math.abs(sampleLeft), Math.abs(sampleRight));
    pcm[i * channels] = toInt16(sampleLeft);
    pcm[i * channels + 1] = toInt16(sampleRight);
  }

  return {
    channels,
    clipped: peak > 1,
    frames,
    inferredInputs,
    pcm,
    peak,
    sampleRateHz,
    wav: encodeWavPcm16(pcm, sampleRateHz, channels),
  };
}

/** Build the timeline from a recording + manifest, then render it. The export's no-WAV audio path. */
export function renderOfflineWav(
  track: FlightTrack,
  manifest: AudioBankManifest,
  bank: OfflineSampleBank = EMPTY_SAMPLE_BANK,
  options: OfflineRenderOptions,
): OfflineRenderResult {
  const timeline = buildAudioTimeline(track, manifest, { eventWindow: options.eventWindow, tuning: options.tuning });

  return renderOfflineTimeline(timeline, bank, options);
}

/** Advance a looping engine voice by `step` source frames, wrapping at `loopStartFrame`. */
function advanceLoop(position: number, step: number, sample: OfflineSample): number {
  const length = sample.frames.length;
  if (length === 0) {
    return 0;
  }
  const next = position + step;
  if (next < length) {
    return next;
  }
  const loopStart = clamp(Math.floor(finiteOr(sample.loopStartFrame, 0)), 0, Math.max(0, length - 1));
  const span = length - loopStart;

  return span > 0 ? loopStart + ((next - loopStart) % span) : 0;
}

function applyBiquad(state: BiquadState, sample: number): number {
  const output =
    state.b0 * sample + state.b1 * state.x1 + state.b2 * state.x2 - state.a1 * state.y1 - state.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = sample;
  state.y2 = state.y1;
  state.y1 = output;

  return output;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** RBJ 2-pole Butterworth coefficients, matching the live Web Audio high/low-pass nodes. */
function createBiquad(type: 'highpass' | 'lowpass', frequency: number, sampleRate: number): BiquadState {
  const omega = (2 * Math.PI * Math.min(frequency, sampleRate * 0.49)) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const base = type === 'highpass' ? 1 + cosine : 1 - cosine;

  return {
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0,
    b0: base / (2 * a0),
    b1: (type === 'highpass' ? -base : base) / a0,
    b2: base / (2 * a0),
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}

/** Resolve one timeline event's cue through the core at its own instant (the deterministic selection). */
function cueForEvent(timeline: AudioTimeline, event: TimelineEvent, listener?: AudioListener): EventCue | null {
  const frame = timeline.frameAt(event.s, listener);

  return frame.events.find((candidate) => candidate.eventId === event.id) ?? null;
}

/** A finite number, or the caller's documented default when the signal is absent/non-finite. */
function finiteOr(value: null | number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Mix every currently active one-shot voice into the dry stereo buffers at frame `index` and advance each
 * read position, dropping a voice the moment it runs past its sample. Back-to-front order is preserved so a
 * `splice` never skips a voice.
 */
function mixActiveShots(active: OneShotVoice[], left: Float32Array, right: Float32Array, index: number): void {
  for (let v = active.length - 1; v >= 0; v -= 1) {
    const voice = active[v];
    const value = sampleFrame(voice.sample, voice.position);
    left[index] += value * voice.gain * voice.left;
    right[index] += value * voice.gain * voice.right;
    voice.position += voice.step;
    if (voice.position >= voice.sample.frames.length) {
      active.splice(v, 1);
    }
  }
}

/** Equal-power stereo gains for a pan in [-1,1]; a centred source is `sqrt(0.5)` on both sides. */
function panGains(pan: number): readonly [number, number] {
  const angle = (clamp(finiteOr(pan, 0), -1, 1) + 1) * (Math.PI / 4);

  return [Math.cos(angle), Math.sin(angle)];
}

/** Mix one continuously looping engine voice's rate-step layers into the dry buffers and advance each phase. */
function renderEngineVoice(
  left: Float32Array,
  right: Float32Array,
  index: number,
  voice: EngineVoice,
  bank: OfflineSampleBank,
  cue: EngineVoiceCue,
  outputRate: number,
): void {
  if (cue.layers.length === 0) {
    return;
  }
  const [panLeft, panRight] = panGains(cue.pan);
  const voiceGain = clamp(finiteOr(cue.gain, 0), 0, 1);
  for (let layerIndex = 0; layerIndex < cue.layers.length; layerIndex += 1) {
    const layer = cue.layers[layerIndex];
    const weight = clamp(finiteOr(layer.weight, 0), 0, 1);
    if (weight <= 0) {
      continue;
    }
    const sample = bank.get(layer.file, 0);
    if (!sample || sample.frames.length === 0) {
      continue;
    }
    const sourceRate = finiteOr(sample.sampleRateHz, outputRate);
    const step = clamp(finiteOr(layer.playbackRate, 0), 0, 8) * (sourceRate / outputRate);
    const phase = voice.phases[layerIndex] ?? 0;
    const value = sampleFrame(sample, phase);
    const layerGain = voiceGain * weight;
    let mixed = value;
    if ((cue.presenceGain ?? 0) > 0) {
      const filters = voice.presence ?? (voice.presence = []);
      const presence =
        filters[layerIndex] ??
        (filters[layerIndex] = {
          highpass: createBiquad('highpass', cue.presenceHighHz ?? JET_THRUST_PRESENCE_HIGH_HZ, outputRate),
          lowpass: createBiquad('lowpass', cue.presenceLowHz ?? JET_THRUST_PRESENCE_LOW_HZ, outputRate),
        });
      mixed +=
        applyBiquad(presence.lowpass, applyBiquad(presence.highpass, value)) *
        clamp(finiteOr(cue.presenceGain, 0), 0, 8);
    }
    left[index] += mixed * layerGain * panLeft;
    right[index] += mixed * layerGain * panRight;
    voice.phases[layerIndex] = advanceLoop(phase, step, sample);
  }
}

/** Linear interpolation of a mono sample; an out-of-range or non-finite frame reads as silence. */
function sampleFrame(sample: OfflineSample, position: number): number {
  const frames = sample.frames;
  if (frames.length === 0 || !Number.isFinite(position)) {
    return 0;
  }
  const index = Math.floor(position);
  if (index < 0 || index >= frames.length) {
    return 0;
  }
  const current = finiteOr(frames[index], 0);
  const next = index + 1 < frames.length ? finiteOr(frames[index + 1], 0) : 0;

  return current + (next - current) * (position - index);
}

/** Precompute every one-shot as a scheduled voice. Events with no sample are dropped (documented silence). */
function scheduleShots(
  timeline: AudioTimeline,
  bank: OfflineSampleBank,
  outputRate: number,
  frames: number,
  listenerAt?: (s: number) => AudioListener,
): ScheduledShot[] {
  const shots: ScheduledShot[] = [];
  for (const event of timeline.events) {
    const cue = cueForEvent(timeline, event, listenerAt?.(event.s));
    if (!cue) {
      continue;
    }
    const sample = bank.get(cue.cue.file, cue.cue.soundIndex);
    if (!sample || sample.frames.length === 0) {
      continue;
    }
    const startSample = Math.round(event.s * outputRate);
    if (startSample >= frames) {
      continue;
    }
    const [panLeft, panRight] = panGains(cue.cue.pan);
    shots.push({
      gain: clamp(finiteOr(cue.cue.gain, 0), 0, 1),
      left: panLeft,
      right: panRight,
      sample,
      startSample: Math.max(0, startSample),
      step: clamp(finiteOr(cue.cue.playbackRate, 0), 0, 8) * (finiteOr(sample.sampleRateHz, outputRate) / outputRate),
    });
  }

  return shots;
}

/** Clamp to full scale and quantise deterministically (a NaN can never reach the file). */
function toInt16(value: number): number {
  return Math.round(clamp(finiteOr(value, 0), -1, 1) * 32767);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
