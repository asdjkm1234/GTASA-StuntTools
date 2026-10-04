/** Browser-owned map storage. Cache misses use ordinary compressed HTTP; GPU uploads are unchanged. */
export interface MapCacheFile {
  bytes: number;
  path: string;
  sha256: string;
}
export interface MapCacheManifest {
  files: MapCacheFile[];
  schema: 1;
  version: string;
}
export interface MapCacheState {
  bytes: number;
  files: number;
  persistent: boolean;
  phase: 'interrupted' | 'limited' | 'paused' | 'ready' | 'saving' | 'unavailable';
  savedBytes: number;
  savedFiles: number;
}
const CACHE_NAME = 'gtasa-replay-map-v1';
const CACHE_PATH = '/__gtasa_replay_map_cache__/';

/** Two network transfers overall; foreground map/export requests precede background saving. */
class DownloadQueue {
  private running = 0;
  private readonly waiting: { background: boolean; key: string; run: () => void }[] = [];
  add<T>(job: () => Promise<T>, background: boolean, key: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        background,
        key,
        run: () => {
          this.running++;
          void job()
            .then(resolve, reject)
            .finally(() => {
              this.running--;
              this.drain();
            });
        },
      });
      this.drain();
    });
  }
  promote(key: string): void {
    const job = this.waiting.find((item) => item.key === key);
    if (job) job.background = false;
  }
  private drain(): void {
    while (this.running < 2 && this.waiting.length) {
      const foreground = this.waiting.findIndex((item) => !item.background);
      this.waiting.splice(foreground < 0 ? 0 : foreground, 1)[0].run();
    }
  }
}

export class MapPakCache {
  get state(): MapCacheState {
    const files = [...this.files.values()];

    return {
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files: files.length,
      persistent: this.persistent,
      phase:
        !this.cache || !this.manifest
          ? 'unavailable'
          : this.saved.size === files.length
            ? 'ready'
            : (this.failure ?? (this.paused ? 'paused' : 'saving')),
      savedBytes: files.reduce((sum, file) => sum + (this.saved.has(file.path) ? file.bytes : 0), 0),
      savedFiles: this.saved.size,
    };
  }
  private readonly baseUrl: URL;
  private cache: Cache | null = null;
  private readonly downloads = new DownloadQueue();
  private failure: 'interrupted' | 'limited' | null = null;
  private readonly files = new Map<string, MapCacheFile>();
  private readonly foreground = new Set<string>();
  private generation = 0;
  private manifest: MapCacheManifest | null = null;
  private readonly metadataKey: string;
  private readonly origin = location.origin;
  private paused = true;
  private readonly pending = new Map<string, Promise<Response>>();
  private persistent = false;
  private readonly saved = new Set<string>();
  private saving = false;

