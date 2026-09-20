/**
 * What `createDefaultPakWorker` becomes in the SHARE build (201/2-02), by alias.
 *
 * The default builds its worker from a module-relative URL, which is right for every build that has an
 * `assets/` beside it and impossible for one that does not. Aliasing it here removes that URL from the
 * artifact altogether — so the single-file guard can say something exact instead of guessing whether a
 * filename in the bundle is a live fetch or dead code — and leaves a refusal in its place rather than a
 * silent hole, for the one case that would reach it: a host in this build calling `setupStreaming` without
 * handing over the inline worker.
 */
export function createDefaultPakWorker(): Worker {
  throw new Error(
    'the shareable console carries its pak worker inline and has no chunk to load: pass ' +
      '`createWorker` to setupStreaming (see apps/dispatch/src/share.tsx).',
  );
}
