/**
 * Live Web Audio renderer for the replay audio engine core (todo 18).
 *
 * The core (`audio-engine.ts`) maps the recorded/derived signals to deterministic `(sample, playbackRate,
 * gain, pan)` cues and owns every acoustic number. This module only PLAYS those cues in real time, with the
 * replay camera as the Web Audio listener:
 * - the two engine loops are persistent `AudioBufferSourceNode`s whose playbackRate/gain follow the core's
 *   pitch and crossfade cues, multiplied by the replay speed (a 2x replay is a 2x timeline);
 * - collisions and explosions are one-shots started when the replay CLOCK crosses their recorded time (a
 *   seek or a pause fires nothing, so a scrub cannot machine-gun events);
 * - every voice runs through its own `PannerNode` (3D azimuth, replay camera as the listener) into a dry bus
 *   and a `ConvolverNode` reverb bus whose impulse response is a deterministic seeded decay per reverb zone;
 * - distance and directional attenuation stay the CORE's `AudioCue.gain` (`rolloffFactor = 0` on the panner),
 *   so there is exactly one attenuation authority and no double attenuation.
 *
 * Signal honesty (see `SIGNAL_PROVENANCE` in `audio-engine.ts`): engine gear, engine load and collision
 * impact are INFERRED; engine rev/RPM and collision surface material are MISSING. Nothing here re-derives or
 * upgrades a signal: the cues are consumed verbatim. This is a Web Audio approximation of the documented
 * acoustic model, NOT bit-exact with the original game (bit-exactness is not claimed).
 *
 * A pak without the audio lane leaves this renderer `no-samples` and silent.
 */
import type { AudioBankManifest, AudioCue, AudioFrame, AudioListener, AudioTimeline, EngineCue } from './audio-engine';
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';
import type { PakAudioManifest, PakResources } from './pak-resources';

import {
  ATTENUATION_MAX_DISTANCE,
  ATTENUATION_REF_DISTANCE,
  buildAudioTimeline,
  engineLayerSpecsForModel,
  hashSeed,
  JET_THRUST_PRESENCE_HIGH_HZ,
  JET_THRUST_PRESENCE_LOW_HZ,
  reverbForZone,
  type ReverbZone,
  seededUnit,
} from './audio-engine';
import { gtaToEngine } from './math';

// ---------------------------------------------------------------------------------------------
// Renderer constants (mapping choices of THIS renderer, not core numerics)
// ---------------------------------------------------------------------------------------------

/** Longest replay step treated as continuous playback; a larger jump is a seek and fires no event. */
const MAX_CONTINUOUS_STEP_S = 1;
/** Below this a one-shot cue is inaudible and its node would be pure overhead. */
const MIN_AUDIBLE_GAIN = 0.001;
/** Reverb/one-shot tail kept after a scheduled stop so a truncated ring-out never clicks. */
const ONE_SHOT_TAIL_S = 0.05;
/** `AudioParam.setTargetAtTime` time constant used for every per-frame gain/rate write. */
const PARAM_SMOOTHING_S = 0.02;
/** Playback-rate band applied to the engine loops (the core's rate still passes through untouched). */
const LOOP_RATE_MIN = 0.25;
/** Upper bound of any applied playback rate, so a bad input cannot produce a non-finite rate. */
const RATE_MAX = 8;

/** The listener pose supplied by the caller: the replay camera, in ENGINE space. */
export interface WebAudioListenerPose {
  readonly forward: Vec3;
  readonly position: Vec3;
  readonly up: Vec3;
  readonly velocity: Vec3;
}

export type WebAudioState = 'decoding' | 'disposed' | 'error' | 'no-samples' | 'ready' | 'unavailable';

/** Everything `standalone/flight-replay.ts` publishes on the `window.__flight` probe. */
export interface WebAudioStats {
  readonly contextState: string;
  /** The engine bank selected for the current track's model ('' when none) — the per-model provenance. */
  readonly engineBank: string;
  readonly engineGain: number;
  readonly engineRate: number;
  readonly listenerPos: null | Vec3;
  readonly liveOneShots: number;
  readonly liveSources: number;
  readonly message: string;
  readonly muted: boolean;
  readonly nodesCreated: number;
  readonly oneShotsStarted: number;
  readonly playing: boolean;
  readonly releasedOneShots: number;
  readonly reverbMix: number;
  readonly reverbZone: string;
  readonly samples: number;
  readonly speed: number;
  readonly state: WebAudioState;
  readonly timelineEvents: number;
  readonly trackEpoch: number;
  readonly updates: number;
}

