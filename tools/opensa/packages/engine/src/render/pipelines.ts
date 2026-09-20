/**
 * Pipeline registry (plan 074/01): every pipeline the engine can ever bind is ENUMERATED here and compiled by
 * `compileAll()` behind the load veil. A steady-state miss throws — cold-start compile storms are impossible
 * by design, not unlikely (the 073 lesson as an assertion).
 *
 * The compile is ASYNCHRONOUS and overlapped (201/4-03): every pipeline is started, then all of them are
 * awaited once. `createRenderPipelineAsync` is the same descriptor compiled on the implementation's own
 * threads instead of blocking the caller's, which on a phone is what keeps 34 compiles off the thread the
 * boot is running on. `compileAll` is therefore async, and a shader that no longer validates rejects the
 * boot at the await rather than at the first draw that binds it.
 *
 * World set: opaque/cutout/blend/beam/additive × front/double = 10 pipelines + sky. The cutout pair
 * enables alpha-to-coverage (MSAA 4×) — the third leg of the alpha-edge fix. Blend/beam pipelines blend
 * PREMULTIPLIED output (one, one-minus-src-alpha) with depth READ-ONLY (074/06 rows 9/11); the additive
 * pair (085 row C) ADDS premultiplied light (one, one) — SA's IdeFlag.ADDITIVE neon overlays.
 */
import { OSCELL_VERTEX_STRIDE } from '@opensa/engine-formats';

import { resolveShader } from './shaders';

/** MSAA sample count — FIXED at 4: WebGPU allows only 1|4, and 1 would disable alpha-to-coverage
 *  (the cutout alpha fix). The 074/09 msaa tier knob was field-tested and dropped. */
export const MSAA_SAMPLES = 4;

/** The SCENE render target format (074/09 stage 1): the world/sky/entities render into a linear 16-float
 *  offscreen so the sun's HDR overshoot survives for the godrays bright-pass; the post pipeline composites
 *  into the sRGB swapchain view. */
export const SCENE_FORMAT: GPUTextureFormat = 'rgba16float';

export type PipelineId =
  | 'bloom-down'
  | 'bloom-prefilter'
  | 'bloom-up'
  | 'cloud-field'
  | 'clutter-cutout'
  | 'clutter-opaque'
  | 'corona'
  | 'debris'
  | 'debug-line'
  | 'debug-line-through'
  | 'particle-add'
  | 'particle-add-once'
  | 'particle-blend'
  | 'particle-blend-once'
  | 'ped'
  | 'post'
  | 'probe-blit'
  | 'probe-mip'
  | 'probe-view'
  | 'rigid-blend'
  | 'rigid-opaque'
  | 'skid'
  | 'sky'
  | 'water'
  | 'world-additive-double'
  | 'world-additive-front'
  | 'world-beam-double'
  | 'world-beam-front'
  | 'world-blend-double'
  | 'world-blend-front'
  | 'world-cutout-double'
  | 'world-cutout-front'
  | 'world-opaque-double'
  | 'world-opaque-front';

export interface PipelineSet {
  /** group(0) of bloom prefilter/downsample: uniform + input texture + sampler (074/09). */
  bloomLayout: GPUBindGroupLayout;
  /** group(0) of bloom upsample: + the same-size downsample mip (the tent blends over it). */
  bloomUpLayout: GPUBindGroupLayout;
  /** group(1): per-cell uniform (origin). */
  cellLayout: GPUBindGroupLayout;
  /** group(0) of the cloud-field bake (sky v2 perf): the frame uniform alone. */
  cloudFieldLayout: GPUBindGroupLayout;
  /** group(1) of the clutter pipeline (074/19): per-instance matrices (storage) + the model texture + sampler. */
  clutterLayout: GPUBindGroupLayout;
  /** group(1) of the debris pipeline: the break's uniform + its shard texture ARRAY + sampler (B7·a). */
  debrisLayout: GPUBindGroupLayout;
  /** group(1) of the debug-line pipeline: the per-set colour uniform (074/13 phase 4). */
  debugLineLayout: GPUBindGroupLayout;
  /** group(0): per-frame uniform. */
  frameLayout: GPUBindGroupLayout;
  get(id: PipelineId): GPURenderPipeline;
  /** group(2): texture array + sampler. */
  materialLayout: GPUBindGroupLayout;
  /** group(1) of the particle pipelines: system params (storage) + the FX sprite ARRAY + sampler (B6). */
  particleLayout: GPUBindGroupLayout;
  /** group(1) of the ped pipeline: matrix storage (model + bone palette) + texture + sampler (074/08 B1). */
  pedLayout: GPUBindGroupLayout;
  /** group(0) of the post pipeline: post uniform + scene texture + sampler (godrays, 074/09 stage 1). */
  postLayout: GPUBindGroupLayout;
  /** group(0) of the probe mip pass (074/16 step 2): the previous mip level + sampler. */
  probeMipLayout: GPUBindGroupLayout;
  /** group(1) of the probe DEBUG view: the cube + sampler (074/16 — orientation verified by eye). */
  probeViewLayout: GPUBindGroupLayout;
  /** group(1) of the rigid-entity pipelines: part matrices + texture ARRAY + sampler (074/08 B2). */
  rigidLayout: GPUBindGroupLayout;
  /** group(1) of the skid-mark pipeline (089/03): the particleskid texture + sampler. */
  skidLayout: GPUBindGroupLayout;
  /** group(1) of the water pipeline: the ripple texture + sampler (074/06 row 12 v1). */
  waterLayout: GPUBindGroupLayout;
}

