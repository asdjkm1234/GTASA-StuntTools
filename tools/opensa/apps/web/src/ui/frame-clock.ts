/**
 * Waiting on the FRAME clock, shared by the scripted runners (081/01's laps, 096/02's video scenes).
 *
 * Everything here advances on `requestAnimationFrame`, never on `setTimeout`. A runner that slept on wall
 * time would keep counting while the tab is throttled or a cell is parsing — so its "2 second warmup" would
 * be two seconds in which the game ran four frames, which is exactly the settle bug the phys laps were built
 * around (`engine-phys-runs.ts`'s three-part teleport recipe).
 */

export const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Wait until `ready()` or the deadline; returns whether it became ready. */
export async function until(ready: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (ready()) {
      return true;
    }
    await nextFrame();
  }

  return ready();
}

/** Let the game run for a while — frames, not a timer, so nothing advances while the tab is throttled. */
export async function waitSeconds(seconds: number): Promise<void> {
  await until(() => false, seconds * 1000);
}