interface LoopLayer {
  readonly file: string;
  readonly gain: GainNode;
  readonly source: AudioBufferSourceNode;
}

interface LoopVoice {
  readonly gain: GainNode;
  readonly layers: readonly LoopLayer[];
  readonly panner: PannerNode;
  readonly presence: null | { gain: GainNode; highpass: BiquadFilterNode; lowpass: BiquadFilterNode };
  readonly role: string;
}

interface MutableStats {
  contextState: string;
  engineBank: string;
  engineGain: number;
  engineRate: number;
  listenerPos: null | Vec3;
  message: string;
  muted: boolean;
  nodesCreated: number;
  oneShotsStarted: number;
  playing: boolean;
  releasedOneShots: number;
  reverbMix: number;
  reverbZone: string;
  samples: number;
  speed: number;
  state: WebAudioState;
  timelineEvents: number;
  trackEpoch: number;
  updates: number;
}

interface OneShotVoice {
  readonly gain: GainNode;
  readonly panner: PannerNode;
  readonly source: AudioBufferSourceNode;
  stopped: boolean;
}

// ---------------------------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------------------------

export class WebAudioReplay {
  /** Everything the probe/UI reads. Cheap to call per frame: one small snapshot object. */
  get stats(): WebAudioStats {
    const data = this.statsData;

    return {
      contextState: data.contextState,
      engineBank: data.engineBank,
      engineGain: data.engineGain,
      engineRate: data.engineRate,
      listenerPos: data.listenerPos ? [...data.listenerPos] : null,
      liveOneShots: this.oneShots.size,
      liveSources: this.loops.length + this.oneShots.size,
      message: data.message,
      muted: data.muted,
      nodesCreated: data.nodesCreated,
      oneShotsStarted: data.oneShotsStarted,
      playing: data.playing,
      releasedOneShots: data.releasedOneShots,
      reverbMix: data.reverbMix,
      reverbZone: data.reverbZone,
      samples: data.samples,
      speed: data.speed,
      state: data.state,
      timelineEvents: data.timelineEvents,
      trackEpoch: data.trackEpoch,
      updates: data.updates,
    };
  }
  private attachedTrack: FlightTrack | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private context: AudioContext | null = null;
  private convolver: ConvolverNode | null = null;
  private dry: GainNode | null = null;
  private epoch = 0;
  private readonly impulses = new Map<string, AudioBuffer>();
  private lastS = 0;
  private loopModel: null | number = null;
  private loops: LoopVoice[] = [];
  private manifest: AudioBankManifest | null = null;
  private master: GainNode | null = null;
  private readonly oneShots = new Set<OneShotVoice>();
  private prevPlaying = false;
  private reverbZoneKey: null | ReverbZone = null;
  private readonly statsData: MutableStats = {
    contextState: 'none',
    engineBank: '',
    engineGain: 0,
    engineRate: 0,
    listenerPos: null,
    message: '合成音频：正在解码 pak 样本…',
    muted: false,
    nodesCreated: 0,
    oneShotsStarted: 0,
    playing: false,
    releasedOneShots: 0,
    reverbMix: 0,
    reverbZone: 'urban',
    samples: 0,
    speed: 1,
    state: 'decoding',
    timelineEvents: 0,
    trackEpoch: 0,
    updates: 0,
  };
  private timeline: AudioTimeline | null = null;

  private wet: GainNode | null = null;

  constructor(private readonly resources: PakResources) {
    if (typeof globalThis.AudioContext !== 'function') {
      this.setUnavailable('unavailable', '合成音频：此浏览器不支持 Web Audio');

      return;
    }
    void this.decode();
  }