export async function compileAll(
  device: GPUDevice,
  colorFormat: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  outputFormat: GPUTextureFormat = colorFormat,
): Promise<PipelineSet> {
  const frameLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT },
      // PBR sky LUT (074/06 row 4): sampled by the sky pass AND the world fog (the 068 invariant).
      { binding: 1, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
      // Local light pool (074/06 row 7): world samples it in the VERTEX stage, dynamics per pixel.
      {
        binding: 3,
        buffer: { type: 'read-only-storage' },
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      },
      // Bindings 4/5 held the painted cloud-panorama dome slots — REMOVED 2026-07-17 (procedural
      // cirrus+cumulus carry the clouds); the numbers stay vacant so the rest never renumbers.
      // SA corona sprites (particle.txd): layer 0 = coronastar (lamps/headlights), layer 1 = coronamoon.
      // Created ONCE at init and written in place — the frame bind group is recorded inside cell bundles and
      // is immutable (the row-15 lesson: never destroy or rebuild anything a bundle references).
      { binding: 6, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      // Baked cumulus field (sky v2 perf): rg = [n, mass] fbm over the sky projection, rebuilt by the
      // tiny 'cloud-field' pass each frame — full-deck weathers cost one tap instead of 10 vnoise/pixel.
      { binding: 7, texture: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'frame',
  });
  const cellLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX }],
    label: 'cell',
  });
  const materialLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'material',
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [frameLayout, cellLayout, materialLayout],
    label: 'world',
  });
  const module = device.createShaderModule({ code: resolveShader('world'), label: 'world' });
  const vertexBuffers: GPUVertexBufferLayout[] = [
    {
      arrayStride: OSCELL_VERTEX_STRIDE,
      attributes: [
        { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position
        { format: 'float32x2', offset: 16, shaderLocation: 1 }, // uv
        { format: 'unorm8x4', offset: 24, shaderLocation: 2 }, // dayPrelit
        { format: 'uint16x2', offset: 32, shaderLocation: 3 }, // layer + packed channels
        { format: 'snorm8x4', offset: 12, shaderLocation: 4 }, // normal (sun N·L — 074/06)
        { format: 'unorm8x4', offset: 28, shaderLocation: 5 }, // nightPrelit + sway alpha
      ],
    },
  ];

  // Every pipeline is STARTED here and awaited once at the end (201/4-03). `createRenderPipelineAsync`
  // hands the compile to the implementation's own threads, so 34 of them overlap instead of blocking the
  // main thread one after another — on a phone that is the difference between a boot that stalls and one
  // that streams. The descriptors are unchanged; only WHEN the pipeline exists is.
  const pipelines = new Map<PipelineId, Promise<GPURenderPipeline>>();
  const variants: {
    additive?: boolean;
    blend: boolean;
    cull: GPUCullMode;
    cutout: boolean;
    entry: string;
    id: PipelineId;
  }[] = [
    { blend: false, cull: 'back', cutout: false, entry: 'fsWorld', id: 'world-opaque-front' },
    { blend: false, cull: 'none', cutout: false, entry: 'fsWorld', id: 'world-opaque-double' },
    { blend: false, cull: 'back', cutout: true, entry: 'fsWorldCutout', id: 'world-cutout-front' },
    { blend: false, cull: 'none', cutout: true, entry: 'fsWorldCutout', id: 'world-cutout-double' },
    { blend: true, cull: 'back', cutout: false, entry: 'fsWorld', id: 'world-blend-front' },
    { blend: true, cull: 'none', cutout: false, entry: 'fsWorld', id: 'world-blend-double' },
    { blend: true, cull: 'back', cutout: false, entry: 'fsBeam', id: 'world-beam-front' },
    { blend: true, cull: 'none', cutout: false, entry: 'fsBeam', id: 'world-beam-double' },
    // Additive neon overlays (085 row C — IdeFlag.ADDITIVE, pipelineClass 4): the beam's self-lit shading,
    // but the light ADDS onto the base building instead of compositing over it, the vanilla RW blend.
    { additive: true, blend: true, cull: 'back', cutout: false, entry: 'fsBeam', id: 'world-additive-front' },
    { additive: true, blend: true, cull: 'none', cutout: false, entry: 'fsBeam', id: 'world-additive-double' },
  ];
  // Premultiplied-alpha compositing (textures ship premultiplied; fsBeam premultiplies the cone).
  const premultBlend: GPUBlendState = {
    alpha: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
    color: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
  };
  // Additive light (085 row C): dst + src on colour, dst alpha untouched — premultiplied texels add clean.
  const additiveBlend: GPUBlendState = {
    alpha: { dstFactor: 'one', operation: 'add', srcFactor: 'zero' },
    color: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
  };
  const skyModule = device.createShaderModule({ code: resolveShader('sky'), label: 'sky' });
  const skyLayout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout], label: 'sky' });
  // Water v1 (074/06 row 12): frame group + the ripple texture; one big translucent surface drawn after
  // the sky, before the blend bundles (foliage/glass then sort over it; depth READ hides it under land).
  const waterLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, texture: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'water',
  });
  const waterModule = device.createShaderModule({ code: resolveShader('water'), label: 'water' });
  pipelines.set(
    'water',
    device.createRenderPipelineAsync({
      depthStencil: { depthCompare: 'greater', depthWriteEnabled: false, format: depthFormat },
      fragment: {
        entryPoint: 'fsWater',
        module: waterModule,
        targets: [{ blend: premultBlend, format: colorFormat }],
      },
      label: 'water',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, waterLayout], label: 'water' }),
      multisample: { count: MSAA_SAMPLES },
      primitive: { cullMode: 'none', topology: 'triangle-list' },
      vertex: {
        // Stride 20: engine-space position + baked shore distance (074/06 row 12 v2) + water class (plan 075:
        // 0 = sea, 1 = inland — inland renders calm so pools don't spill their waves).
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 0 },
              { format: 'float32', offset: 12, shaderLocation: 1 },
              { format: 'float32', offset: 16, shaderLocation: 2 },
            ],
          },
        ],
        entryPoint: 'vsWater',
        module: waterModule,
      },
    }),
  );
  // Skinning probe (074/08 B1): storage palette + 4-bone blend; separate tight attribute buffers (the
  // dynamics vertex layout is NOT the .oscell layout — that consequence is exactly what the probe freezes).
  const pedLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 1, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'ped',
  });
  // Rigid dynamics (074/08 B2): part matrices in storage, texture ARRAY (vehicle TXD layers), opaque +
  // premultiplied-glass variants. Vertex layout family #3 (pos/normal/uv/color/meta tight buffers).
  const rigidLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 1, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
      // Per-instance carcols paint (074/08 B5) — 4 colours per matrix row.
      { binding: 3, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      // Per-instance lamp state (074/08 B5 step 5) — headlights + brakes, one vec4 per matrix row.
      {
        binding: 4,
        buffer: { type: 'read-only-storage' },
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      },
      // The scene environment probe (074/16 step 2): a mipped cubemap of the ACTUAL world around the player
      // car — the reflection SOURCE. Created once at init (fixed size — probes are constants), so binding its
      // view here is bundle-safe even though its CONTENTS refresh one face per frame.
      { binding: 5, texture: { viewDimension: 'cube' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 6, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
      // License plates (plan 082/03). One vec4 per matrix row naming this instance's plate: x = its layer
      // in the generated TEXT atlas, y = which of the three city backgrounds it wears. Read in the VERTEX
      // stage, which forwards the one layer this submesh needs — the fragment output struct has no free
      // inter-stage location left to carry the instance index itself.
      { binding: 7, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      // The two plate texture arrays are ENGINE-owned and shared by every model: generated 64×16 text
      // rasters, and the three city backgrounds at whatever size the game's TXD ships them.
      { binding: 8, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 9, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      // UV animation (plan 099/02): ONE vec4 selected per draw by a dynamic offset — slot 0 is the identity
      // every static submesh binds, so this costs a no-op multiply-add on the models that animate nothing.
      // Rigid draws are pass-encoded, never recorded into a bundle, so growing this layout cannot stale one.
      {
        binding: 10,
        buffer: { hasDynamicOffset: true, minBindingSize: 16, type: 'uniform' },
        visibility: GPUShaderStage.VERTEX,
      },
    ],
    label: 'rigid',
  });
  const rigidModule = device.createShaderModule({ code: resolveShader('rigid'), label: 'rigid' });
  const rigidPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [frameLayout, rigidLayout],
    label: 'rigid',
  });
  const rigidBuffers: GPUVertexBufferLayout[] = [
    { arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }] },
    { arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 1 }] },
    { arrayStride: 8, attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 2 }] },
    { arrayStride: 4, attributes: [{ format: 'unorm8x4', offset: 0, shaderLocation: 3 }] },
    { arrayStride: 4, attributes: [{ format: 'uint8x4', offset: 0, shaderLocation: 4 }] },
    // Reflection slots (B5r): env layer + coefficient + intensity + specular level, all from the DFF.
    { arrayStride: 4, attributes: [{ format: 'uint8x4', offset: 0, shaderLocation: 5 }] },
    // NIGHT vertex colours (opensa-pack 003 phase 5g), the rigid twin of the cell path's `nightPrelit`.
    { arrayStride: 4, attributes: [{ format: 'unorm8x4', offset: 0, shaderLocation: 6 }] },
  ];
  for (const variant of [
    { blend: false, entry: 'fsRigid', id: 'rigid-opaque' as const },
    { blend: true, entry: 'fsRigidBlend', id: 'rigid-blend' as const },
  ]) {
    pipelines.set(
      variant.id,
      device.createRenderPipelineAsync({
        depthStencil: {
          depthCompare: variant.blend ? 'greater-equal' : 'greater',
          depthWriteEnabled: !variant.blend,
          format: depthFormat,
        },
        fragment: {
          entryPoint: variant.entry,
          module: rigidModule,
          targets: [
            {
              format: colorFormat,
              ...(variant.blend
                ? {
                    blend: {
                      alpha: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
                      color: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
                    } satisfies GPUBlendState,
                  }
                : {}),
            },
          ],
        },
        label: variant.id,
        layout: rigidPipelineLayout,
        multisample: { count: MSAA_SAMPLES },
        // Double-sided: SA vehicle interiors/glass are single-sided shells viewed from both sides.
        primitive: { cullMode: 'none', frontFace: 'ccw', topology: 'triangle-list' },
        vertex: { buffers: rigidBuffers, entryPoint: 'vsRigid', module: rigidModule },
      }),
    );
  }
  const pedModule = device.createShaderModule({ code: resolveShader('ped'), label: 'ped' });
  pipelines.set(
    'ped',
    device.createRenderPipelineAsync({
      depthStencil: { depthCompare: 'greater', depthWriteEnabled: true, format: depthFormat },
      fragment: { entryPoint: 'fsPed', module: pedModule, targets: [{ format: colorFormat }] },
      label: 'ped',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, pedLayout], label: 'ped' }),
      multisample: { count: MSAA_SAMPLES },
      // Double-sided for the probe: SA ped meshes carry single-sided skirts/hair shells.
      primitive: { cullMode: 'none', frontFace: 'ccw', topology: 'triangle-list' },
      vertex: {
        buffers: [
          { arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }] },
          { arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 1 }] },
          { arrayStride: 8, attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 2 }] },
          { arrayStride: 4, attributes: [{ format: 'uint8x4', offset: 0, shaderLocation: 3 }] },
          { arrayStride: 4, attributes: [{ format: 'unorm8x4', offset: 0, shaderLocation: 4 }] },
        ],
        entryPoint: 'vsPed',
        module: pedModule,
      },
    }),
  );
  // 2dfx coronas (074/06 row 13): instanced additive billboards, depth READ (occluders hide them).
  // 2dfx particles (B6): instanced camera-facing sprites whose whole lifecycle runs in the vertex shader.
  // Two blend variants — smoke ALPHA-blends, fire/sparks add — over one shared sprite array.
  const particleLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 1, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'particle',
  });
  const particleModule = device.createShaderModule({ code: resolveShader('particle'), label: 'particle' });
  const particleBuffers: GPUVertexBufferLayout[] = [
    { arrayStride: 8, attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 0 }] },
    {
      arrayStride: 36,
      attributes: [
        { format: 'float32x3', offset: 0, shaderLocation: 1 }, // spawn
        { format: 'float32x3', offset: 12, shaderLocation: 2 }, // velocity
        { format: 'float32x3', offset: 24, shaderLocation: 3 }, // life, phase, system
      ],
      stepMode: 'instance',
    },
  ];
  // The `-once` pair is the DYNAMIC lane (089/01): same shader, but the `oneShot` override clamps the
  // age instead of looping it — a spawned particle plays once and collapses.
  for (const variant of [
    { add: true, constants: { oneShot: 0 }, id: 'particle-add' as const },
    { add: false, constants: { oneShot: 0 }, id: 'particle-blend' as const },
    { add: true, constants: { oneShot: 1 }, id: 'particle-add-once' as const },
    { add: false, constants: { oneShot: 1 }, id: 'particle-blend-once' as const },
  ]) {
    pipelines.set(
      variant.id,
      device.createRenderPipelineAsync({
        depthStencil: { depthCompare: 'greater', depthWriteEnabled: false, format: depthFormat },
        fragment: {
          entryPoint: 'fsParticle',
          module: particleModule,
          targets: [
            {
              blend: variant.add
                ? {
                    alpha: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
                    color: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
                  }
                : premultBlend,
              format: colorFormat,
            },
          ],
        },
        label: variant.id,
        layout: device.createPipelineLayout({
          bindGroupLayouts: [frameLayout, particleLayout],
          label: 'particle',
        }),
        multisample: { count: MSAA_SAMPLES },
        primitive: { topology: 'triangle-list' },
        vertex: {
          buffers: particleBuffers,
          constants: variant.constants,
          entryPoint: 'vsParticle',
          module: particleModule,
        },
      }),
    );
  }

  // Skid-mark decals (089/03): ground ribbon quads over the finished opaque world — premultiplied, depth
  // READ only (the road occludes them normally, they never occlude anything), no cull (a mark must read
  // from a low chase camera whatever the winding the ribbon's turn produced).
  const skidLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'skid',
  });
  const skidModule = device.createShaderModule({ code: resolveShader('skid'), label: 'skid' });
  pipelines.set(
    'skid',
    device.createRenderPipelineAsync({
      depthStencil: { depthCompare: 'greater', depthWriteEnabled: false, format: depthFormat },
      fragment: { entryPoint: 'fsSkid', module: skidModule, targets: [{ blend: premultBlend, format: colorFormat }] },
      label: 'skid',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, skidLayout], label: 'skid' }),
      multisample: { count: MSAA_SAMPLES },
      primitive: { cullMode: 'none', topology: 'triangle-list' },
      vertex: {
        buffers: [
          {
            arrayStride: 28,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position
              { format: 'float32x2', offset: 12, shaderLocation: 1 }, // uv
              { format: 'float32x2', offset: 20, shaderLocation: 2 }, // alpha, birth
            ],
          },
        ],
        entryPoint: 'vsSkid',
        module: skidModule,
      },
    }),
  );

  // Prop debris (B7·a): one draw per break. Every vertex carries its shard's whole flight, so the pass is
  // pure geometry + a 16-byte uniform; the shards are alpha-blended and write no depth (they overlap).
  const debrisLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT },
      { binding: 1, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'debris',
  });
  const debrisModule = device.createShaderModule({ code: resolveShader('debris'), label: 'debris' });
  pipelines.set(
    'debris',
    device.createRenderPipelineAsync({
      depthStencil: { depthCompare: 'greater', depthWriteEnabled: false, format: depthFormat },
      fragment: {
        entryPoint: 'fsDebris',
        module: debrisModule,
        targets: [{ blend: premultBlend, format: colorFormat }],
      },
      label: 'debris',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, debrisLayout], label: 'debris' }),
      multisample: { count: MSAA_SAMPLES },
      // Shards are single-sided triangles torn out of a closed mesh — both faces must draw.
      primitive: { cullMode: 'none', topology: 'triangle-list' },
      vertex: {
        buffers: [
          {
            arrayStride: 80,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position (world, engine space)
              { format: 'float32x2', offset: 12, shaderLocation: 1 }, // uv
              { format: 'float32x4', offset: 20, shaderLocation: 2 }, // colour
              { format: 'float32x3', offset: 36, shaderLocation: 3 }, // shard centroid
              { format: 'float32x3', offset: 48, shaderLocation: 4 }, // velocity
              { format: 'float32x3', offset: 60, shaderLocation: 5 }, // spin axis x speed
              { format: 'float32x2', offset: 72, shaderLocation: 6 }, // land time, texture layer
            ],
          },
        ],
        entryPoint: 'vsDebris',
        module: debrisModule,
      },
    }),
  );

  // Debug wireframes (074/13 phase 4): COL collision hulls and mesh edges, as world-space line lists.
  // Depth-TESTED but never depth-WRITING — an overlay that hides behind geometry it is actually behind,
  // without punching holes in anything drawn after it.
  const debugLineLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT }],
    label: 'debug-line',
  });
  compileDebugLinePipelines(device, colorFormat, depthFormat, debugLineLayout, frameLayout, pipelines);
  const coronaModule = device.createShaderModule({ code: resolveShader('corona'), label: 'corona' });
  pipelines.set(
    'corona',
    device.createRenderPipelineAsync({
      // Reversed-Z everywhere (z-fighting fix): float depth, clear 0, GREATER passes nearer fragments.
      depthStencil: { depthCompare: 'greater', depthWriteEnabled: false, format: depthFormat },
      fragment: {
        entryPoint: 'fsCorona',
        module: coronaModule,
        targets: [
          {
            blend: {
              alpha: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
              color: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
            },
            format: colorFormat,
          },
        ],
      },
      label: 'corona',
      layout: skyLayout,
      multisample: { count: MSAA_SAMPLES },
      primitive: { topology: 'triangle-list' },
      vertex: {
        buffers: [
          {
            arrayStride: 8,
            attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 0 }],
          },
          {
            arrayStride: 32,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 1 },
              { format: 'float32', offset: 12, shaderLocation: 2 },
              { format: 'float32x4', offset: 16, shaderLocation: 3 },
            ],
            stepMode: 'instance',
          },
        ],
        entryPoint: 'vsCorona',
        module: coronaModule,
      },
    }),
  );
  // Godrays post pass (074/09 stage 1, field round 3 — prod parity via postprocessing's GodRaysEffect):
  // fullscreen triangle, radial blur of thresholded scene brightness toward the sun's screen position,
  // composited into the sRGB swapchain. No depth, no MSAA — it reads the RESOLVED scene.
  const postLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
      // Bloom chain result (074/09) — sampled by the composite even at intensity 0 (bind something).
      { binding: 3, texture: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'post',
  });
  const postModule = device.createShaderModule({ code: resolveShader('post'), label: 'post' });
  pipelines.set(
    'post',
    device.createRenderPipelineAsync({
      fragment: { entryPoint: 'fsPost', module: postModule, targets: [{ format: outputFormat }] },
      label: 'post',
      layout: device.createPipelineLayout({ bindGroupLayouts: [postLayout], label: 'post' }),
      primitive: { topology: 'triangle-list' },
      vertex: { entryPoint: 'vsPost', module: postModule },
    }),
  );
  const { bloomLayout, bloomUpLayout } = compileBloomPipelines(device, colorFormat, pipelines);
  const probeMipLayout = compileProbePipelines(device, colorFormat, pipelines);
  // Cumulus field bake (sky v2 perf): a 256² rg16float target, the frame uniform alone — its own tiny
  // layout because the pass RENDERS INTO the texture the frame group binds (same-pass usage conflict).
  const cloudFieldLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT }],
    label: 'cloud-field',
  });
  const cloudFieldModule = device.createShaderModule({ code: resolveShader('cloud-field'), label: 'cloud-field' });
  pipelines.set(
    'cloud-field',
    device.createRenderPipelineAsync({
      fragment: { entryPoint: 'fsCloudField', module: cloudFieldModule, targets: [{ format: 'rg16float' }] },
      label: 'cloud-field',
      layout: device.createPipelineLayout({ bindGroupLayouts: [cloudFieldLayout], label: 'cloud-field' }),
      primitive: { topology: 'triangle-list' },
      vertex: { entryPoint: 'vsCloudField', module: cloudFieldModule },
    }),
  );
  // Probe DEBUG view (074/16): fullscreen cube-by-camera-ray, drawn at the END of the world pass over
  // everything (depth 'always') — the orientation check that beats convention-table archaeology.
  const probeViewLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, texture: { viewDimension: 'cube' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'probe-view',
  });
  const probeViewModule = device.createShaderModule({ code: resolveShader('probe-view'), label: 'probe-view' });
  pipelines.set(
    'probe-view',
    device.createRenderPipelineAsync({
      depthStencil: { depthCompare: 'always', depthWriteEnabled: false, format: depthFormat },
      fragment: { entryPoint: 'fsProbeView', module: probeViewModule, targets: [{ format: colorFormat }] },
      label: 'probe-view',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, probeViewLayout], label: 'probe-view' }),
      multisample: { count: MSAA_SAMPLES },
      primitive: { topology: 'triangle-list' },
      vertex: { entryPoint: 'vsProbeView', module: probeViewModule },
    }),
  );
  pipelines.set(
    'sky',
    device.createRenderPipelineAsync({
      // Reversed-Z far plane (depth 0). The sky draws FIRST in the frame (vs the cleared buffer): blended
      // classes write no depth, so a late sky would repaint them wherever their background is sky.
      depthStencil: { depthCompare: 'greater-equal', depthWriteEnabled: false, format: depthFormat },
      fragment: { entryPoint: 'fsSky', module: skyModule, targets: [{ format: colorFormat }] },
      label: 'sky',
      layout: skyLayout,
      multisample: { count: MSAA_SAMPLES },
      primitive: { topology: 'triangle-list' },
      vertex: { entryPoint: 'vsSky', module: skyModule },
    }),
  );
  // Procedural clutter (074/19 B7·d): per-instance matrices in storage + the model texture; opaque (rocks) +
  // cutout (A2C — grass/bushes) variants, both depth-written in the opaque phase like the static world.
  const clutterLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 1, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
      // The group's squared draw distance — the per-instance visibility test (P2 per-category ranges).
      { binding: 3, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX },
    ],
    label: 'clutter',
  });
  const clutterModule = device.createShaderModule({ code: resolveShader('clutter'), label: 'clutter' });
  const clutterPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [frameLayout, clutterLayout],
    label: 'clutter',
  });
  // The shared vehicle-model vertex layout (buildVehicleModel): pos/normal/uv/color + meta (meta.x = layer).
  const clutterBuffers: GPUVertexBufferLayout[] = [
    { arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }] },
    { arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 1 }] },
    { arrayStride: 8, attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 2 }] },
    { arrayStride: 4, attributes: [{ format: 'unorm8x4', offset: 0, shaderLocation: 3 }] },
    { arrayStride: 4, attributes: [{ format: 'uint8x4', offset: 0, shaderLocation: 4 }] },
    // NIGHT vertex colours — clutter species ship authored ones, so they are read, not guessed.
    { arrayStride: 4, attributes: [{ format: 'unorm8x4', offset: 0, shaderLocation: 5 }] },
  ];
  for (const cutout of [false, true]) {
    pipelines.set(
      cutout ? 'clutter-cutout' : 'clutter-opaque',
      device.createRenderPipelineAsync({
        depthStencil: { depthCompare: 'greater', depthWriteEnabled: true, format: depthFormat },
        fragment: {
          entryPoint: cutout ? 'fsClutterCutout' : 'fsClutter',
          module: clutterModule,
          targets: [{ format: colorFormat }],
        },
        label: cutout ? 'clutter-cutout' : 'clutter-opaque',
        layout: clutterPipelineLayout,
        multisample: { alphaToCoverageEnabled: cutout, count: MSAA_SAMPLES },
        // Double-sided: SA grass/bush cards are single-sided planes viewed from both sides.
        primitive: { cullMode: 'none', frontFace: 'ccw', topology: 'triangle-list' },
        vertex: { buffers: clutterBuffers, entryPoint: 'vsClutter', module: clutterModule },
      }),
    );
  }

  for (const variant of variants) {
    const blendState = worldBlendState(variant, premultBlend, additiveBlend);
    pipelines.set(
      variant.id,
      device.createRenderPipelineAsync({
        // Reversed-Z: GREATER for depth-written classes; blended classes read-only AND pass EQUAL depths —
        // coplanar overlays (night windows, wall signs) composite stably instead of shimmering.
        depthStencil: {
          depthCompare: variant.blend ? 'greater-equal' : 'greater',
          depthWriteEnabled: !variant.blend,
          format: depthFormat,
        },
        fragment: {
          entryPoint: variant.entry,
          module,
          targets: [{ format: colorFormat, ...(blendState === undefined ? {} : { blend: blendState }) }],
        },
        label: variant.id,
        layout,
        multisample: { alphaToCoverageEnabled: variant.cutout, count: MSAA_SAMPLES },
        primitive: { cullMode: variant.cull, frontFace: 'ccw', topology: 'triangle-list' },
        vertex: { buffers: vertexBuffers, entryPoint: 'vsWorld', module },
      }),
    );
  }

  // One await for all of them: a rejected compile (a shader that no longer validates) fails the boot here
  // rather than at the first draw that binds it.
  const compiled = new Map<PipelineId, GPURenderPipeline>(
    await Promise.all(
      [...pipelines].map(async ([id, pipeline]): Promise<[PipelineId, GPURenderPipeline]> => [id, await pipeline]),
    ),
  );

  return {
    bloomLayout,
    bloomUpLayout,
    cellLayout,
    cloudFieldLayout,
    clutterLayout,
    debrisLayout,
    debugLineLayout,
    frameLayout,
    get(id: PipelineId): GPURenderPipeline {
      const pipeline = compiled.get(id);
      if (!pipeline) {
        throw new Error(`pipeline miss in steady state: ${id} (074 ground rule 3 — enumerate it in compileAll)`);
      }

      return pipeline;
    },
    materialLayout,
    particleLayout,
    pedLayout,
    postLayout,
    probeMipLayout,
    probeViewLayout,
    rigidLayout,
    skidLayout,
    waterLayout,
  };
}

