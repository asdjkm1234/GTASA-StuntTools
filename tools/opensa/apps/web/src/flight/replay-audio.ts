import type { FlightTrack } from './csv';

/** Keeps a recorder WAV aligned to replay time; older CSVs simply play silently. */
export class ReplayAudio {
  /** Read-only probe for the replay-audio acceptance test; the element keeps its own clock. */
  get currentTime(): number {
    return this.element.currentTime;
  }
  get hasAudio(): boolean {
    return this.available;
  }
  get muted(): boolean {
    return this.element.muted;
  }
  set muted(value: boolean) {
    this.element.muted = value;
  }
  get paused(): boolean {
    return this.element.paused;
  }

  get playbackRate(): number {
    return this.element.playbackRate;
  }

  private available = false;

  private readonly element = new Audio();

  private pendingSeek = 0;

  private selected: FlightTrack | null = null;

  private readonly sources = new WeakMap<FlightTrack, string>();
  constructor() {
    this.element.preload = 'auto';
    this.element.preservesPitch = true;
    this.element.addEventListener('error', () => {
      this.available = false;
    });
    this.element.addEventListener('loadedmetadata', () => {
      this.available = true;
      this.seek(this.pendingSeek);
    });
  }
  attach(track: FlightTrack, source: string): void {
    this.sources.set(track, source);
    if (this.selected === track) this.select(track, this.element.currentTime);
  }
  seek(seconds: number): void {
    if (!this.element.src) return;
    const target = Math.max(0, seconds);
    this.pendingSeek = target;
    try {
      this.element.currentTime = target;
    } catch {
      /* metadata has not loaded yet */
    }
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
  sourceFor(track: FlightTrack): string | undefined {
    return this.sources.get(track);
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
    if (this.element.paused)
      void this.element.play().catch(() => {
        /* browser needs a user gesture */
      });
  }
}
