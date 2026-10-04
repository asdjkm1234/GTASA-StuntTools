import { describe, expect, it } from 'vitest';

import { flowingGameHour, formatGameHour, isReplayEnvironment } from './replay-time-flow';

describe('capture-time environment clock', () => {
  it('starts at the selected hour and advances an hour per 60 seconds of recording', () => {
    const anchor = { hour: 15.25, seconds: 30 };
    expect(flowingGameHour(anchor, 30)).toBe(15.25);
    expect(flowingGameHour(anchor, 90)).toBe(16.25);
    expect(flowingGameHour(anchor, 31)).toBeCloseTo(15.25 + 1 / 60);
  });
  it('wraps midnight forward and backward while scrubbing', () => {
    const anchor = { hour: 23.5, seconds: 60 };
    expect(flowingGameHour(anchor, 120)).toBe(0.5);
    expect(flowingGameHour({ hour: 0.5, seconds: 120 }, 0)).toBe(22.5);
    expect(flowingGameHour(anchor, 60 + 24 * 60)).toBe(23.5);
  });
  it('does not depend on frame count, wall time or sampling order', () => {
    const anchor = { hour: 12, seconds: 18.25 };
    const hour = flowingGameHour(anchor, 60);
    for (const s of [0, 59.99, 120, 60, 60]) flowingGameHour(anchor, s);
    expect(flowingGameHour(anchor, 60)).toBe(hour);
  });
  it('formats minute rollover including midnight correctly', () => {
    expect(formatGameHour(12 + 59.6 / 60)).toBe('13:00');
    expect(formatGameHour(23 + 59.6 / 60)).toBe('00:00');
    expect(formatGameHour(-0.25)).toBe('23:45');
  });
  it('accepts complete snapshots and rejects invalid export clocks', () => {
    expect(isReplayEnvironment({ hour: null, timeFlow: null, weather: null })).toBe(true);
    expect(isReplayEnvironment({ hour: 23.5, timeFlow: { hour: 23.5, seconds: 30 }, weather: 10 })).toBe(true);
    for (const timeFlow of [{ hour: NaN, seconds: 0 }, { hour: 25, seconds: 0 }, { hour: 12, seconds: -1 }, 'yes'])
      expect(isReplayEnvironment({ hour: null, timeFlow, weather: 10 })).toBe(false);
  });
});
