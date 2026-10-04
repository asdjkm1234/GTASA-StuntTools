/**
 * The map, answerable (201 tooling / phone-console plan 002).
 *
 * The development machine is a phone with no headless browser, so everything an agent knows about this
 * console has been a person describing a screen. This closes that: with `?agent=1` the page asks the phone
 * panel for commands and answers them with what it can already produce — the inventory report, its own PNG
 * of the situation, the readout, the error log — and takes a camera or a mode instruction back.
 *
 * **It is opt-in by query, and that is not timidity.** A page that phoned home to a local port because one
 * happened to answer would be a surprise on a shared link and a wrong answer on a desk where something else
 * owns 8787. `&agent=1` is on the panel's own links; nothing else carries it.
 *
 * **The page is the instrument.** No DevTools protocol, no `adb`, no pairing — the numbers an agent wants
 * are the ones the console already computes for `?inventory=1`, and the picture is the one `exportImage`
 * already composes for a link. What this adds is a way to ask for them from somewhere else.
 *
 * Long-poll, never a socket: a phone locks, Android kills the tab, the tunnel drops. A poll that comes back
 * with nothing after twenty seconds and starts again survives all three without a reconnect protocol of its
 * own; a failure just means the next poll is a second later.
 *
 * **The page also says, on itself, whether it is currently being driven** — because on this device the
 * operator has to hold still while it is. Android freezes a tab that is not in front: the map stops polling,
 * the panel calls it detached after 15 s, and a command already handed over is never answered (measured
 * 2026-08-28, twice, on `screenshot`). So an agent's session costs somebody their phone, and until this
 * reported anything, the only way to learn it was over was to ask the agent in a chat. `onStatus` is that
 * report, and `release` is the agent saying the run is finished.
 */
import type { MapPose } from '../map/map-camera';
import type { MapMode } from './mode-switch';

/**
 * What the link is doing to this page, for the operator holding it.
 *
 * - `held` — a panel is answering and may ask at any moment, so the tab has to stay in front;
 * - `busy` — a command is being answered right now;
 * - `offline` — the panel STOPPED answering, after having answered before;
 * - `released` — the agent said it is done, and the phone is the operator's again.
 *
 * `offline` is the one that was missing, and its absence was the whole defect: a failed poll reported
 * nothing, so a panel that died — the server restarted, the tunnel dropped, Termux killed — left the band
 * saying `AGENT ATTACHED, keep this tab in front` for as long as the operator was willing to believe it.
 * The state was a claim made once and never withdrawn. It is a live reading now, and the rule that makes it
 * safe is unchanged: nothing is reported until a panel has actually answered, so a shared link with
 * `&agent=1` and nothing listening still says nothing at all.
 */
export type AgentActivity = 'busy' | 'held' | 'offline' | 'released';

/** One command, as the operator is told about it. */
export interface AgentCommandReport {
  /** What the command carried or answered with — a pose, a mode, the error it failed on. */
  readonly detail: string;
  readonly id: number;
  readonly kind: string;
  readonly state: 'done' | 'failed' | 'running';
  /** What it DOES, in words. A kind is what an agent asked for; this is what happens to the page. */
  readonly what: string;
}

/** The state, plus whatever the agent said when it let go. */
export interface AgentStatus {
  readonly activity: AgentActivity;
  /** When the panel last answered, on the monotonic clock; 0 until one has. What makes the state a reading
   *  rather than a claim: the chrome can say how old it is, and an operator can see it stop moving. */
  readonly contactAt: number;
  readonly note: string;
}

/** What the link can reach. Deliberately small: everything here already existed for something else. */
export interface AgentSurface {
  /** Every error the page logged since boot — a failure an agent must not have to be told about. */
  errors: () => readonly string[];
  /** The situation as a PNG (201/7-07's export), or null when there is no canvas to read. */
  image: () => Promise<Blob | null>;
  /** The `?inventory=1` report, or null when the collector is off. */
  inventory: () => unknown;
  /** Which surface is drawing, and how to change it (201/6-03). */
  mode: () => MapMode | null;
  /** Fly the camera to a pose, the way a bookmark does. */
  moveTo: (pose: MapPose) => void;
  /** The board as the operator has it: units, calls, the selection. */
  ops: () => unknown;
  /** The per-frame readout the chrome shows — fps, draws, resident MB, the pose. */
  readout: () => unknown;
  setMode: (mode: MapMode) => void;
}