/** `.oscell` group → pipeline id (pipelineClass 0 opaque | 1 cutout | 2 blend | 3 beam | 4 additive;
 *  side 0 front | 1 double). */
export function pipelineIdFor(pipelineClass: number, side: number): PipelineId {
  const kind = (['opaque', 'cutout', 'blend', 'beam', 'additive'] as const)[pipelineClass] ?? 'cutout';

  return `world-${kind}-${side === 1 ? 'double' : 'front'}`;
}

/** Bloom chain (074/09 — prod BloomEffect, mipmapBlur path): full-res luminance prefilter → 13-tap
 *  downsample mips → 9-tap tent upsamples blending over the same-size down mip. All 16f, no depth/MSAA. */
function compileBloomPipelines(
  device: GPUDevice,
  colorFormat: GPUTextureFormat,
  pipelines: Map<PipelineId, Promise<GPURenderPipeline>>,
): { bloomLayout: GPUBindGroupLayout; bloomUpLayout: GPUBindGroupLayout } {
  const bloomLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'bloom',
  });
  const bloomUpLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 3, texture: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'bloom-up',
  });
  const bloomModule = device.createShaderModule({ code: resolveShader('bloom'), label: 'bloom' });
  const entries: readonly [PipelineId, string, GPUBindGroupLayout][] = [
    ['bloom-prefilter', 'fsBloomPrefilter', bloomLayout],
    ['bloom-down', 'fsBloomDown', bloomLayout],
    ['bloom-up', 'fsBloomUp', bloomUpLayout],
  ];
  for (const [id, entryPoint, groupLayout] of entries) {
    pipelines.set(
      id,
      device.createRenderPipelineAsync({
        fragment: { entryPoint, module: bloomModule, targets: [{ format: colorFormat }] },
        label: id,
        layout: device.createPipelineLayout({ bindGroupLayouts: [groupLayout], label: id }),
        primitive: { topology: 'triangle-list' },
        vertex: { entryPoint: 'vsBloom', module: bloomModule },
      }),
    );
  }

  return { bloomLayout, bloomUpLayout };
}

