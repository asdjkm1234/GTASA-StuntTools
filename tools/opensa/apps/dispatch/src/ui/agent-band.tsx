/**
 * "Somebody else is holding your phone" — the console saying, on itself, what the panel link is doing to it.
 *
 * This exists because of a device fact rather than a design one. Android freezes a tab that is not in front:
 * the map stops polling, the panel calls it detached after 15 s, and a command already handed over is never
 * answered (measured 2026-08-28 — two screenshots died that way, minutes after a snapshot had gone through).
 * So while an agent reads this console the operator has to hold still, and before this band the only way to
 * learn that the run was over was to ask the agent in a chat and be told.
 *
 * Four states and one job each: `held` says do not leave, `busy` says something is being answered right
 * now, `released` says the phone is yours again — which is the one the operator is actually waiting for, so
 * it is the accent rather than the warning, and it buzzes the device where the browser allows it — and
 * `offline` says the panel has stopped answering.
 *
 * **`offline` is why this band is a READING rather than a caption** (201/3-05). It used to show three states
 * that were only ever entered on a poll that succeeded, so a panel that died left `AGENT ATTACHED — keep
 * this tab in front` on screen indefinitely: a true statement about the past, printed as if it were the
 * present, in front of somebody who was holding their phone still because of it. Every state now carries
 * when the panel last answered, and the band counts that age up on screen so a link that has stopped moving
 * is visible as one rather than inferred.
 */
import { type ReactElement, useEffect, useState } from 'react';

import type { AgentStatus } from '../world/agent-link';

import { styles } from './styles';

/** Long enough to feel deliberate against a notification's single tick, short enough not to read as an alarm. */
const RELEASE_BUZZ_MS = [120, 60, 120];
/** How often the age on screen is recomputed. A second: the unit it is printed in. */
const TICK_MS = 1000;

export function AgentBand({ compact, status }: { compact: boolean; status: AgentStatus }): ReactElement {
  const done = status.activity === 'released';
  const lost = status.activity === 'offline';

  // Best effort by nature: `navigator.vibrate` needs the page to have been interacted with in some browsers,
  // and a page an agent opened may never have been touched at all. The band is the signal that always works;
  // this is the one that reaches a phone lying face down.
  useEffect(() => {
    if (!done) {
      return;
    }
    try {
      navigator.vibrate?.(RELEASE_BUZZ_MS);
    } catch {
      // A browser that refuses to buzz is not a reason to stop showing the line that says the run is over.
    }
  }, [done]);

  return (
    <div style={bandStyle(status.activity)}>
      {label(status, compact)}
      {lost && <LinkAge since={status.contactAt} />}
    </div>
  );
}

function bandStyle(activity: AgentStatus['activity']): Record<string, unknown> {
  if (activity === 'released') {
    return { ...styles.agentBand, ...styles.agentBandDone };
  }

  return activity === 'offline' ? { ...styles.agentBand, ...styles.agentBandLost } : styles.agentBand;
}

/** What the band reads. Shorter on a phone — the same sentence, not a second component. */
function label(status: AgentStatus, compact: boolean): string {
  switch (status.activity) {
    case 'busy':
      return compact ? 'AGENT READING…' : 'AGENT READING THIS CONSOLE…';
    case 'offline':
      return compact ? 'LINK LOST' : 'LINK LOST — the panel has stopped answering';
    case 'released':
      return status.note === ''
        ? compact
          ? 'DONE — you can switch away'
          : 'DONE — the agent has finished, you can switch away'
        : `DONE — ${status.note}`;
    default:
      return compact ? 'AGENT ATTACHED — keep this tab in front' : 'AN AGENT IS ATTACHED — keep this tab in front';
  }
}

/**
 * How long ago the panel last answered, counted up on screen.
 *
 * Its own component so the tick re-renders one span rather than the band, and — the reason it exists at all
 * — so the number cannot be a value someone rendered once: a stopped clock and a live one look the same
 * until one of them moves.
 */
function LinkAge({ since }: { since: number }): ReactElement {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), TICK_MS);

    return (): void => clearInterval(id);
  }, []);

  return <span> · {Math.max(0, Math.round((now - since) / 1000))}s ago</span>;
}
