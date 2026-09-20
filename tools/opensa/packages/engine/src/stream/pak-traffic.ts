/**
 * What a running surface actually READS out of the pak (plan 201/1-01, the bytes column).
 *
 * The build's own `report.json` says what a pak CONTAINS. Nothing said what a frame of a given surface asks
 * for, and the gap between those two is the whole premise of the map profile: an entry kind nobody requests
 * is a candidate for omission, and one requested a thousand times is not, whatever it costs.
 *
 * Every pak read is one `postMessage` to the IO worker, so accounting belongs at that call — which is why
 * this module owns {@link postPakFetch} rather than only a counter. Four call sites post one (the eager
 * texture load at setup, the streamer's cell and array requests, the collision source), and routing them
 * through one function is what keeps a fifth from being added without being counted.
 *
 * The bytes recorded are WIRE bytes — the range each request pulls, before the worker inflates a
 * `deflate-raw` entry. That is what the network carried and what a `Range:` server billed; the decoded size
 * is a property of the entry, not of the traffic, and the manifest already carries it.
 *
 * The recorder is shared, for the same reason `frameSpans` is: it is an instrument rather than state, and
 * the three packages that read a pak do not own each other.
 *
 * Since 201/4-03 a read can be served from a cache instead of the network, and the recorder counts that
 * separately rather than instead: the bytes the WORLD asked for do not change because they were already on
 * the disk. `cachedBytes` against `totalBytes` is how a capture proves the cache is working — which on a
 * phone is the only way to see it at all. It means **what did not cross the wire**, not one cache: pak
 * slices come from Cache Storage, and `water.bin` — a loose file the slice cache never sees — reports the
 * browser's own HTTP cache through Resource Timing.
 */

/** One entry kind's traffic over the window. */
export interface PakTrafficKind {
  readonly bytes: number;
  readonly kind: string;
  readonly requests: number;
}

export class PakTraffic {
  /** Wire bytes that did not cross the network — a subset of {@link totalBytes}, never an addition to it. */
  get cachedBytes(): number {
    return this.fromCacheBytes;
  }
  /** Requests that did not cross the network — a subset of {@link requests}. */
  get cachedRequests(): number {
    return this.fromCacheRequests;
  }
  get requests(): number {
    return this.totalRequests;
  }
  get totalBytes(): number {
    return this.bytes;
  }
  private bytes = 0;
  private fromCacheBytes = 0;
  private fromCacheRequests = 0;
  private readonly kinds = new Map<string, { bytes: number; requests: number }>();
  private totalRequests = 0;

  /** One request, keyed as the worker keys it. */
  record(key: string, bytes: number): void {
    const kind = kindOfPakKey(key);
    const entry = this.kinds.get(kind) ?? { bytes: 0, requests: 0 };
    entry.bytes += bytes;
    entry.requests += 1;
    this.kinds.set(kind, entry);
    this.bytes += bytes;
    this.totalRequests += 1;
  }

  /** One request a cache answered instead of the network — the range cache, or the browser's own HTTP cache
   *  for a loose file beside the pak. Its bytes were already counted by {@link record}. */
  recordCacheHit(bytes: number): void {
    this.fromCacheBytes += bytes;
    this.fromCacheRequests += 1;
  }

  /** Descending by bytes, so the table reads top-down. Empty when nothing was read. */
  report(): readonly PakTrafficKind[] {
    return [...this.kinds.entries()]
      .map(([kind, entry]) => ({ bytes: entry.bytes, kind, requests: entry.requests }))
      .sort((a, b) => b.bytes - a.bytes);
  }

  /** Start again — for a host that measures one phase at a time. Nothing calls it in a normal run. */
  reset(): void {
    this.kinds.clear();
    this.bytes = 0;
    this.fromCacheBytes = 0;
    this.fromCacheRequests = 0;
    this.totalRequests = 0;
  }
}

/**
 * The kind a request key belongs to, for a table an operator reads rather than a list of 400 keys.
 *
 * Cell keys are `x,y,level` (`5,-7,hd`), texture arrays are `array-N`, collision is `collision-x,y`.
 * Anything else is reported under its own name, which is deliberate: a new entry kind should appear in the
 * table by itself rather than be folded into an `other` bucket nobody investigates.
 */
export function kindOfPakKey(key: string): string {
  if (key.startsWith('array-')) {
    return 'texture-array';
  }
  if (key.startsWith('collision-')) {
    return 'collision';
  }
  const parts = key.split(',');
  if (parts.length === 3 && parts[2] !== '') {
    return `cell-${parts[2]}`;
  }

  return key;
}

/** The one recorder a running surface reports into — see the note above on why it is shared. */
export const pakTraffic = new PakTraffic();

/**
 * Request one pak entry AND count it. The only way the worker is asked for bytes.
 *
 * Callers pass the manifest entry rather than its fields so a new field (a wire encoding, a checksum) reaches
 * the worker by being in the entry, not by being remembered at four call sites.
 */
export function postPakFetch(
  worker: { postMessage(message: unknown): void },
  key: string,
  entry: { enc?: string; length: number; offset: number },
): void {
  pakTraffic.record(key, entry.length);
  worker.postMessage({
    ...(entry.enc !== undefined ? { enc: entry.enc } : {}),
    key,
    length: entry.length,
    offset: entry.offset,
    type: 'fetch',
  });
}
