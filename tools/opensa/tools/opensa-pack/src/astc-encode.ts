/**
 * RGBA8 `.ostex` → ASTC 4x4 `.ostex` (plan 200 chain 2, step 02).
 *
 * A GPU without BC can only take `--rgba8` today, and RGBA8 costs 8.5x a BC1 payload and 4.2x an ASTC one on
 * SA's own textures (`docs/benchmarks/opensa-engine/2026-08-06-headless-district-texture-budget.json`) — which
 * is the arithmetic that keeps the full map off a phone. This is the stage that pays it back.
 *
 * It runs on a FINISHED `.ostex`, not on the planner's intermediates, and that is deliberate: the alpha
 * pipeline (premultiply → dilate → classify → cutoutRef → mip chain) has already run, and re-ordering it is
 * the one way a universal encode silently changes 1 422 cutout layers. So an ASTC build is exactly an
 * `--rgba8` build with one more pass, and every producer of a dictionary — world arrays, vehicles, peds,
 * clutter, map objects — is covered by transforming the container they all end up in.
 *
 * The encoder is `astc-encoder.js`, wasm bindings of ARM's astcenc: no native binary, so it runs in Termux on
 * the target phone as well as on a desktop.
 */
import type { Ostex } from '@opensa/engine-formats';

import { packOstexPayload } from '@opensa/cell-weld/ostex-payload';
import {
  decodeOstex,
  encodeOstex,
  OstexFormat,
  ostexLayerBytes,
  ostexMaxMips,
  ostexMipLayout,
  ostexTightRowBytes,
} from '@opensa/engine-formats';
import {
  ASTCConfig,
  ASTCContext,
  ASTCImage,
  ASTCProfile,
  ASTCQualityPreset,
  ASTCSwizzle,
  ASTCType,
} from 'astc-encoder.js';

export interface AstcEncoder {
  /** Re-encode one RGBA8 `.ostex` as ASTC 4x4. Throws when handed anything else — see {@link createAstcEncoder}. */
  ostex(bytes: Uint8Array): Promise<Uint8Array>;
  /** What the stage cost, for the build log: texels encoded (mips included) and wall time. */
  readonly stats: { ms: number; texels: number };
}

export interface AstcEncoderOptions {
  /** astcenc effort preset, 0 (FASTEST) … 100 (EXHAUSTIVE). Default MEDIUM — measured 2026-08-07 as the knee:
   *  +3.1 dB over FAST for 1.35x the time, and THOROUGH buys another 0.3 dB for 1.4x again. */
  quality?: number;
  /**
   * astcenc worker threads. `0` is one per core; `1` spawns none and encodes on the calling thread.
   *
   * REQUIRED, and that is the whole point of it. It was optional until 2026-08-09, and the world-array call
   * site never passed one — so `--astc-threads 1` capped the model dictionaries while the arrays kept
   * spawning a worker per core, and three phone converts died at `encoding texture arrays` with the cap
   * apparently applied. A new call site must now state what it wants, or it does not compile.
   */
  threads: number;
}

/**
 * An encoder holding ONE astcenc context, reused across every array of a build.
 *
 * The input must be RGBA8. That is not a limitation, it is the contract: an ASTC build runs the planner with
 * `forceRgba8`, so the DXT passthrough never fires and every layer arrives decoded. A BC layer reaching here
 * would mean the pack wired the two switches apart, and re-encoding it silently would be a second generation
 * of loss nobody asked for.
 */
export function createAstcEncoder(options: AstcEncoderOptions): AstcEncoder {
  const config = new ASTCConfig(
    // LDR_SRGB, because the upload format is `astc-4x4-unorm-srgb`: the encoder has to weight its error in the
    // space the sampler decodes in, or it spends its bits on the wrong end of the ramp.
    ASTCProfile.LDR_SRGB,
    4,
    4,
    1,
    options.quality ?? ASTCQualityPreset.MEDIUM,
    // No USE_APLHA_WEIGHT: it scales RGB error by alpha, which is right for straight alpha and wrong for ours
    // — the payload is already premultiplied, so the RGB of a transparent texel is already zero.
    0,
  );
  const context = new ASTCContext(config, options.threads);
  const swizzle = new ASTCSwizzle();
  const stats = { ms: 0, texels: 0 };

  return {
    async ostex(bytes: Uint8Array): Promise<Uint8Array> {
      const tex = decodeOstex(bytes);
      if (tex.format !== OstexFormat.RGBA8) {
        throw new Error(
          `--textures=astc needs an RGBA8 source, got format ${tex.format}: the planner must run with the ` +
            `RGBA8 pipeline so nothing is passed through as DXT`,
        );
      }
      const started = Date.now();
      // ASTC blocks stop at 4x4, RGBA8 mips go to 1x1 — so the chain is TRUNCATED, not reinterpreted.
      const mipCount = Math.min(tex.mipCount, ostexMaxMips(OstexFormat.ASTC4x4, tex.width, tex.height));
      const layers: { data: Uint8Array }[][] = [];
      for (let layer = 0; layer < tex.layers.length; layer += 1) {
        const mips: { data: Uint8Array }[] = [];
        for (let level = 0; level < mipCount; level += 1) {
          const layout = ostexMipLayout(tex.format, tex.width, tex.height, level);
          const image = new ASTCImage(ASTCType.U8, layout.mipWidth, layout.mipHeight, 1, tightMip(tex, layer, level));
          mips.push({ data: await context.compress(image, swizzle) });
          stats.texels += layout.mipWidth * layout.mipHeight;
        }
        layers.push(mips);
      }
      stats.ms += Date.now() - started;

      return encodeOstex({
        format: OstexFormat.ASTC4x4,
        height: tex.height,
        layers: tex.layers,
        mipCount,
        payload: packOstexPayload(OstexFormat.ASTC4x4, tex.width, tex.height, mipCount, layers),
        premultiplied: tex.premultiplied,
        width: tex.width,
      });
    },
    stats,
  };
}

/** One mip level of one layer, rows back-to-back — the 256-byte row padding stripped back off. */
function tightMip(tex: Ostex, layer: number, level: number): Uint8Array {
  let offset = layer * ostexLayerBytes(tex.format, tex.width, tex.height, tex.mipCount);
  for (let below = 0; below < level; below += 1) {
    offset += ostexMipLayout(tex.format, tex.width, tex.height, below).totalBytes;
  }
  const layout = ostexMipLayout(tex.format, tex.width, tex.height, level);
  const tightRow = ostexTightRowBytes(tex.format, layout.mipWidth);
  const out = new Uint8Array(tightRow * layout.rows);
  for (let row = 0; row < layout.rows; row += 1) {
    const start = offset + row * layout.bytesPerRow;
    out.set(tex.payload.subarray(start, start + tightRow), row * tightRow);
  }

  return out;
}
