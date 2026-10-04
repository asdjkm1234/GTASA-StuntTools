/** Moved to the engine (`@opensa/renderware/textures/dxt`) — the WebGPU texture path needs it (non-block-aligned
 *  DXT must decode to RGBA). Re-exported here so every tool keeps its `@opensa/rw-codec/dxt` import. */
export { decodeDxt, type DxtFormat } from '@opensa/renderware/textures/dxt';
