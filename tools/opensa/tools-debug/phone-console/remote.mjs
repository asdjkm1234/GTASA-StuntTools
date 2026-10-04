/**
 * The command bus between an agent and the MAP PAGE (plan 002, the browser half).
 *
 * The panel can already run the phone's build system. What it could not do is look at the thing being built:
 * an agent had no way to see the map, read its numbers, move its camera or find out that it had thrown. That
 * half used to be a person describing a screen.
 *
 * **The page is the instrument, not a browser protocol.** Chrome's DevTools Protocol would mean `adb` and
 * wireless debugging on a device that does not always have it; the console, meanwhile, already computes
 * everything worth reading — the inventory report (fps, draws, resident MB, per-pass spans, symbology
 * counts, the time axis), an error log, its own PNG of the situation (`exportImage`, built for 201/7-07) and
 * a camera it can be told to fly. So the page ASKS this panel what to do and answers with what it found.
 *
 * The shape is a queue with one waiter per command, and it is deliberately dull:
 *
 * - the map long-polls `take()` and gets the next command, or nothing after a timeout;
 * - it POSTs the answer to `settle()`, which wakes whoever asked;
 * - `submit()` resolves when the answer arrives, or gives up with a reason that says WHICH end was silent —
 *   "no map is attached" and "the map never answered" are different problems and a caller must not have to
 *   guess between them.
 *
 * A page that closes mid-command is the normal case (a phone locks, Android kills Chrome), so nothing here
 * waits forever and every timeout names what it was waiting for.
 */

/** How long a caller waits for the map, unless it says otherwise. */
const DEFAULT_TIMEOUT_MS = 20_000;

/** How long a page's long-poll hangs before answering "nothing yet" — under any proxy's idle timeout. */
export const POLL_HOLD_MS = 20_000;

/** A page is considered attached this long after its last poll. */
const ATTACHED_MS = 15_000;

export class MapBus {
  /** @param {{now?: () => number}} options */
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.nextId = 0;
    /** Commands waiting to be taken by the page. @type {{args: unknown, id: number, kind: string}[]} */
    this.queue = [];
    /** Who is waiting for each command's answer. @type {Map<number, (result: unknown) => void>} */
    this.waiting = new Map();
    /** Long-polls parked with nothing to give them yet. @type {((command: unknown) => void)[]} */
    this.pollers = [];
    /** What the page last said about itself. */
    this.seen = null;
  }

  /** Whether a map is attached, and what it last said it was showing. */
  attached() {
    if (!this.seen) {
      return { attached: false, page: null };
    }

    return { attached: this.now() - this.seen.at < ATTACHED_MS, page: this.seen };
  }

  /** The map answers a command. Unknown ids are ignored — a late answer to a timed-out command is not news. */
  settle(id, result) {
    const waiter = this.waiting.get(Number(id));
    this.waiting.delete(Number(id));
    waiter?.(result);

    return { accepted: waiter !== undefined };
  }

  /**
   * An agent asks the map for something. Resolves with the page's answer, or with a REFUSAL that names which
   * end went quiet.
   *
   * @param {{args?: unknown, kind: string, timeoutMs?: number}} command
   */
  submit(command) {
    const attached = this.attached();
    if (!attached.attached) {
      return Promise.resolve({
        error:
          'no map is attached — open the console on this phone with `&agent=1` in its query (the panel’s ' +
          'links carry it), and keep that tab in front',
        ok: false,
      });
    }
    this.nextId += 1;
    const id = this.nextId;
    const entry = { args: command.args ?? {}, id, kind: command.kind };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        this.queue = this.queue.filter((queued) => queued.id !== id);
        resolve({ error: `the map took the command but never answered '${command.kind}'`, ok: false });
      }, command.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.waiting.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      const poller = this.pollers.shift();
      if (poller) {
        poller(entry);
      } else {
        this.queue.push(entry);
      }
    });
  }

  /**
   * The map asks for its next command, holding the connection when there is none.
   *
   * @param {{page?: unknown}} beat what the page says it is showing — the heartbeat rides the poll rather
   *   than being a request of its own, because a page that is polling IS the page that is alive.
   */
  take(beat = {}) {
    this.seen = { ...(beat.page ?? {}), at: this.now() };
    const next = this.queue.shift();
    if (next) {
      return Promise.resolve(next);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pollers = this.pollers.filter((parked) => parked !== deliver);
        resolve(null);
      }, POLL_HOLD_MS);
      const deliver = (command) => {
        clearTimeout(timer);
        resolve(command);
      };
      this.pollers.push(deliver);
    });
  }
}
