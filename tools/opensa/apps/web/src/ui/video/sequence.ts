/**
 * The run loop's one DECISION, apart from the staging that surrounds it (plan 096/08): **a scene that fails
 * does not end the run.**
 *
 * A sequence is up to 100 scenes long and nobody watches it live, so every failure mode the runner has — no
 * route inside the region, spawn retries exhausted, every aerial pass blocked, a wedged autopilot — has to
 * cost one scene and nothing more. It lives here rather than inline in `engine-video-runs.ts` because it is
 * the one part of that loop worth pinning by test: everything else in it is host glue (a DOM overlay, a
 * streamed world, a physics spawn) and belongs to the field lane.
 *
 * A failure is REPORTED, never swallowed: a run whose log has no line for scene 57 is indistinguishable from
 * a run where scene 57 played.
 */

export interface SequenceHooks {
  /** Say what went wrong, behind the overlay. Called once per failed scene. */
  onFailure(scene: number, message: string): void;
  /** Stage and play one scene. Rejecting is a failure of THAT scene, nothing more. */
  play(scene: number): Promise<void>;
}

/** Play scenes `from…last` inclusive; answer how many of them played. Never rejects. */
export async function playSequence(from: number, last: number, hooks: SequenceHooks): Promise<number> {
  let played = 0;
  for (let scene = from; scene <= last; scene += 1) {
    try {
      await hooks.play(scene);
      played += 1;
    } catch (error) {
      hooks.onFailure(scene, error instanceof Error ? error.message : String(error));
    }
  }

  return played;
}
