/**
 * The RENDER cell size: the grid a district is welded into and the manifest ships to the engine, which
 * streams and draws `.oscell` blobs on it. NOT an option — the pak, the runtime and every tool that names a
 * cell coordinate must agree, and nothing checks that when it is a flag.
 *
 * Distinct from the GAME-side grid (`GAME_CELL_SIZE`, 256) that collision streaming, procobj scatter and the
 * LOD-impostor bake use. The two have never been equal and need not be.
 *
 * Lives here, beside the welder that welds on it, because both the offline converter (`opensa-pack`, a
 * `type:tool`) and the in-browser viewer (`sa-map-viewer`, a `type:app`) need it — and an app may not import
 * a tool.
 */
export const CELL_SIZE = 250;

/**
 * The GAME cell size: the grid COLLISION streaming, procobj scatter and the LOD-impostor bake work on.
 *
 * Beside {@link CELL_SIZE} on purpose. The two are different tessellations of one world and have never been
 * equal, so "per cell" is ambiguous the moment anything is precomputed per cell — and picking the wrong one
 * for a collision bake does not lose colliders, it returns the WRONG cell's, which reads in the field as a
 * physics bug rather than a bake bug (`docs/restrictions/architecture.md`).
 *
 * Declared here rather than in the app that used to own it, because the collision bake runs in `opensa-pack`
 * (a `type:tool`) and a tool may not import an app.
 */
export const GAME_CELL_SIZE = 256;
