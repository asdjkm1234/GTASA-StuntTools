/**
 * Scene environment probe (plan 074/16 step 2) — the vehicle reflection SOURCE. A mipped cubemap of the
 * ACTUAL streamed world around the player car, refreshed ONE FACE PER FRAME: face render (MSAA, the same
 * recorded cell bundles + sky the main pass uses) → resolve into a scratch target → V-flipped blit into the
 * face's mip 0 (GL cube-face row order vs WebGPU render row order — a projection flip would break winding)
 * → a 2×2 box mip chain (the prefiltered-roughness ladder, prod's `generateMipmaps` equivalent).
 *
 * Everything here is allocated ONCE at init — fixed size (probes are constants, the asset-driven-size rule
 * does not apply), immutable views — so the cube can sit inside every vehicle bind group while its contents
 * refresh. The engine owns scheduling (which face, when to skip) and culling; this module owns resources and
 * encoding.
 */
import type { Resources } from '../core/resources';
import type { PipelineSet } from './pipelines';

import {
  type Mat4,
  mat4Identity,
  mat4Invert,
  mat4LookAt,
  mat4Multiply,
  mat4PerspectiveZO,
  type Vec3,
} from '../core/math';
import { MSAA_SAMPLES, SCENE_FORMAT } from './pipelines';

/** Face edge, texels. 128 matches prod's cube probe (`PROBE_SIZE` in vehicle-reflection.plugin). */
export const PROBE_SIZE = 128;
/** Full chain 128 → 1; the rigid shader's PROBE_MAX_LOD mirrors `PROBE_MIPS − 1`. */
export const PROBE_MIPS = 8;
/** Cells beyond this many units of the probe centre never render into a face — the vertex-cost bound.
 *  Farther world reads as sky in a 128² reflection anyway; the analytic sky still fills the horizon.
 *  Cost note (2026-07-16 bench): cutting this to 250 did NOT move the measured probe span, and the
 *  probe-on/off A/B showed no frame-level GPU delta at all — the span is a Metal-overlap upper bound
 *  (see GpuTimers), the real cost is buried in run variance. Kept at 350 for the reflection's reach. */
export const PROBE_RANGE = 350;
/** A centre jump beyond this = a teleport: the fade restarts so stale faces never show in the paint. */
const PROBE_RESET_DISTANCE = 80;
const PROBE_NEAR = 0.5;
const PROBE_FAR = 2000;
const PROBE_DEPTH_FORMAT: GPUTextureFormat = 'depth32float';

/** Classic GL cube-camera orientations (pure rotations — winding survives; the blit pass fixes the row order). */
const FACE_FORWARDS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const FACE_UPS: readonly Vec3[] = [
  [0, -1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, -1, 0],
  [0, -1, 0],
];

export class EnvProbe {
  /** All-mips cube view — bound (with `sampler`) into every vehicle bind group at model create. */
  readonly cubeView: GPUTextureView;
  /** Trilinear so `textureSampleLevel` interpolates BETWEEN the roughness mips. */
  readonly sampler: GPUSampler;

  private readonly blitBindGroup: GPUBindGroup;
  private readonly depthView: GPUTextureView;
  private readonly device: GPUDevice;
  /** [face][mip] render-target views of the cube (mip 0 = blit target, the rest = mip-chain targets). */
  private readonly faceMipViews: GPUTextureView[][];
  /** Fade state: faces rendered since the last reset; mix = min(1, facesDone / 6). */
  private facesDone = 0;
  private readonly lastCenter: [number, number, number] = [0, 0, 0];
  /** [face][mip − 1] bind groups reading (face, mip − 1) for the downsample into (face, mip). */
  private readonly mipBindGroups: GPUBindGroup[][];
  private readonly msaaView: GPUTextureView;
  private nextFace = 0;
  private readonly pipelines: PipelineSet;
  private readonly proj: Mat4 = mat4Identity();
  private readonly scratchView: GPUTextureView;
  private readonly view: Mat4 = mat4Identity();

