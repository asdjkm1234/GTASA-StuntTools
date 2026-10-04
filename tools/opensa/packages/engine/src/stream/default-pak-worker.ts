/**
 * The pak worker as an ORDINARY build wants it: a module-relative URL, which the bundler turns into
 * `assets/pak-worker-*.js` beside the entry.
 *
 * Its own module for one reason, and it is a build reason rather than a code one (201/2-02). The expression
 * below is what makes a bundler emit that chunk, and it is emitted whether or not anything calls it — so in
 * a SINGLE-FILE artifact, where the chunk cannot be served, its filename sits in the bundle as dead code and
 * nothing can tell it apart from a live fetch. A one-function module can be ALIASED away by such a build
 * (`apps/dispatch/vite.share.config.ts`), which removes the dead reference instead of arguing about it, and
 * lets that build's guard say something exact: any chunk still named in the artifact is one it would fetch.
 */
export function createDefaultPakWorker(): Worker {
  return new Worker(new URL('./pak-worker.ts', import.meta.url), { type: 'module' });
}
