/* eslint-disable no-console -- console.error is this module's SUBJECT, not stray logging: every recorded
   call is forwarded to the original. */
/**
 * What went wrong, in the capture rather than in a devtools console nobody can open.
 *
 * The target device is a phone and there is no PC to attach devtools from, so a failure that logs and keeps
 * running is invisible: the 2026-08-10 field run read 20 texture arrays and 25 cells off the pak and created
 * NONE of them, and the report could say the bytes arrived but not why nothing became resident. This puts the
 * page's own errors — `error`, `unhandledrejection`, `console.error` — into the JSON the operator copies.
 *
 * Capped and de-duplicated: a failing frame loop can raise the same error sixty times a second, and sixty
 * copies of one line are worse than one line with a count.
 */

export interface ErrorLog {
  dispose(): void;
  /** Newest last, each `"<count>x <message>"` when it repeated. */
  entries(): readonly string[];
}

interface ErrorLogTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** Distinct messages kept; past it the oldest goes. Repeats of a kept message only bump its count. */
const DEFAULT_LIMIT = 20;

export function createErrorLog(target: ErrorLogTarget = window, limit = DEFAULT_LIMIT): ErrorLog {
  const counts = new Map<string, number>();
  const record = (message: string): void => {
    const key = message.slice(0, 300);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (counts.size > limit) {
      const oldest = counts.keys().next();
      if (!oldest.done) {
        counts.delete(oldest.value);
      }
    }
  };

  const onError = (event: Event): void => {
    const error = event as ErrorEvent;
    record(error.message || String(error.error));
  };
  const onRejection = (event: Event): void => {
    record(`unhandled rejection: ${String((event as PromiseRejectionEvent).reason)}`);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  const format = (args: unknown[]): string =>
    args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]): void => {
    record(format(args));
    originalConsoleError(...args);
  };
  // `warn` as well as `error`: the engine's field diagnostics are warnings — a streamed entry that fails
  // says so through `console.warn`, and that line is the answer to "the bytes arrived and nothing appeared".
  const originalConsoleWarn = console.warn;
  console.warn = (...args: unknown[]): void => {
    record(`warn: ${format(args)}`);
    originalConsoleWarn(...args);
  };

  return {
    dispose(): void {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onRejection);
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
    },
    entries(): readonly string[] {
      return [...counts].map(([message, count]) => (count > 1 ? `${count}x ${message}` : message));
    },
  };
}