  constructor(device: GPUDevice, resources: Resources, pipelines: PipelineSet) {
    this.device = device;
    this.pipelines = pipelines;
    // Reversed-Z like the main pass (swapped near/far, clear 0, `greater` compares in the shared pipelines).
    mat4PerspectiveZO(this.proj, Math.PI / 2, 1, PROBE_FAR, PROBE_NEAR);
    const cubeBytes = Math.ceil(PROBE_SIZE * PROBE_SIZE * 8 * 6 * 1.34);
    const cube = resources.createTexture(
      'target',
      {
        format: SCENE_FORMAT,
        label: 'env-probe',
        mipLevelCount: PROBE_MIPS,
        size: { depthOrArrayLayers: 6, height: PROBE_SIZE, width: PROBE_SIZE },
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      },
      cubeBytes,
    );
    this.cubeView = cube.createView({ dimension: 'cube', label: 'env-probe' });
    this.sampler = device.createSampler({
      label: 'env-probe',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
    const msaa = resources.createTexture(
      'target',
      {
        format: SCENE_FORMAT,
        label: 'env-probe-msaa',
        sampleCount: MSAA_SAMPLES,
        size: { height: PROBE_SIZE, width: PROBE_SIZE },
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      },
      PROBE_SIZE * PROBE_SIZE * 8 * MSAA_SAMPLES,
    );
    this.msaaView = msaa.createView();
    const depth = resources.createTexture(
      'target',
      {
        format: PROBE_DEPTH_FORMAT,
        label: 'env-probe-depth',
        sampleCount: MSAA_SAMPLES,
        size: { height: PROBE_SIZE, width: PROBE_SIZE },
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      },
      PROBE_SIZE * PROBE_SIZE * 4 * MSAA_SAMPLES,
    );
    this.depthView = depth.createView();
    const scratch = resources.createTexture(
      'target',
      {
        format: SCENE_FORMAT,
        label: 'env-probe-scratch',
        size: { height: PROBE_SIZE, width: PROBE_SIZE },
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      },
      PROBE_SIZE * PROBE_SIZE * 8,
    );
    this.scratchView = scratch.createView();
    this.blitBindGroup = device.createBindGroup({
      entries: [
        { binding: 0, resource: this.scratchView },
        { binding: 1, resource: this.sampler },
      ],
      label: 'env-probe-blit',
      layout: pipelines.probeMipLayout,
    });
    this.faceMipViews = [];
    this.mipBindGroups = [];
    for (let face = 0; face < 6; face += 1) {
      const mipViews: GPUTextureView[] = [];
      for (let mip = 0; mip < PROBE_MIPS; mip += 1) {
        mipViews.push(
          cube.createView({
            baseArrayLayer: face,
            baseMipLevel: mip,
            dimension: '2d',
            label: `env-probe:${face}:${mip}`,
            mipLevelCount: 1,
          }),
        );
      }
      this.faceMipViews.push(mipViews);
      const bindGroups: GPUBindGroup[] = [];
      for (let mip = 1; mip < PROBE_MIPS; mip += 1) {
        bindGroups.push(
          device.createBindGroup({
            entries: [
              { binding: 0, resource: mipViews[mip - 1] },
              { binding: 1, resource: this.sampler },
            ],
            label: `env-probe-mip:${face}:${mip}`,
            layout: pipelines.probeMipLayout,
          }),
        );
      }
      this.mipBindGroups.push(bindGroups);
    }
  }

  /**
   * Per-frame scheduling: returns the face to render this frame and the CURRENT mix (before the face lands —
   * the uniform must never claim a face that has not been drawn yet). A centre teleport restarts the fade.
   */
  beginFrame(center: Vec3): { face: number; mix: number } {
    const jump = Math.hypot(
      center[0] - this.lastCenter[0],
      center[1] - this.lastCenter[1],
      center[2] - this.lastCenter[2],
    );
    if (jump > PROBE_RESET_DISTANCE) {
      this.facesDone = 0;
      this.nextFace = 0;
    }
    [this.lastCenter[0], this.lastCenter[1], this.lastCenter[2]] = center;
    const face = this.nextFace;
    const mix = this.mix();
    this.nextFace = (this.nextFace + 1) % 6;
    this.facesDone = Math.min(12, this.facesDone + 1);

    return { face, mix };
  }

  /**
   * Encode one face refresh: world+sky into the MSAA target (resolve → scratch), the V-flip blit into the
   * face's mip 0, then the downsample chain. The frame uniform must already hold the face camera — the
   * caller writes it before this encoder is submitted and restores the main camera after.
   */
  encodeFace(
    encoder: GPUCommandEncoder,
    face: number,
    bundles: readonly GPURenderBundle[],
    frameBindGroup: GPUBindGroup,
    skyColor: GPUColor,
    timestamps: {
      begin: { timestampWrites?: GPURenderPassTimestampWrites };
      end: { timestampWrites?: GPURenderPassTimestampWrites };
    },
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: skyColor,
          loadOp: 'clear',
          resolveTarget: this.scratchView,
          storeOp: 'discard',
          view: this.msaaView,
        },
      ],
      depthStencilAttachment: {
        depthClearValue: 0, // reversed-Z far plane
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        view: this.depthView,
      },
      label: `env-probe-face-${face}`,
      ...timestamps.begin,
    });
    if (bundles.length > 0) {
      pass.executeBundles([...bundles]);
    }
    pass.setPipeline(this.pipelines.get('sky'));
    pass.setBindGroup(0, frameBindGroup);
    pass.draw(3);
    pass.end();
    // Blit (mip 0, V-flipped) + the mip ladder. The probe span's END timestamp rides the last mip pass.
    this.runMipPass(encoder, 'probe-blit', this.blitBindGroup, this.faceMipViews[face][0], {});
    for (let mip = 1; mip < PROBE_MIPS; mip += 1) {
      this.runMipPass(
        encoder,
        'probe-mip',
        this.mipBindGroups[face][mip - 1],
        this.faceMipViews[face][mip],
        mip === PROBE_MIPS - 1 ? timestamps.end : {},
      );
    }
  }

  /** The face camera: viewProj + its inverse (the sky pass ray-casts through invViewProj). */
  faceMatrices(face: number, center: Vec3, outViewProj: Mat4, outInvViewProj: Mat4): void {
    const forward = FACE_FORWARDS[face];
    mat4LookAt(
      this.view,
      center,
      [center[0] + forward[0], center[1] + forward[1], center[2] + forward[2]],
      FACE_UPS[face],
    );
    mat4Multiply(outViewProj, this.proj, this.view);
    mat4Invert(outInvViewProj, outViewProj);
  }

  /** The current fade (no scheduling side effects) — the uniform on frames that skip the face render. */
  mix(): number {
    return Math.min(1, this.facesDone / 6);
  }

  private runMipPass(
    encoder: GPUCommandEncoder,
    id: 'probe-blit' | 'probe-mip',
    bindGroup: GPUBindGroup,
    view: GPUTextureView,
    timestamps: { timestampWrites?: GPURenderPassTimestampWrites },
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ clearValue: { a: 0, b: 0, g: 0, r: 0 }, loadOp: 'clear', storeOp: 'store', view }],
      label: id,
      ...timestamps,
    });
    pass.setPipeline(this.pipelines.get(id));
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
}
