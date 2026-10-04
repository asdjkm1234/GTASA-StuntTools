/**
 * Telling the OPERATOR, on the device, that the run is over (plan 002).
 *
 * Every other tool here talks to the agent. This one talks to the person holding the phone, and it exists
 * because of what the map channel costs them: Android freezes a tab that is not in front, so while an agent
 * reads the console the phone has to lie there untouched — and until this, the only way to learn it was
 * finished was to ask in a chat and be told. That is a person waiting on a message about their own device.
 *
 * **The console's own band is the signal that always works** (`apps/dispatch/src/ui/agent-band.tsx`); this is
 * the one that reaches a phone lying face down. `termux-vibrate` and `termux-notification` come from the
 * Termux:API add-on, which is a separate app and may simply not be there — so nothing here is required, every
 * absence is reported rather than thrown, and the release still happens without any of it.
 *
 * `-f` on the vibration is deliberate: it buzzes even in silent mode. A phone put down for a measurement is
 * exactly the phone that is on silent, and this is a signal the operator asked for rather than an alert.
 */

/** The Termux:API binaries. Present only with the add-on app AND `pkg install termux-api`. */
export const VIBRATE_BIN = '/data/data/com.termux/files/usr/bin/termux-vibrate';
export const NOTIFY_BIN = '/data/data/com.termux/files/usr/bin/termux-notification';

/** One id, so a second release replaces the first notification rather than stacking another. */
const NOTIFY_ID = 'opensa-map-release';

/** What the operator reads when the agent said nothing of its own. */
const DEFAULT_NOTE = 'the agent is done — you can pick the phone up';

/**
 * Buzz and post, best effort, and say exactly what happened.
 *
 * @param {{exists: (path: string) => boolean, run: (bin: string, args: string[]) => Promise<unknown>}} deps
 * @param {{note?: string}} request
 */
export async function signalDone(deps, request = {}) {
  const { exists, run } = deps;
  const note = String(request.note ?? '').trim() || DEFAULT_NOTE;
  const sent = [];
  const failed = [];
  const missing = [];

  for (const [bin, args] of [
    [VIBRATE_BIN, ['-d', '600', '-f']],
    [NOTIFY_BIN, ['--id', NOTIFY_ID, '--title', 'OpenSA console', '--content', note]],
  ]) {
    if (!exists(bin)) {
      missing.push(bin.split('/').pop());
      continue;
    }
    try {
      await run(bin, args);
      sent.push(bin.split('/').pop());
    } catch (error) {
      // A Termux:API binary with no add-on app behind it fails or hangs; either way the release stands and
      // the console's band has already said so. This is the extra, never the message.
      failed.push(`${bin.split('/').pop()}: ${String(error?.message ?? error)}`);
    }
  }

  return {
    failed,
    note,
    sent,
    ...(missing.length > 0
      ? {
          missing,
          why:
            'the Termux:API add-on is not installed here, so the phone cannot buzz — `pkg install termux-api` ' +
            'plus the Termux:API app. The console still shows the band that says the run is over.',
        }
      : {}),
  };
}
