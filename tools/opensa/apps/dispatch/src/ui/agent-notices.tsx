/**
 * What the agent just did to this console, said on the console (201/3-05).
 *
 * The band above this says WHETHER somebody is driving the page. It could not say what they were doing, and
 * the difference is not cosmetic: `AGENT READING…` covers a camera flying somewhere on its own, the whole
 * map surface switching from 3D to a flat plan, and a picture being taken — three very different things to
 * watch happen to a phone you are holding still for somebody else. An operator seeing the view move with no
 * hand on it has no way to tell an agent's command from a defect, and that is the report this repository
 * gets: *"the map jumped"*.
 *
 * So each command raises one line as it starts, and that line settles into `done` or `failed` and then goes.
 * The wording is `describe()` in `world/agent-link.ts` — kept there, beside the switch that runs the
 * commands, so a new command cannot be added without a sentence for the person whose phone it runs on.
 *
 * Deliberately small: at most three at a time, `pointer-events: none`, and top-centre under the band, which
 * is the one strip of the map that belongs to neither the operator's tool cluster (top-left) nor the
 * turn/tilt/zoom cluster (top-right). Nothing here is a control — a notice an operator has to dismiss is a
 * notice that is in the way of the map, and the map is the product.
 */
import { type ReactElement, useEffect, useState } from 'react';

import type { AgentCommandReport } from '../world/agent-link';

import { styles } from './styles';

/** How long a settled notice stays. Long enough to read one line, short enough to be gone before the next. */
const HOLD_MS = 4000;
/** At most this many at once — a stack taller than this is covering the thing it is reporting on. */
const MAX = 3;

/** One notice on screen: the report, plus when it settled. Null while it is still running. */
interface Notice {
  readonly report: AgentCommandReport;
  readonly settledAt: null | number;
}

export function AgentNotices({ notices }: { notices: readonly AgentCommandReport[] }): null | ReactElement {
  if (notices.length === 0) {
    return null;
  }

  return (
    <div style={styles.agentNotices}>
      {notices.slice(-MAX).map((report) => (
        <div key={report.id} style={report.state === 'failed' ? styles.agentNoticeFailed : styles.agentNotice}>
          <strong>{report.what}</strong>
          {report.detail !== '' && <span style={styles.agentNoticeDetail}> — {report.detail}</span>}
          <span style={styles.agentNoticeDetail}> · {report.state}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The feed the component above renders: the live list, and the sink the link pushes into.
 *
 * A hook rather than state in the host because the expiry is the awkward half. A report arrives twice — once
 * running, once settled — under the same `id`, so the second REPLACES the first rather than stacking beside
 * it, and only the settled one starts the clock. A command that never settles (the tab is frozen, the panel
 * dies mid-answer) therefore stays on screen, which is correct: it is still what happened to this page.
 */
export function useAgentNotices(): {
  notices: readonly AgentCommandReport[];
  push: (report: AgentCommandReport) => void;
} {
  const [notices, setNotices] = useState<readonly Notice[]>([]);

  const push = (report: AgentCommandReport): void =>
    setNotices((current) => {
      const settledAt = report.state === 'running' ? null : performance.now();
      const without = current.filter((notice) => notice.report.id !== report.id);

      return [...without, { report, settledAt }].slice(-MAX);
    });

  // One interval for the whole stack rather than a timer per notice: a timer per notice is a cleanup per
  // notice, and this list is rebuilt on every push.
  useEffect(() => {
    const id = setInterval(
      () =>
        setNotices((current) => {
          const now = performance.now();
          const kept = current.filter((notice) => notice.settledAt === null || now - notice.settledAt < HOLD_MS);

          return kept.length === current.length ? current : kept;
        }),
      500,
    );

    return (): void => clearInterval(id);
  }, []);

  return { notices: notices.map((notice) => notice.report), push };
}
