/** Small replay-only assets baked from the owner's GTA install alongside the map cells. */
import { fetchMapPak } from './map-pak-cache';

/** The pak's audio lane manifest: where every baked sample came from in the install's GENRL banks. */
export interface PakAudioManifest {
  samples: PakAudioSample[];
  source?: string;
  version: number;
}

/** One GENRL sample as the pak's `audio/manifest.json` records it — its exact bank/slot provenance. */
export interface PakAudioSample {
  bankName: string;
  category: string;
  file: string;
  globalBankId: number;
  headroom: number;
  /** Engine samples: `jet` (Hydra turbine) or `prop` (Rustler propeller). */
  kind?: string;
  /** Engine samples: the front/rear/turbine/distance or propeller layer role this step belongs to. */
  layer?: string;
  /** Engine samples: tail->head crossfade the baker applied to make the loop seamless (`0` = none). */
  loopCrossfadeFrames?: number;
  loopStartFrame: null | number;
  /** Engine samples: the layer's relative mix (turbine is the unity reference). */
  mix?: number;
  /** Engine samples: the model (520 Hydra / 476 Rustler) this bank serves. Absent on pre-v2 paks. */
  model?: number;
  packageBankIndex: number;
  pcmBytes: number;
  /** Engine samples: why this bank is the right one for the model. */
  provenance?: string;
  /** Engine samples: the playback rate this step was baked at (1 = source pitch). */
  rate?: number;
  sampleRateHz: number;
  setSoundCount: number;
  slotId: number;
  slotName: string;
  soundIndex: number;
  /** Engine samples: the exact gta-reversed `SoundIDs.h` name of the decoded sound. */
  soundName?: string;
  /** Engine samples: the rate-step index within the model's engine table (0-based). */
  step?: number;
  wavBytes: number;
  wavFrames: number;
}

/** The `replayAssets` block of a pak's `index.json`. */
interface ReplayAssets {
  aircraft?: Record<string, string>;
  audio?: { files?: string[]; manifest?: string };
  data?: string[];
  fx?: string[];
  version?: number;
}

/** The replay-data tables every pak must carry (the baker writes the same list). */
const REPLAY_DATA_FILES = ['timecyc.dat', 'water.dat', 'vehicles.ide', 'carcols.dat', 'handling.cfg'] as const;
/** The manifest version this loader understands. An older pak lacks the audio lane and MUST be re-baked. */
const REPLAY_ASSETS_VERSION = 3;

export class PakResources {
  /** `audio/manifest.json`, when the pak carries it — the GENRL bank/slot map of the baked samples. */
  private audioManifest: null | PakAudioManifest = null;
  private readonly audioSamples = new Map<string, Uint8Array>();
  private readonly binaries = new Map<string, null | Uint8Array>();
  /** `models/effects.fxp`, when the pak carries it — the FX system tracks the particle lane bakes. */
  private fxText: null | string = null;
  /** `effectsPC.txd`, when the pak carries it — the sprite atlas the FX systems sample. */
  private fxTxd: null | Uint8Array = null;
  private readonly texts = new Map<string, string>();

  private constructor(private readonly base: string) {}

  static async load(base: string): Promise<PakResources> {
    const manifest = (await (await fetchMapPak(`${base}/index.json`)).json()) as { replayAssets?: ReplayAssets };
    const replay = manifest.replayAssets;
    if (replay?.version !== REPLAY_ASSETS_VERSION) {
      throw new Error(
        `预烘焙地图版本不受支持（replayAssets.version=${replay?.version ?? '缺失'}，本回放需要 version ${REPLAY_ASSETS_VERSION}）` +
          '：请重新运行 bake-map.mts 烘焙地图（re-bake required）',
      );
    }
    if (!replay.aircraft?.['520'] || !replay.aircraft?.['476']) {
      throw new Error('预烘焙地图缺少完整的 Hydra/Rustler 贴图，请重新运行 bake-map.mts');
    }
    const resources = new PakResources(base);
    for (const name of REPLAY_DATA_FILES) {
      const path = `data/${name}`;
      const response = await fetchMapPak(`${base}/${path}`);
      if (!response.ok) {
        throw new Error(`预烘焙地图缺少 ${path}，请重新运行 bake-map.mts`);
      }
      resources.texts.set(path, await response.text());
    }
    // The FX library is OPTIONAL: a pak baked before it existed (or one whose install had no effects.fxp)
    // loads fine and the replay simply draws no sprite smoke/explosions. Never fail the boot over a cosmetic.
    const fx = replay.fx ?? [];
    if (fx.includes('effects.fxp')) {
      const response = await fetchMapPak(`${base}/fx/effects.fxp`);
      if (response.ok) resources.fxText = await response.text();
    }
    if (fx.includes('effectsPC.txd')) {
      const response = await fetchMapPak(`${base}/fx/effectsPC.txd`);
      if (response.ok) resources.fxTxd = new Uint8Array(await response.arrayBuffer());
    }
    // The GENRL audio lane is optional for the same reason: a pak whose install had no audio still replays,
    // it just has no engine/collision/explosion samples. A v3 pak from our baker always carries them.
    await PakResources.loadAudioLane(resources, base, replay.audio);

    return resources;
  }

  /** The optional GENRL audio lane: a pak without it boots fine and simply has no synthetic samples. */
  private static async loadAudioLane(
    resources: PakResources,
    base: string,
    audio: ReplayAssets['audio'],
  ): Promise<void> {
    if (!audio?.manifest) {
      return;
    }
    const response = await fetchMapPak(`${base}/audio/${audio.manifest}`);
    if (!response.ok) {
      return;
    }
    resources.audioManifest = (await response.json()) as PakAudioManifest;
    if (resources.audioManifest.version < 8) {
      throw new Error('预烘焙音效包版本过旧：请重新运行 bake-map.mts 烘焙 Hydra 正确声源的 pak（re-bake required）');
    }
    for (const file of audio.files ?? []) {
      const sample = await fetchMapPak(`${base}/audio/${file}`);
      if (sample.ok) resources.audioSamples.set(file, new Uint8Array(await sample.arrayBuffer()));
    }
  }

  /** The GENRL audio manifest (bank/slot provenance) baked into this pak, or null when absent. */
  getAudioManifest(): null | PakAudioManifest {
    return this.audioManifest;
  }

  /** One baked GENRL sample by its manifest file name (`engine-accelerate.wav`), or null when absent. */
  getAudioSample(file: string): null | Uint8Array {
    return this.audioSamples.get(file) ?? null;
  }

  /** The FX system definitions (`models/effects.fxp`) baked into this pak, or null when absent. */
  getFxpText(): null | string {
    return this.fxText;
  }

  /** The FX sprite dictionary (`effectsPC.txd`) baked into this pak, or null when absent. */
  getFxTxdBytes(): null | Uint8Array {
    return this.fxTxd;
  }

  getText(path: string): null | string {
    return this.texts.get(path) ?? null;
  }

  async readRaw(name: string): Promise<null | Uint8Array> {
    if (!/^\w+\.(?:dff|txd)$/i.test(name)) return null;
    const cached = this.binaries.get(name);
    if (cached !== undefined) return cached;
    const response = await fetchMapPak(`${this.base}/aircraft/${name}`);
    const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    this.binaries.set(name, bytes);

    return bytes;
  }
}
