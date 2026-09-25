/** Small replay-only assets baked from the owner's GTA install alongside the map cells. */
export class PakResources {
  private readonly binaries = new Map<string, Uint8Array | null>();
  private readonly texts = new Map<string, string>();

  private constructor(private readonly base: string) {}

  static async load(base: string): Promise<PakResources> {
    const manifest = await (await fetch(`${base}/index.json`)).json() as {
      replayAssets?: { aircraft?: Record<string, string>; version?: number };
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

    return resources;
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