  /**
   * Point the renderer at one recording. The pak samples are track-independent, so the graph is reused; only
   * the deterministic event timeline is rebuilt and any one-shot still ringing from the PREVIOUS track is
   * stopped, so a track switch never leaves an orphan voice behind.
   */
  attachTrack(track: FlightTrack): void {
    this.attachedTrack = track;
    this.epoch += 1;
    this.statsData.trackEpoch = this.epoch;
    this.statsData.timelineEvents = 0;
    this.stopOneShots();
    this.lastS = 0;
    this.prevPlaying = false;
    if (this.statsData.state === 'ready') {
      this.buildTimeline(track);
    }
  }

  /** Clear the selected recording while retaining the decoded pak bank for the next import/undo. */
  detachTrack(): void {
    this.epoch += 1;
    this.attachedTrack = null;
    this.timeline = null;
    this.stopOneShots();
    this.silenceLoops();
    this.prevPlaying = false;
    this.statsData.playing = false;
    this.statsData.engineGain = 0;
    this.statsData.engineRate = 0;
    this.statsData.timelineEvents = 0;
    this.statsData.trackEpoch = this.epoch;
  }

  /** Stop every voice and close the context. The page calls this on teardown; a track switch does not. */
  dispose(): void {
    this.epoch += 1;
    this.attachedTrack = null;
    this.timeline = null;
    this.stopOneShots();
    this.stopLoops();
    this.loopModel = null;
    const context = this.context;
    this.context = null;
    this.master = null;
    this.dry = null;
    this.wet = null;
    this.convolver = null;
    this.reverbZoneKey = null;
    this.statsData.state = 'disposed';
    this.statsData.contextState = 'closed';
    this.statsData.playing = false;
    if (context) {
      void context.close().catch(() => {
        /* already closed */
      });
    }
  }

