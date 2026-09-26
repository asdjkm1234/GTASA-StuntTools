/** Small replay-only assets baked from the owner's GTA install alongside the map cells. */
export class PakResources {
  private readonly binaries = new Map<string, Uint8Array | null>();
  /** `models/effects.fxp`, when the pak carries it — the FX system tracks the particle lane bakes. */
  private fxText: string | null = null;
  /** `effectsPC.txd`, when the pak carries it — the sprite atlas the FX systems sample. */
  private fxTxd: Uint8Array | null = null;
  private readonly texts = new Map<string, string>();

  private constructor(private readonly base: string) {}

  static async load(base: string): Promise<PakResources> {
    const manifest = await (await fetch(`${base}/index.json`)).json() as {
      replayAssets?: { aircraft?: Record<string, string>; fx?: string[]; version?: number };
    };
    if (manifest.replayAssets?.version !== 2 ||
      !manifest.replayAssets.aircraft?.['520'] || !manifest.replayAssets.aircraft?.['476']) {
      throw new Error('预烘焙地图缺少完整的 Hydra/Rustler 贴图，请重新运行 bake-map.mts');
    }
    const resources = new PakResources(base);
    for (const name of ['timecyc.dat', 'water.dat', 'vehicles.ide', 'carcols.dat']) {
      const path = `data/${name}`;
      const response = await fetch(`${base}/${path}`);
      if (!response.ok) {
        throw new Error(`预烘焙地图缺少 ${path}，请重新运行 bake-map.mts`);
      }
      resources.texts.set(path, await response.text());
    }
    // The FX library is OPTIONAL: a pak baked before it existed (or one whose install had no effects.fxp)
    // loads fine and the replay simply draws no sprite smoke/explosions. Never fail the boot over a cosmetic.
    const fx = manifest.replayAssets?.fx ?? [];
    if (fx.includes('effects.fxp')) {
      const response = await fetch(`${base}/fx/effects.fxp`);
      if (response.ok) resources.fxText = await response.text();
    }
    if (fx.includes('effectsPC.txd')) {
      const response = await fetch(`${base}/fx/effectsPC.txd`);
      if (response.ok) resources.fxTxd = new Uint8Array(await response.arrayBuffer());
    }

    return resources;
  }

  /** The FX system definitions (`models/effects.fxp`) baked into this pak, or null when absent. */
  getFxpText(): string | null {
    return this.fxText;
  }

  /** The FX sprite dictionary (`effectsPC.txd`) baked into this pak, or null when absent. */
  getFxTxdBytes(): Uint8Array | null {
    return this.fxTxd;
  }

  getText(path: string): string | null {
    return this.texts.get(path) ?? null;
  }

  async readRaw(name: string): Promise<Uint8Array | null> {
    if (!/^[a-z0-9_]+\.(dff|txd)$/i.test(name)) return null;
    const cached = this.binaries.get(name);
    if (cached !== undefined) return cached;
    const response = await fetch(`${this.base}/aircraft/${name}`);
    const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    this.binaries.set(name, bytes);

    return bytes;
  }
}
