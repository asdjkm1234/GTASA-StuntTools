import { describe, expect, it, vi } from 'vitest';

import { MapBus } from './remote.mjs';

/** A bus whose clock the test owns, so "attached" is a decision rather than a race. */
function bus(start = 1000) {
  let now = start;

  return { at: (ms) => (now = ms), bus: new MapBus({ now: () => now }) };
}

/**
 * Attach a page the way the real loop does: its first poll parks, one command wakes it, and the page is then
 * "between polls" — which is the state a second command has to queue in.
 */
async function deliver(board, parked, kind) {
  void board.submit({ kind });

  return await parked;
}

describe('MapBus', () => {
  describe('negative cases', () => {
    it('refuses a command when no map has ever polled, and says how to attach one', async () => {
      const answer = await new MapBus().submit({ kind: 'snapshot' });

      expect(answer.ok).toBe(false);
      expect(answer.error).toContain('agent=1');
    });

    it('treats a page that stopped polling as gone — a locked phone is not an attached map', async () => {
      const clock = bus();
      void clock.bus.take({ page: { url: 'x' } });
      clock.at(1000 + 60_000);

      expect(clock.bus.attached().attached).toBe(false);
      expect((await clock.bus.submit({ kind: 'snapshot' })).ok).toBe(false);
    });

    it('gives up on a command the map took but never answered, naming which end went quiet', async () => {
      vi.useFakeTimers();
      try {
        const board = new MapBus();
        void board.take({ page: { url: 'x' } });
        const pending = board.submit({ kind: 'screenshot', timeoutMs: 50 });
        await vi.advanceTimersByTimeAsync(60);
        const answer = await pending;

        expect(answer.ok).toBe(false);
        expect(answer.error).toContain('never answered');
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores an answer to a command nobody is waiting for — a late reply is not news', () => {
      expect(new MapBus().settle(99, { ok: true }).accepted).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('hands a command asked for BETWEEN polls to the poll that comes next', async () => {
      // The real sequence: the page is attached and away answering something, so nothing is parked. A
      // command asked for now must wait in the queue rather than be lost.
      const board = new MapBus();
      const parked = board.take({ page: { url: 'x' } });
      board.settle((await deliver(board, parked, 'warmup')).id, { ok: true });
      const asked = board.submit({ kind: 'snapshot' });
      const command = await board.take({ page: { url: 'x' } });

      expect(command).toMatchObject({ args: {}, kind: 'snapshot' });
      board.settle(command.id, { ok: true, value: { fps: 41 } });

      expect(await asked).toEqual({ ok: true, value: { fps: 41 } });
    });

    it('wakes a poll that is already waiting, instead of making it time out first', async () => {
      // The common case, and the one that makes the link feel immediate: the page is parked on its poll
      // when the command arrives, so it is handed over rather than queued for the next twenty seconds.
      const board = new MapBus();
      const parked = board.take({ page: { url: 'x' } });
      const asked = board.submit({ kind: 'errors' });
      const command = await parked;

      expect(command.kind).toBe('errors');
      board.settle(command.id, { ok: true, value: [] });
      await expect(asked).resolves.toEqual({ ok: true, value: [] });
    });

    it('carries the page heartbeat, so an agent can see what the map is showing', async () => {
      const clock = bus();
      void clock.bus.take({ page: { fps: 33, mode: 'live', url: 'http://localhost:3001/dispatch.html?agent=1' } });

      expect(clock.bus.attached()).toMatchObject({ attached: true, page: { fps: 33, mode: 'live' } });
    });

    it('keeps commands in order when several are asked for between polls', async () => {
      const board = new MapBus();
      const parked = board.take({ page: { url: 'x' } });
      board.settle((await deliver(board, parked, 'warmup')).id, { ok: true });
      void board.submit({ kind: 'first' });
      void board.submit({ kind: 'second' });

      expect((await board.take({})).kind).toBe('first');
      expect((await board.take({})).kind).toBe('second');
    });
  });
});