/** Debug wireframes (074/13 phase 4). Two depth behaviours share one shader: the default hides behind
 *  geometry it is actually behind (a collision hull reads as solid), while 'through' ignores depth —
 *  a SKELETON inside a body is useless if the body occludes it, which is why three's SkeletonHelper
 *  disables the depth test too. */
function compileDebugLinePipelines(
  device: GPUDevice,
  colorFormat: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  debugLineLayout: GPUBindGroupLayout,
  frameLayout: GPUBindGroupLayout,
  pipelines: Map<PipelineId, Promise<GPURenderPipeline>>,
): void {
  const module = device.createShaderModule({ code: resolveShader('debug-line'), label: 'debug-line' });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout, debugLineLayout], label: 'debug-line' });

  for (const [id, depthCompare] of [
    ['debug-line', 'greater'],
    ['debug-line-through', 'always'],
  ] as const) {
    pipelines.set(
      id,
      device.createRenderPipelineAsync({
        depthStencil: { depthCompare, depthWriteEnabled: false, format: depthFormat },
        fragment: { entryPoint: 'fsDebugLine', module, targets: [{ format: colorFormat }] },
        label: id,
        layout,
        multisample: { count: MSAA_SAMPLES },
        primitive: { topology: 'line-list' },
        vertex: {
          buffers: [{ arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }] }],
          entryPoint: 'vsDebugLine',
          module,
        },
      }),
    );
  }
}