/** One instruction from the panel. */
interface AgentCommand {
  readonly args: Record<string, unknown>;
  readonly id: number;
  readonly kind: string;
}

/** How long to wait before polling again after a failure — the panel restarting, the tunnel blinking. */
const RETRY_MS = 2000;
/**
 * How long a poll may hang before it counts as a dead link, ms.
 *
 * The panel holds a poll for 20 s and then answers with nothing (`POLL_HOLD_MS`, `remote.mjs`), so anything
 * past that is not a hold. It matters because a link does not usually die with a connection error: the
 * server stops answering while the socket stays open (a closed server keeping its keep-alives, a tunnel
 * whose far end went away, a phone that slept mid-request), and `fetch` on a hung request simply never
 * settles. Without this the `offline` state would only ever be reached on an immediate refusal — which is
 * the easy half, and the half that was already visible.
 */
const POLL_TIMEOUT_MS = 30_000;

/**
 * What a command DOES to this page, for somebody watching it happen.
 *
 * The kind is the agent's word for it and means nothing to an operator — `pose` is a map that moves by
 * itself, `mode` is the whole surface changing under them. Exported so the wording is tested rather than
 * eyeballed: this is the only sentence the person holding the phone gets.
 */
export function describeCommand(command: { args: Record<string, unknown>; kind: string }): {
  detail: string;
  what: string;
} {
  switch (command.kind) {
    case 'errors':
      return { detail: '', what: 'reading the error log' };
    case 'mode':
      return {
        detail: command.args.mode === 'flat' ? 'flat 2D map' : '3D map',
        what: 'switching the map surface',
      };
    case 'ops':
      return { detail: '', what: 'reading the board' };
    case 'pose': {
      const pose = command.args.pose as undefined | { at?: readonly number[]; height?: number };
      const at = pose?.at;

      return {
        detail:
          at === undefined
            ? ''
            : `${at[0]?.toFixed(0) ?? '?'}, ${at[1]?.toFixed(0) ?? '?'}${
                pose?.height === undefined ? '' : ` · ${pose.height.toFixed(0)} m`
              }`,
        what: 'moving the camera',
      };
    }
    case 'release':
      return { detail: noteOf(command as AgentCommand), what: 'letting go of this console' };
    case 'screenshot':
      return { detail: '', what: 'taking a picture of the map' };
    case 'snapshot':
      return { detail: '', what: 'reading the metrics and the error log' };
    default:
      return { detail: command.kind, what: 'an instruction this console does not know' };
  }
}

/**
 * Start answering, until `stop()`. Safe to call when no panel is there: it simply keeps failing quietly, and
 * `onStatus` stays silent — a shared link carrying `&agent=1` with nothing listening must not tell an
 * operator that somebody is driving their page.
 *
 * `onCommand` is told about every instruction twice — as it starts and as it settles — so the chrome can say
 * WHAT is being done to the page rather than only that something is. Before it, an agent moving the camera
 * and an agent taking a picture looked identical from the operator's side: the band read `AGENT READING…`
 * for both, and a map that flew somewhere on its own had no explanation on screen at all.
 */
