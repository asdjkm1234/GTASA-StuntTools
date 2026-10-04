export interface ReplayEnvironment {
  hour: null | number;
  timeFlow: null | ReplayTimeFlow;
  weather: null | number;
}

/** A capture-time clock: 60 seconds of recording advance one game hour. */
export interface ReplayTimeFlow {
  hour: number;
  seconds: number;
}

export function flowingGameHour(anchor: ReplayTimeFlow, seconds: number): number {
  return normalizeGameHour(anchor.hour + (seconds - anchor.seconds) / 60);
}

export function formatGameHour(hour: number): string {
  const minute = Math.round(normalizeGameHour(hour) * 60) % 1440;

  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** Validate the environment snapshot carried to the separate export renderer. */
export function isReplayEnvironment(value: unknown): value is ReplayEnvironment {
  if (!value || typeof value !== 'object') return false;
  const env = value as ReplayEnvironment;
  const finite = (number: unknown, max: number): boolean =>
    typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= max;

  return (
    (env.hour === null || finite(env.hour, 24)) &&
    (env.weather === null || finite(env.weather, 22)) &&
    (env.timeFlow === null ||
      (typeof env.timeFlow === 'object' && finite(env.timeFlow.hour, 24) && finite(env.timeFlow.seconds, 7200)))
  );
}

export function normalizeGameHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}
