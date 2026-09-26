import type { FlightTrack } from './csv';

/** Keeps a recorder WAV aligned to replay time; older CSVs simply play silently. */
export class ReplayAudio {
  private readonly element = new Audio();
  private readonly sources = new WeakMap<FlightTrack, string>();
  private selected: FlightTrack | null = null;
  private available = false;
  private pendingSeek = 0;

  constructor() {
    this.element.preload = 'auto';
    this.element.preservesPitch = true;
    this.element.addEventListener('error', () => { this.available = false; });
    this.element.addEventListener('loadedmetadata', () => {
      this.available = true;
      this.seek(this.pendingSeek);
    });
  }

  attach(track: FlightTrack, source: string): void {
    this.sources.set(track, source);
    if (this.selected === track) this.select(track, this.element.currentTime);
  }

  select(track: FlightTrack, seconds: number): void {
    this.element.pause();
    this.selected = track;
    this.available = false;
    this.pendingSeek = seconds;
    const source = this.sources.get(track);
    if (!source) {
      this.element.removeAttribute('src');
      this.element.load();
      return;
    }
    this.element.src = source;
    this.element.load();
    this.seek(seconds);
  }

  seek(seconds: number): void {
    if (!this.element.src) return;
    const target = Math.max(0, seconds);
    this.pendingSeek = target;
    try { this.element.currentTime = target; } catch { /* metadata has not loaded yet */ }
  }

  sync(playing: boolean, speed: number, seconds: number): void {
    if (!this.element.src) return;
    this.element.playbackRate = speed;
    if (!playing) {
      this.element.pause();
      if (Math.abs(this.element.currentTime - seconds) > 0.04) this.seek(seconds);
      return;
    }
    if (Math.abs(this.element.currentTime - seconds) > 0.12) this.seek(seconds);
    if (this.element.paused) void this.element.play().catch(() => { /* browser needs a user gesture */ });
  }

  get hasAudio(): boolean { return this.available; }
  sourceFor(track: FlightTrack): string | undefined { return this.sources.get(track); }
  get muted(): boolean { return this.element.muted; }
  set muted(value: boolean) { this.element.muted = value; }
}