/**
 * Env-probe passes (074/16 step 2): 'probe-blit' = the V-flipped face copy (GL cube-face row order vs WebGPU
 * render row order — see fsProbeBlit); 'probe-mip' = one bilinear tap at the destination texel centre, an
 * exact 2×2 box downsample between power-of-two cube-face mips (the prefiltered-roughness ladder the rigid
 * shader samples with `textureSampleLevel`). No uniform — the sampler footprint does the work.
 */
function compileProbePipelines(
  device: GPUDevice,
  colorFormat: GPUTextureFormat,
  pipelines: Map<PipelineId, Promise<GPURenderPipeline>>,
): GPUBindGroupLayout {
  const probeMipLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'probe-mip',
  });
  const probeModule = device.createShaderModule({ code: resolveShader('probe'), label: 'probe' });
  const probePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [probeMipLayout], label: 'probe-mip' });
  for (const [id, entryPoint] of [
    ['probe-blit', 'fsProbeBlit'],
    ['probe-mip', 'fsProbeMip'],
  ] as const) {
    pipelines.set(
      id,
      device.createRenderPipelineAsync({
        fragment: { entryPoint, module: probeModule, targets: [{ format: colorFormat }] },
        label: id,
        layout: probePipelineLayout,
        primitive: { topology: 'triangle-list' },
        vertex: { entryPoint: 'vsProbeMip', module: probeModule },
      }),
    );
  }

  return probeMipLayout;
}

/** Blend state for a world variant: none (a depth-writing class), premultiplied over, or additive light. */
function worldBlendState(
  variant: { additive?: boolean; blend: boolean },
  premult: GPUBlendState,
  additive: GPUBlendState,
): GPUBlendState | undefined {
  if (!variant.blend) {
    return undefined;
  }

  return variant.additive === true ? additive : premult;
}
