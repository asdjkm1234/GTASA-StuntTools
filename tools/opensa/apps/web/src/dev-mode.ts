/**
 * Are we running a development build? `process.env.NODE_ENV` is statically replaced by vite
 * (`command === 'build'` → `'production'`), so the dead branch is dropped from the deploy bundle.
 *
 * Used for developer affordances that must NOT reach players (the F2 tip) and for defaults that
 * should be ON while developing (the engine perf HUD + slow-frame console logs — plan 074/22).
 */
export const IS_DEV = process.env.NODE_ENV !== 'production';