  /** Global mute for the synthesis bus. */
  setMuted(muted: boolean): void {
    this.statsData.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, PARAM_SMOOTHING_S);
    }
  }

  /**
   * One per-frame call. Writes engine loop rate/gain and the listener pose, starts one-shots that the replay
   * clock has crossed, and silences everything while paused. NEVER blocks: the only allocation is a few
   * AudioParams on a frame where an event fires.
   */
  sync(
    playing: boolean,
    speed: number,
    seconds: number,
    listener: WebAudioListenerPose,
    emitterPosition: null | Vec3,
  ): void {
    const data = this.statsData;
    const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    // `playing` describes THIS renderer, so a no-samples/no-timeline lane stays silent whatever the clock says.
    data.playing = false;
    data.speed = safeSpeed;
    data.listenerPos = [...listener.position];
    if (data.state !== 'ready' || !this.timeline) {
      this.lastS = safeSeconds;
      this.prevPlaying = playing;

      return;
    }
    if (playing) {
      this.applyPlayingFrame(safeSeconds, safeSpeed, listener, emitterPosition);
    } else {
      this.applyPausedFrame(safeSeconds);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Decoding (never blocks the first frame: the constructor fires this and returns)
  // -------------------------------------------------------------------------------------------

  private applyEngine(frame: AudioFrame, speed: number, emitterPosition: null | Vec3, context: AudioContext): void {
    const engine = frame.engine;
    const enginePosition = emitterPosition
      ? gtaToEngine(emitterPosition[0], emitterPosition[1], emitterPosition[2])
      : null;
    this.statsData.engineRate = engine ? engine.playbackRate * speed : 0;
    this.statsData.engineGain = engine ? engine.layers.reduce((maximum, layer) => Math.max(maximum, layer.gain), 0) : 0;
    if (engine) {
      this.statsData.engineBank = engine.engineBank;
    }
    for (const voice of this.loops) {
      if (enginePosition) {
        setPannerPosition(voice.panner, enginePosition);
      }
      this.applyLoopVoice(voice, engine, speed, context);
    }
  }

  /** Writes this frame's cue onto one persistent engine loop: voice gain plus per-layer rate/weight. */
  private applyLoopVoice(voice: LoopVoice, engine: EngineCue | null, speed: number, context: AudioContext): void {
    const cue = engine?.layers.find((layer) => layer.role === voice.role) ?? null;
    const gain = cue ? clampFinite(cue.gain, 0, 1) : 0;
    voice.gain.gain.setTargetAtTime(gain, context.currentTime, PARAM_SMOOTHING_S);
    voice.presence?.gain.gain.setTargetAtTime(
      cue ? clampFinite(cue.presenceGain ?? 0, 0, 8) : 0,
      context.currentTime,
      PARAM_SMOOTHING_S,
    );
    if (voice.presence && cue) {
      voice.presence.highpass.frequency.setTargetAtTime(
        clampFinite(cue.presenceHighHz ?? JET_THRUST_PRESENCE_HIGH_HZ, 100, 2000),
        context.currentTime,
        PARAM_SMOOTHING_S,
      );
      voice.presence.lowpass.frequency.setTargetAtTime(
        clampFinite(cue.presenceLowHz ?? JET_THRUST_PRESENCE_LOW_HZ, 1500, 10000),
        context.currentTime,
        PARAM_SMOOTHING_S,
      );
    }
    for (const layer of voice.layers) {
      const layerCue = cue?.layers.find((candidate) => candidate.file === layer.file);
      const rate = layerCue ? clampFinite(layerCue.playbackRate * speed, LOOP_RATE_MIN, RATE_MAX) : LOOP_RATE_MIN;
      const weight = layerCue ? clampFinite(layerCue.weight, 0, 1) : 0;
      layer.source.playbackRate.setTargetAtTime(rate, context.currentTime, PARAM_SMOOTHING_S);
      layer.gain.gain.setTargetAtTime(weight, context.currentTime, PARAM_SMOOTHING_S);
    }
  }

  private applyPausedFrame(seconds: number): void {
    const data = this.statsData;
    if (this.prevPlaying) {
      this.stopOneShots();
    }
    if (this.context) {
      this.silenceLoops();
    }
    data.engineGain = 0;
    data.engineRate = 0;
    data.playing = false;
    this.lastS = seconds;
    this.prevPlaying = false;
  }

  private applyPlayingFrame(
    seconds: number,
    speed: number,
    listener: WebAudioListenerPose,
    emitterPosition: null | Vec3,
  ): void {
    const timeline = this.timeline;
    if (!timeline) {
      return;
    }
    const context = this.ensureGraph();
    if (!context) {
      return;
    }
    const frame = timeline.frameAt(seconds, listenerToGta(listener));
    this.updateListener(listener, context);
    this.updateReverb(frame, context);
    if (context.state === 'suspended') {
      void context.resume().catch(() => {
        /* the play click is the gesture that unlocks it */
      });
    }
    this.ensureLoops(context);
    this.applyEngine(frame, speed, emitterPosition, context);
    const continuous = this.prevPlaying && seconds > this.lastS && seconds - this.lastS <= MAX_CONTINUOUS_STEP_S;
    if (continuous) {
      this.triggerEvents(this.lastS, seconds, listener, speed);
    }
    this.statsData.playing = true;
    this.statsData.updates += 1;
    this.lastS = seconds;
    this.prevPlaying = true;
  }

  // -------------------------------------------------------------------------------------------
  // Per-frame paths
  // -------------------------------------------------------------------------------------------

  /** Every cue resolves to an exact manifest file; a cue with no baked sample is silent. */
  private bufferFor(cue: AudioCue): AudioBuffer | null {
    return this.buffers.get(cue.file) ?? null;
  }

  private buildTimeline(track: FlightTrack): void {
    if (!this.manifest) {
      return;
    }
    this.timeline = buildAudioTimeline(track, this.manifest);
    this.statsData.timelineEvents = this.timeline.events.length;
    this.statsData.engineBank = this.timeline.engineBank;
  }

  private async decode(): Promise<void> {
    const manifest = this.resources.getAudioManifest();
    if (!manifest || !Array.isArray(manifest.samples) || manifest.samples.length === 0) {
      this.setUnavailable('no-samples', '合成音频：无样本（pak 未烘焙音频清单）');

      return;
    }
    this.manifest = toCoreManifest(manifest);
    // An OfflineAudioContext decodes without a user gesture and without an autoplay-policy warning; an
    // AudioBuffer is context-independent, so the live context can play these buffers unchanged.
    const decoder = new OfflineAudioContext(1, 1, 48000);
    let failures = 0;
    for (const sample of manifest.samples) {
      const bytes = this.resources.getAudioSample(sample.file);
      if (!bytes || bytes.byteLength === 0) {
        failures += 1;
        continue;
      }
      try {
        const buffer = await decoder.decodeAudioData(bytes.slice().buffer);
        this.buffers.set(sample.file, buffer);
      } catch {
        failures += 1;
      }
    }
    if (this.buffers.size === 0) {
      this.setUnavailable('error', `合成音频：pak 音频解码失败（${failures} 个文件）`);

      return;
    }
    this.statsData.samples = this.buffers.size;
    this.statsData.state = 'ready';
    this.statsData.message = `合成音频：就绪（${this.buffers.size} 个 pak 样本，Web Audio 合成）`;
    // `attachTrack` may have run while the decode was in flight (boot attaches the latest recording).
    if (this.attachedTrack) {
      this.buildTimeline(this.attachedTrack);
    }
  }

  /** Build the live graph on first play — after a user gesture, so Chrome never logs an autoplay warning. */
  private ensureGraph(): AudioContext | null {
    if (this.context) {
      return this.context;
    }
    if (this.statsData.state !== 'ready') {
      return null;
    }
    let context: AudioContext;
    try {
      context = new AudioContext({ latencyHint: 'interactive' });
    } catch (error) {
      this.setUnavailable(
        'unavailable',
        `合成音频：无法创建 AudioContext（${error instanceof Error ? error.message : String(error)}）`,
      );

      return null;
    }
    const master = context.createGain();
    const dry = context.createGain();
    const wet = context.createGain();
    const convolver = context.createConvolver();
    const initial = reverbForZone('urban');
    convolver.buffer = this.impulseFor(context, 'urban');
    wet.gain.value = initial.mix;
    master.gain.value = this.statsData.muted ? 0 : 1;
    dry.connect(master);
    wet.connect(convolver);
    convolver.connect(master);
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    this.dry = dry;
    this.wet = wet;
    this.convolver = convolver;
    this.reverbZoneKey = 'urban';
    this.statsData.nodesCreated += 4;
    this.statsData.contextState = context.state;
    context.onstatechange = (): void => {
      this.statsData.contextState = context.state;
    };

    return context;
  }

  private ensureLoops(context: AudioContext): void {
    if (!this.manifest) {
      return;
    }
    const dry = this.dry;
    const wet = this.wet;
    if (!dry || !wet) {
      return;
    }
    const model = this.attachedTrack ? this.attachedTrack.model : 0;
    // A track switch can change the model (Hydra <-> Rustler). The persistent loops belong to one model's
    // layer set, so rebuild them instead of leaving the previous model's samples in the graph.
    if (this.loops.length > 0 && this.loopModel === model) {
      return;
    }
    if (this.loops.length > 0) {
      this.stopLoops();
    }
    for (const spec of engineLayerSpecsForModel(this.manifest, model)) {
      const layers: LoopLayer[] = [];
      for (const step of spec.steps) {
        const buffer = this.buffers.get(step.file);
        if (!buffer) {
          continue;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        // Honour the baked loop point so a seam transient is never cycled; a seamless bake loops from 0.
        const loopStartSeconds = step.loopStartFrame / Math.max(1, buffer.sampleRate);
        source.loopStart = Math.min(Math.max(0, loopStartSeconds), Math.max(0, buffer.duration - 1e-4));
        source.loopEnd = buffer.duration;
        const layerGain = context.createGain();
        layerGain.gain.value = 0;
        source.connect(layerGain);
        layers.push({ file: step.file, gain: layerGain, source });
        this.statsData.nodesCreated += 2;
      }
      if (layers.length === 0) {
        continue;
      }
      const gain = context.createGain();
      gain.gain.value = 0;
      const panner = context.createPanner();
      configurePanner(panner);
      for (const layer of layers) {
        layer.gain.connect(gain);
      }
      gain.connect(panner);
      const presence = createJetThrustPresence(context, model, spec.role, gain, panner);
      this.statsData.nodesCreated += Number(Boolean(presence)) * 3;
      panner.connect(dry);
      panner.connect(wet);
      for (const layer of layers) {
        layer.source.start();
      }
      this.loops.push({ gain, layers, panner, presence, role: spec.role });
      this.statsData.nodesCreated += 2;
    }
    this.loopModel = model;
  }

  private impulseFor(context: AudioContext, zone: ReverbZone): AudioBuffer {
    const cached = this.impulses.get(zone);
    if (cached) {
      return cached;
    }
    const parameters = reverbForZone(zone);
    const length = Math.max(64, Math.floor(context.sampleRate * parameters.decaySeconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    const seed = hashSeed(`replay-reverb:${zone}`);
    const damping = 1 + parameters.damping * 3;
    for (let index = 0; index < length; index += 1) {
      const decay = Math.pow(1 - index / length, damping);
      data[index] = (seededUnit(seed + index) * 2 - 1) * decay;
    }
    this.impulses.set(zone, buffer);

    return buffer;
  }

  private releaseOneShot(voice: OneShotVoice): void {
    if (voice.stopped) {
      return;
    }
    voice.stopped = true;
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.panner.disconnect();
    if (this.oneShots.delete(voice)) {
      this.statsData.releasedOneShots += 1;
    }
  }

  private setUnavailable(state: WebAudioState, message: string): void {
    this.statsData.state = state;
    this.statsData.message = message;
  }

  private silenceLoops(): void {
    const context = this.context;
    if (!context) {
      return;
    }
    for (const voice of this.loops) {
      voice.gain.gain.setTargetAtTime(0, context.currentTime, PARAM_SMOOTHING_S);
    }
  }

  // -------------------------------------------------------------------------------------------
  // One-shots
  // -------------------------------------------------------------------------------------------

  private startOneShot(cue: AudioCue, positionEngine: Vec3, speed: number): void {
    const context = this.context;
    const dry = this.dry;
    const wet = this.wet;
    if (!context || !dry || !wet || cue.gain < MIN_AUDIBLE_GAIN) {
      return;
    }
    const buffer = this.bufferFor(cue);
    if (!buffer) {
      return;
    }
    const rate = clampFinite(cue.playbackRate * speed, LOOP_RATE_MIN, RATE_MAX);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.setValueAtTime(clampFinite(cue.gain, 0, 1), context.currentTime);
    const panner = context.createPanner();
    configurePanner(panner);
    setPannerPosition(panner, positionEngine);
    source.connect(gain);
    gain.connect(panner);
    panner.connect(dry);
    panner.connect(wet);
    const voice: OneShotVoice = { gain, panner, source, stopped: false };
    this.oneShots.add(voice);
    source.onended = (): void => {
      this.releaseOneShot(voice);
    };
    const duration = Number.isFinite(buffer.duration) && buffer.duration > 0 ? buffer.duration : 0.2;
    source.playbackRate.setValueAtTime(rate, context.currentTime);
    source.start(context.currentTime);
    source.stop(context.currentTime + duration / rate + ONE_SHOT_TAIL_S);
    this.statsData.nodesCreated += 3;
    this.statsData.oneShotsStarted += 1;
  }

  private stopLoops(): void {
    for (const voice of this.loops) {
      for (const layer of voice.layers) {
        try {
          layer.source.stop();
        } catch {
          /* never started or already stopped */
        }
        layer.source.disconnect();
        layer.gain.disconnect();
      }
      voice.gain.disconnect();
      voice.presence?.highpass.disconnect();
      voice.presence?.lowpass.disconnect();
      voice.presence?.gain.disconnect();
      voice.panner.disconnect();
    }
    this.loops = [];
  }

  private stopOneShots(): void {
    for (const voice of [...this.oneShots]) {
      try {
        voice.source.stop();
      } catch {
        /* not started or already stopped */
      }
      this.releaseOneShot(voice);
    }
  }

  private triggerEvents(fromS: number, toS: number, listener: WebAudioListenerPose, speed: number): void {
    const timeline = this.timeline;
    if (!timeline) {
      return;
    }
    const gtaListener = listenerToGta(listener);
    for (const event of timeline.events) {
      if (event.s <= fromS || event.s > toS) {
        continue;
      }
      const trigger = timeline.frameAt(event.s, gtaListener);
      const cue = trigger.events.find((entry) => entry.eventId === event.id);
      if (cue) {
        this.startOneShot(cue.cue, gtaToEngine(event.pos[0], event.pos[1], event.pos[2]), speed);
      }
    }
  }

  private updateListener(listener: WebAudioListenerPose, context: AudioContext): void {
    const audio = context.listener;
    const forward = normalized(listener.forward);
    const up = normalized(listener.up);
    audio.positionX.value = listener.position[0];
    audio.positionY.value = listener.position[1];
    audio.positionZ.value = listener.position[2];
    audio.forwardX.value = forward[0];
    audio.forwardY.value = forward[1];
    audio.forwardZ.value = forward[2];
    audio.upX.value = up[0];
    audio.upY.value = up[1];
    audio.upZ.value = up[2];
  }

  // -------------------------------------------------------------------------------------------
  // Reverb impulses (deterministic, seeded; a modeled response, not a measurement)
  // -------------------------------------------------------------------------------------------

  private updateReverb(frame: AudioFrame, context: AudioContext): void {
    const data = this.statsData;
    data.reverbZone = frame.reverb.zone;
    data.reverbMix = frame.reverb.mix;
    const convolver = this.convolver;
    const wet = this.wet;
    if (!convolver || !wet) {
      return;
    }
    if (this.reverbZoneKey !== frame.reverb.zone) {
      this.reverbZoneKey = frame.reverb.zone;
      convolver.buffer = this.impulseFor(context, frame.reverb.zone);
    }
    wet.gain.setTargetAtTime(clampFinite(frame.reverb.mix, 0, 1), context.currentTime, 0.1);
  }
}

function clampFinite(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) {
    return low;
  }

  return Math.max(low, Math.min(high, value));
}

/** Panner config: azimuth only. Distance attenuation is the core's gain (rolloff 0 = no node attenuation). */
function configurePanner(panner: PannerNode): void {
  panner.panningModel = 'equalpower';
  panner.distanceModel = 'inverse';
  panner.refDistance = ATTENUATION_REF_DISTANCE;
  panner.maxDistance = ATTENUATION_MAX_DISTANCE;
  panner.rolloffFactor = 0;
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;
  panner.coneOuterGain = 0;
}

/** Add only the original THRUST sample's midband, keeping its 123 Hz body on the dry path. */
function createJetThrustPresence(
  context: AudioContext,
  model: number,
  role: string,
  gain: GainNode,
  panner: PannerNode,
): LoopVoice['presence'] {
  if (model !== 520 || role !== 'turbine') return null;
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = JET_THRUST_PRESENCE_HIGH_HZ;
  highpass.Q.value = Math.SQRT1_2;
  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = JET_THRUST_PRESENCE_LOW_HZ;
  lowpass.Q.value = Math.SQRT1_2;
  const presenceGain = context.createGain();
  presenceGain.gain.value = 0;
  gain.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(presenceGain);
  presenceGain.connect(panner);

  return { gain: presenceGain, highpass, lowpass };
}

/** Inverse of `gtaToEngine`: engine `[x, z, -y]` -> GTA `[x, -z, y]` (a proper rotation). */
function engineToGta(v: Vec3): Vec3 {
  return [v[0], -v[2], v[1]];
}

/** The caller's camera pose translated into the GTA axes the core's listener model is written in. */
function listenerToGta(listener: WebAudioListenerPose): AudioListener {
  return {
    forward: engineToGta(listener.forward),
    pos: engineToGta(listener.position),
    up: engineToGta(listener.up),
    velocity: engineToGta(listener.velocity),
  };
}

function normalized(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);

  return length > 1e-9 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 0];
}

function setPannerPosition(panner: PannerNode, position: Vec3): void {
  panner.positionX.value = position[0];
  panner.positionY.value = position[1];
  panner.positionZ.value = position[2];
}

// ---------------------------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------------------------

/**
 * The pak manifest carries `loopStartFrame: number | null`; the core reads a number. `null` (no loop point)
 * maps to frame 0, which is what a non-looping sample means here — this is a projection, not a measurement.
 */
function toCoreManifest(manifest: PakAudioManifest): AudioBankManifest {
  return {
    samples: manifest.samples.map((sample) => ({ ...sample, loopStartFrame: sample.loopStartFrame ?? 0 })),
    source: manifest.source ?? 'map-pak/audio/manifest.json',
    version: manifest.version,
  };
}