export function startAgentLink(
  panel: string,
  surface: AgentSurface,
  onStatus?: (status: AgentStatus) => void,
  onCommand?: (report: AgentCommandReport) => void,
): { stop: () => void } {
  let running = true;
  // Sticky: a release stands until the agent asks for something again, so the operator is not sent back to
  // "hold still" by the panel's own idle polling.
  let released: null | { activity: 'released'; note: string } = null;
  /** When a panel last answered. 0 means none ever has, which is what keeps a shared link silent. */
  let contactAt = 0;
  const report = (activity: AgentActivity, note = ''): void => onStatus?.({ activity, contactAt, note });
  const loop = async (): Promise<void> => {
    while (running) {
      try {
        const command = await nextCommand(panel, surface);
        // A poll that returned — carrying a command or empty after its hold — is proof of a panel, and the
        // moment it returned is what every reading below is stamped with.
        contactAt = performance.now();
        // What the command IS decides the state, so it is read before anything is reported: a poll that came
        // back carrying the release must not flash "hold still" on its way to saying the run is over.
        if (command?.kind === 'release') {
          released = { activity: 'released', note: noteOf(command) };
        } else if (command) {
          released = null;
          report('busy');
        }
        if (command) {
          onCommand?.({ ...describeCommand(command), id: command.id, kind: command.kind, state: 'running' });
          const failure = await answer(panel, command, surface);
          contactAt = performance.now();
          onCommand?.({
            ...describeCommand(command),
            id: command.id,
            kind: command.kind,
            ...(failure === null ? { state: 'done' } : { detail: failure, state: 'failed' }),
          });
        }
        report(released?.activity ?? 'held', released?.note ?? '');
      } catch {
        // A poll that failed says nothing about the NEXT one — the panel may be restarting, the phone may
        // have slept, the tunnel may have blinked — but it says everything about the state the operator is
        // in, and staying quiet here is what left the band claiming an attachment that had ended. Reported
        // only once a panel has actually answered: `contactAt` of 0 is a link that never came up.
        if (contactAt > 0) {
          report('offline');
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  };
  void loop();

  return {
    stop: (): void => {
      running = false;
    },
  };
}

/**
 * Do what was asked and hand back the answer — a failure is an ANSWER, so the agent reads why.
 *
 * Returns the failure for the chrome, or null when it worked. The agent is told either way; the operator is
 * told because a command that failed on their phone is the one they most need an explanation for.
 */
async function answer(panel: string, command: AgentCommand, surface: AgentSurface): Promise<null | string> {
  let result: unknown;
  let failure: null | string = null;
  try {
    result = { ok: true, value: await run(command, surface) };
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    result = { error: failure, ok: false };
  }
  await fetch(`${panel}/api/map/result`, {
    body: JSON.stringify({ id: command.id, result }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

  return failure;
}

/** The PNG as a data URI, which is how a picture survives a JSON hop. */
async function encodeImage(blob: Blob | null): Promise<null | string> {
  if (!blob) {
    return null;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

/** Ask for the next command, carrying the heartbeat that says a map is here and what it is showing. */
async function nextCommand(panel: string, surface: AgentSurface): Promise<AgentCommand | null> {
  const readout = surface.readout() as null | { fps?: number };
  const query = new URLSearchParams({
    fps: String(Math.round(readout?.fps ?? 0)),
    mode: surface.mode() ?? '',
    url: window.location.href,
  });
  const response = await fetch(`${panel}/api/map/poll?${query.toString()}`, {
    // `AbortSignal.timeout` is not everywhere; a browser without it keeps the old behaviour rather than
    // failing to poll at all, which is the right way round for a diagnostic channel.
    ...(typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) } : {}),
  });
  // A poll that came back 502 from a tunnel, or an HTML error page from something else on the port, is not a
  // panel answering. Read as JSON it would parse into `{ command: undefined }` and be indistinguishable from
  // an idle hold — the link would report itself up on the strength of somebody else's error page.
  if (!response.ok) {
    throw new Error(`panel answered ${response.status}`);
  }
  const body = (await response.json()) as { command: AgentCommand | null };

  return body.command;
}

/** What the agent said when it released the page — trimmed, and short enough for one line of chrome. */
function noteOf(command: AgentCommand): string {
  const note = command.args.note;

  return typeof note === 'string' ? note.trim().slice(0, 120) : '';
}

/** What each command means. Everything here is a capability the console already had. */
async function run(command: AgentCommand, surface: AgentSurface): Promise<unknown> {
  switch (command.kind) {
    case 'errors':
      return surface.errors();
    case 'mode': {
      const wanted = command.args.mode === 'flat' ? 'flat' : 'live';
      surface.setMode(wanted);

      return { asked: wanted };
    }
    case 'ops':
      return surface.ops();
    case 'pose': {
      const pose = command.args.pose as MapPose | undefined;
      if (!pose) {
        throw new Error('pose: no pose given');
      }
      surface.moveTo(pose);

      return { flyingTo: pose };
    }
    // The agent letting go. It answers with what the page will now be showing, so a tool that says "you can
    // put the phone down" only says it once the page has actually said so.
    case 'release':
      return { released: true, says: noteOf(command) };
    case 'screenshot':
      return { image: await encodeImage(await surface.image()) };
    case 'snapshot':
      return { errors: surface.errors(), inventory: surface.inventory(), readout: surface.readout() };
    default:
      throw new Error(`unknown command '${command.kind}'`);
  }
}