  private writable = true;
  private constructor(
    private readonly base: string,
    private readonly changed: (state: MapCacheState) => void,
  ) {
    this.baseUrl = new URL(base.replace(/\/$/, '') + '/', this.origin);
    this.metadataKey = this.origin + CACHE_PATH + 'manifest-' + encodeURIComponent(this.baseUrl.pathname);
  }
  static async open(
    base: string,
    changed: (state: MapCacheState) => void = () => {
      /* Status is optional. */
    },
  ): Promise<MapPakCache> {
    const source = new MapPakCache(base, changed);
    await source.initialize();

    return source;
  }
  async clear(): Promise<void> {
    this.pause();
    this.generation++;
    this.writable = true;
    this.failure = null;
    if (this.cache) {
      await caches.delete(CACHE_NAME);
      this.cache = await caches.open(CACHE_NAME);
      if (this.manifest) await this.cache.put(this.metadataKey, new Response(JSON.stringify(this.manifest)));
    }
    this.saved.clear();
    this.emit();
  }
  async fetch(input: string, background = false): Promise<Response> {
    const url = new URL(input, this.origin);
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith(this.baseUrl.pathname)) return fetch(input);
    const relative = decodeURIComponent(url.pathname.slice(this.baseUrl.pathname.length));
    const file = this.files.get(relative);
    if (!file) return fetch(input);
    if (!background) {
      this.foreground.add(relative);
      this.downloads.promote(relative);
    }
    const existing = this.pending.get(relative);
    if (existing) return (await existing).clone();
    const task = this.read(file, url, background);
    this.pending.set(relative, task);
    try {
      return (await task).clone();
    } finally {
      if (this.pending.get(relative) === task) {
        this.pending.delete(relative);
        this.foreground.delete(relative);
      }
    }
  }
  pause(): void {
    this.paused = true;
    this.emit();
  }
  async requestPersistence(): Promise<void> {
    try {
      this.persistent = (await navigator.storage?.persist()) ?? false;
      this.emit();
    } catch {
      /* The browser decides. */
    }
  }
  resume(): void {
    if (!this.cache || !this.manifest || !this.writable) return;
    this.paused = false;
    this.failure = null;
    this.emit();
    if (!this.saving) void this.saveAll();
  }
  private emit(): void {
    this.changed(this.state);
  }
  private async initialize(): Promise<void> {
    try {
      this.cache = await caches.open(CACHE_NAME);
    } catch {
      this.cache = null;
    }
    let current: unknown;
    try {
      const response = await fetch(this.baseUrl.href + 'cache-manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Map manifest unavailable');
      current = await response.json();
      if (!validManifest(current)) throw new Error('Invalid map manifest');
    } catch {
      try {
        current = await (await this.cache?.match(this.metadataKey))?.json();
      } catch {
        /* Unavailable storage has a network fallback. */
      }
    }
    if (!validManifest(current)) {
      this.emit();

      return;
    }
    this.manifest = current;
    for (const file of current.files) this.files.set(file.path, file);
    await this.reconcileCache(current);
    this.emit();
  }
  private key(file: MapCacheFile): string {
    return this.origin + CACHE_PATH + file.sha256;
  }
  private async read(file: MapCacheFile, url: URL, background: boolean): Promise<Response> {
    const generation = this.generation;
    const hit = await this.cache?.match(this.key(file)).catch(() => undefined);
    if (hit) {
      if (generation === this.generation) this.saved.add(file.path);

      return hit;
    }
    this.saved.delete(file.path);

    return this.downloads.add(
      async () => {
        // A foreground read may have completed while a background item was waiting.
        const stored = await this.cache?.match(this.key(file)).catch(() => undefined);
        if (stored) {
          if (generation === this.generation) this.saved.add(file.path);

          return stored;
        }
        url.searchParams.set('v', file.sha256);
        const response = await fetch(url.href, { cache: 'no-store' });
        if (!response.ok)
          throw new Error(response.status === 409 ? '地图已更新，请刷新页面。' : `地图下载失败 (${response.status})`);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
        if (bytes.byteLength !== file.bytes || sha256 !== file.sha256) throw new Error('地图文件校验失败，请重试。');
        // HTTP decompresses before JS receives the bytes. Store a decoded response without encoded headers.
        const result = new Response(bytes, {
          headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream' },
        });
        if (this.cache && this.writable && generation === this.generation) {
          try {
            await this.cache.put(this.key(file), result.clone());
            this.saved.add(file.path);
          } catch {
            this.writable = false;
            this.failure = 'limited';
            this.paused = true;
          }
        }
        this.emit();

        return result;
      },
      background && !this.foreground.has(file.path),
      file.path,
    );
  }
  private async reconcileCache(current: MapCacheManifest): Promise<void> {
    if (this.cache) {
      try {
        const keys = new Set((await this.cache.keys()).map((request) => request.url));
        for (const file of current.files) if (keys.has(this.key(file))) this.saved.add(file.path);
        await this.cache.put(
          this.metadataKey,
          new Response(JSON.stringify(current), { headers: { 'Content-Type': 'application/json' } }),
        );
        // Keep common content across map versions; remove superseded files only after a valid manifest.
        const keep = new Set(current.files.map((file) => this.key(file)));
        keep.add(this.metadataKey);
        for (const key of keys) if (!keep.has(key)) await this.cache.delete(key);
      } catch {
        this.writable = false;
        this.failure = 'limited';
      }
      try {
        this.persistent = (await navigator.storage?.persisted()) ?? false;
      } catch {
        /* Best-effort storage remains usable. */
      }
    }
  }
  private async saveAll(): Promise<void> {
    this.saving = true;
    const generation = this.generation;
    try {
      // One background file at a time leaves a transfer slot for playback and export.
      for (const file of this.files.values()) {
        if (this.paused || generation !== this.generation) break;
        if (!this.saved.has(file.path)) await this.fetch(new URL(file.path, this.baseUrl).href, true);
      }
    } catch {
      this.paused = true;
      this.failure = 'interrupted';
    } finally {
      this.saving = false;
      this.emit();
      if (!this.paused && this.writable && !this.failure && this.saved.size < this.files.size) void this.saveAll();
    }
  }
}

function validManifest(value: unknown): value is MapCacheManifest {
  const data = value as MapCacheManifest | null;
  if (
    !data ||
    data.schema !== 1 ||
    !/^[a-f0-9]{64}$/.test(data.version) ||
    !Array.isArray(data.files) ||
    data.files.length === 0
  )
    return false;
  const paths = new Set<string>();
  for (const file of data.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      !/^[\w./-]+$/.test(file.path) ||
      file.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      paths.has(file.path)
    )
      return false;
    paths.add(file.path);
  }

  return paths.has('index.json');
}

let active: MapPakCache | null = null;
export function fetchMapPak(url: string): Promise<Response> {
  return active ? active.fetch(url) : fetch(url);
}
export async function initializeMapPakCache(
  base: string,
  changed: (state: MapCacheState) => void,
): Promise<MapPakCache> {
  active?.pause();
  active = await MapPakCache.open(base, changed);

  return active;
}
