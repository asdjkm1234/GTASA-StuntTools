/**
 * The boot shell's channel, from the app's side.
 *
 * The shell itself is inline in `dispatch.html` — it has to paint before the module graph is fetched, and
 * the engine chunk in front of it is 944 kB gzipped. This is the typed handle onto what that script defined,
 * and every function here is a NO-OP when the shell is absent: the console is also mounted by the viewer
 * harness, by tests and by an embedding host, none of which have that markup, and a missing shell is not an
 * error in any of them.
 *
 * **What it reports is what has a denominator.** The bar stays indeterminate until the streamer knows how
 * many cells the district holds, and then it is a real fraction of a real count. Bytes are shown beside it
 * as a total read, with no denominator, because nothing knows ahead of time how much of the pak the opening
 * view will pull. A percentage nobody can defend is worse than a sweep that says "working".
 */

interface BootShell {
  done: () => void;
  fail: (message: string) => void;
  step: (text: string, done?: number, total?: number, note?: string) => void;
}

/** Bytes as the shell shows them — one decimal, and `kB` under a megabyte so a small read is not `0.0 MB`. */
export function bootBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The console is up — remove the shell. Safe to call twice; the second is ignored. */
export function bootDone(): void {
  shell()?.done();
}

/** The console cannot start. Leaves the message on screen rather than a bar that never fills. */
export function bootFail(message: string): void {
  shell()?.fail(message);
}

/**
 * Move the shell on.
 *
 * @param text what is happening, in the operator's words rather than the module's
 * @param done  how much of `total` is finished — omit while nothing has a denominator
 * @param total the count `done` is out of
 * @param note  a second line: bytes read, the district, whatever the phase can prove
 */
export function bootStep(text: string, done?: number, total?: number, note?: string): void {
  shell()?.step(text, done, total, note);
}

function shell(): BootShell | undefined {
  return (globalThis as { __opensaBoot?: BootShell }).__opensaBoot;
}
