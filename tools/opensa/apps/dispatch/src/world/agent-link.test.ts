/**
 * The status half of the link, which is the half an OPERATOR reads.
 *
 * The rest of this module is exercised by driving a real page from the panel; what a test has to hold is the
 * part that is silent when it is wrong. A band that claims an agent is attached when no panel answered would
 * tell somebody to hold their phone still for nothing, and a release that stopped sticking would flip them
 * back to "hold still" on the panel's very next idle poll — both look like a working console.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentCommandReport, AgentStatus, AgentSurface } from './agent-link';

import { describeCommand, startAgentLink } from './agent-link';

/** A surface that answers everything with nothing: this suite is about the link, not the console. */
const SURFACE: AgentSurface = {
  errors: (): readonly string[] => [],
  image: (): Promise<Blob | null> => Promise.resolve(null),
  inventory: (): unknown => null,
  mode: () => null,
  moveTo: (): void => undefined,
  ops: (): unknown => null,
  readout: (): unknown => null,
  setMode: (): void => undefined,
};

/** One instruction, as the panel hands it over. */
interface Queued {
  readonly args?: Record<string, unknown>;
  readonly kind: string;
}

/** What the operator would be looking at when the loop stopped — a status, or the last command reported. */
function last<T>(seen: readonly T[]): T | undefined {
  return seen[seen.length - 1];
}

/**
 * A panel that hands out `commands` in order and then stays quiet, the way a real long-poll does when nobody
 * is asking for anything. With `diesAfter`, its polls start REFUSING at that index — the server restarting,
 * the tunnel dropping, Termux being killed, which is the case the band used to keep quiet about.
 */
function panel(commands: readonly Queued[], diesAfter = Number.POSITIVE_INFINITY): typeof fetch {
  let next = 0;

  return vi.fn((input: unknown): Promise<unknown> => {
    if (String(input).includes('/api/map/poll')) {
      if (next >= diesAfter) {
        return Promise.reject(new Error('connection refused'));
      }
      const command = commands[next];
      next += 1;

      return Promise.resolve({
        json: () => Promise.resolve({ command: command ? { args: {}, id: next, ...command } : null }),
        ok: true,
      });
    }

    return Promise.resolve({ json: () => Promise.resolve({ accepted: true }), ok: true });
  }) as unknown as typeof fetch;
}

/** Let the link's loop run until it has settled — every hop in it is a resolved promise, never a timer. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { location: { href: 'http://localhost:3001/dispatch.html?agent=1' } });
});

describe('startAgentLink', () => {
  describe('negative cases', () => {
    it('reports nothing at all while no panel answers, so a shared link never claims an agent', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('connection refused'))),
      );

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(seen).toEqual([]);
    });

    it('does not fall back to "hold still" on the idle poll after a release', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal('fetch', panel([{ args: { note: 'capture filed' }, kind: 'release' }]));

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(last(seen)?.activity).toBe('released');
      expect(last(seen)?.note).toBe('capture filed');
      expect(seen.filter((status) => status.activity === 'held')).toEqual([]);
    });

    it('stops claiming the tab is held once the panel goes quiet', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal('fetch', panel([], 1));

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      // The old link reported nothing at all on a failed poll, so `held` — a true statement about a panel
      // that had since died — stayed on screen while somebody held their phone still for it.
      expect(seen.map((status) => status.activity)).toEqual(['held', 'offline']);
      // And it says WHEN, so the band can age the reading rather than print a state with no clock on it.
      expect(last(seen)?.contactAt).toBeGreaterThan(0);
    });

    it('does not read another service error page on the port as a panel answering', async () => {
      const seen: AgentStatus[] = [];
      // A 502 from a tunnel, or an HTML page from whatever else owns 8787. Parsed as JSON it becomes
      // `{ command: undefined }`, which is exactly what an idle hold looks like.
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve({ json: () => Promise.resolve({}), ok: false, status: 502 })),
      );

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(seen).toEqual([]);
    });

    it('tells the operator when a command failed on their page, not only the agent', async () => {
      const reports: AgentCommandReport[] = [];
      vi.stubGlobal('fetch', panel([{ kind: 'pose' }]));

      const link = startAgentLink('http://localhost:8787', SURFACE, undefined, (report) => reports.push(report));
      await settle();
      link.stop();

      // `pose` with no pose throws inside the page. The agent is handed the reason; so is the screen.
      expect(reports.map((report) => report.state)).toEqual(['running', 'failed']);
      expect(last(reports)?.detail).toBe('pose: no pose given');
    });
  });

  describe('positive cases', () => {
    it('says the tab is held once a panel has answered a poll', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal('fetch', panel([]));

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(seen[0]?.activity).toBe('held');
      // The reading is stamped with when the panel answered, which is what lets the band age it on screen.
      expect(seen[0]?.contactAt).toBeGreaterThan(0);
    });

    it('marks the page busy while a command is being answered', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal('fetch', panel([{ kind: 'errors' }]));

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(seen.map((status) => status.activity)).toContain('busy');
    });

    it('takes the page back when the agent asks for something after releasing it', async () => {
      const seen: AgentStatus[] = [];
      vi.stubGlobal('fetch', panel([{ kind: 'release' }, { kind: 'errors' }]));

      const link = startAgentLink('http://localhost:8787', SURFACE, (status) => seen.push(status));
      await settle();
      link.stop();

      expect(last(seen)?.activity).toBe('held');
    });

    it('reports every command twice — as it starts and as it settles — under one id', async () => {
      const reports: AgentCommandReport[] = [];
      vi.stubGlobal('fetch', panel([{ kind: 'screenshot' }]));

      const link = startAgentLink('http://localhost:8787', SURFACE, undefined, (report) => reports.push(report));
      await settle();
      link.stop();

      expect(reports.map((report) => [report.kind, report.state])).toEqual([
        ['screenshot', 'running'],
        ['screenshot', 'done'],
      ]);
      expect(new Set(reports.map((report) => report.id)).size).toBe(1);
    });
  });
});

describe('describeCommand', () => {
  describe('negative cases', () => {
    it('says a command it does not know is one, rather than printing the agent word for it', () => {
      expect(describeCommand({ args: {}, kind: 'teleport' })).toEqual({
        detail: 'teleport',
        what: 'an instruction this console does not know',
      });
    });
  });

  describe('positive cases', () => {
    it('says where the camera is being sent, because the operator watches it go', () => {
      expect(describeCommand({ args: { pose: { at: [1700.4, -1500.6], height: 900 } }, kind: 'pose' })).toEqual({
        detail: '1700, -1501 · 900 m',
        what: 'moving the camera',
      });
    });

    it('names the surface a mode switch is going to', () => {
      expect(describeCommand({ args: { mode: 'flat' }, kind: 'mode' }).detail).toBe('flat 2D map');
    });
  });
});
