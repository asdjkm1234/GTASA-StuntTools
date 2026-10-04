import { describe, expect, it } from 'vitest';

import type { TimerGl } from './gpu-timer';

import { GpuTimer } from './gpu-timer';

const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;
const TIME_ELAPSED = 0x88bf;
const GPU_DISJOINT = 0x8fbb;

interface FakeQuery {
  ready: boolean;
  resultNs: number;
}

/** A fake WebGL2 context tracking issued timer queries; tests mark them ready with a result. */
function fakeGl(options: { extension?: boolean } = {}): {
  disjoint: { value: boolean };
  gl: TimerGl;
  issued: FakeQuery[];
  live(): number;
} {
  const disjoint = { value: false };
  const issued: FakeQuery[] = [];
  let deleted = 0;
  const gl: TimerGl = {
    beginQuery: () => undefined,
    createQuery: () => {
      const query: FakeQuery = { ready: false, resultNs: 0 };
      issued.push(query);

      return query;
    },
    deleteQuery: () => {
      deleted += 1;
    },
    endQuery: () => undefined,
    getExtension: (name) =>
      (options.extension ?? true) && name === 'EXT_disjoint_timer_query_webgl2'
        ? { GPU_DISJOINT_EXT: GPU_DISJOINT, TIME_ELAPSED_EXT: TIME_ELAPSED }
        : null,
    getParameter: (pname) => (pname === GPU_DISJOINT ? disjoint.value : null),
    getQueryParameter: (query, pname) => {
      const fake = query as unknown as FakeQuery;
      if (pname === QUERY_RESULT_AVAILABLE) {
        return fake.ready;
      }
      if (pname === QUERY_RESULT) {
        return fake.resultNs;
      }

      return null;
    },
  };

  return { disjoint, gl, issued, live: () => issued.length - deleted };
}

describe('GpuTimer', () => {
  describe('negative cases', () => {
    it('is unavailable and inert without the extension', () => {
      const fake = fakeGl({ extension: false });
      const timer = GpuTimer.create(fake.gl);
      timer.enabled = true;
      timer.begin('frame');
      timer.end();
      timer.poll();
      expect(timer.available).toBe(false);
      expect(timer.timings().size).toBe(0);
      expect(fake.live()).toBe(0);
    });

    it('issues no queries while disabled', () => {
      const fake = fakeGl();
      const timer = GpuTimer.create(fake.gl);
      timer.begin('frame');
      timer.end();
      expect(fake.live()).toBe(0);
    });

    it('ignores a nested begin (single active scope)', () => {
      const fake = fakeGl();
      const timer = GpuTimer.create(fake.gl);
      timer.enabled = true;
      timer.begin('outer');
      timer.begin('inner'); // ignored — the extension forbids nesting
      timer.end();
      expect(fake.live()).toBe(1);
    });

    it('keeps a not-yet-available head query pending (in-order results)', () => {
      const fake = fakeGl();
      const timer = GpuTimer.create(fake.gl);
      timer.enabled = true;
      timer.begin('frame');
      timer.end();
      timer.poll(); // not ready yet
      expect(timer.timings().size).toBe(0);
      expect(fake.live()).toBe(1);
    });

    it('discards all in-flight queries on a disjoint interval', () => {
      const fake = fakeGl();
      const timer = GpuTimer.create(fake.gl);
      timer.enabled = true;
      timer.begin('frame');
      timer.end();
      fake.disjoint.value = true;
      timer.poll();
      expect(timer.timings().size).toBe(0);
      expect(fake.live()).toBe(0); // deleted, not leaked
    });
  });

  describe('positive cases', () => {
    it('resolves a finished query into a labelled millisecond timing', () => {
      const fake = fakeGl();
      const timer = GpuTimer.create(fake.gl);
      timer.enabled = true;
      timer.begin('frame');
      timer.end();
      fake.issued[0].ready = true;
      fake.issued[0].resultNs = 4_000_000; // 4 ms
      timer.poll();
      expect(timer.timings().get('frame')).toBeCloseTo(4, 5);
      expect(fake.live()).toBe(0);
    });

    it('EMA-smooths repeated samples of the same label', () => {
      const fake = fakeGl();
      const timer = GpuTimer.create(fake.gl);
      timer.enabled = true;
      for (const ns of [2_000_000, 4_000_000]) {
        timer.begin('frame');
        timer.end();
        const query = fake.issued[fake.issued.length - 1];
        if (query) {
          query.ready = true;
          query.resultNs = ns;
        }
        timer.poll();
      }
      // first sample seeds 2 ms; second blends toward 4 ms by alpha 0.3 → 2.6 ms
      expect(timer.timings().get('frame')).toBeCloseTo(2.6, 5);
    });
  });
});
