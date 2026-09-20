/* eslint-disable @typescript-eslint/no-empty-function -- a recording fake IGNORES most calls by design:
   an empty body is the behaviour, not an unfinished one. Only the calls a test asserts on record anything. */
/**
 * A recording stand-in for `GPUDevice` — the device-independent seam (plan 077).
 *
 * The engine is not testable headlessly because it needs a GPU, but almost nothing it DECIDES needs one:
 * which cells pass the ring test, which objects the hour gate admits, what order the passes run in, how the
 * texture LRU evicts. This fake implements the exact WebGPU surface the engine uses — enumerated from the
 * source, not guessed — and records every call, so a test can assert **what the engine decided to draw**.
 *
 * It is deliberately NOT a validator: it does not check descriptor legality (the browser and the bench do
 * that). A test that only proves `createBuffer` was called proves nothing; assert against `draws`,
 * `passes` and `writes` instead.
 *
 * Install it with {@link installFakeWebGpu}, which also fakes `navigator.gpu` and the canvas, so
 * `Engine.init()` runs unmodified — the engine's own `initDevice()` is device-independent code that only
 * touches `navigator.gpu`.
 */

export interface FakeGpu {
  /** Usage flags every created buffer was asked for, by label. A missing usage flag is invisible to every
   *  other assertion here and fails only on a real device, at bind-group creation. */
  readonly bufferUsage: Map<string, number>;
  /** Labels of every buffer/texture destroyed — leak assertions read this. */
  readonly destroyed: string[];
  /** The GPUDevice stand-in to hand to engine code. */
  readonly device: GPUDevice;
  /** Every draw issued, in order, across all passes and bundles. */
  readonly draws: RecordedDraw[];
  /** Labels of every texture created and not destroyed. */
  liveTextures(): string[];
  /** Render passes in submission order. */
  readonly passes: RecordedPass[];
  /** Drop everything recorded so far — call between frames to assert one frame in isolation. */
  reset(): void;
  /** `queue.writeTexture` calls, in order (085: the missing-texture repaint is asserted from here). */
  readonly textureWrites: RecordedTextureWrite[];
  /** `queue.writeBuffer` calls, in order. */
  readonly writes: RecordedWrite[];
}

/** One recorded draw, with the pipeline and bind groups in force when it was issued. */
export interface RecordedDraw {
  /** Dynamic offsets in force per bind-group index (undefined where the group has none). A bind group with
   *  `hasDynamicOffset` bindings is a DIFFERENT binding at a different offset, which the label cannot say —
   *  the rigid lane's UV-animation slot (plan 099/02) is selected this way. */
  bindGroupOffsets: (readonly number[] | undefined)[];
  bindGroups: (string | undefined)[];
  /** Present for `drawIndexed`. */
  indexCount?: number;
  instanceCount: number;
  kind: 'draw' | 'drawIndexed';
  /** The label of the render pass (or bundle) this draw belongs to. */
  pass: string;
  /** The label of the pipeline set before this draw, if any. */
  pipeline: string | undefined;
  vertexCount?: number;
}

/** One recorded render pass, in submission order. */
export interface RecordedPass {
  /** Labels of bundles executed into this pass, in order. */
  bundles: string[];
  drawCount: number;
  label: string;
}

/** One recorded `queue.writeTexture` — the destination layer and a COPY of the texel bytes. */
export interface RecordedTextureWrite {
  data: Uint8Array;
  label: string | undefined;
  /** `origin.z` — the array layer written. */
  z: number;
}

/** One recorded `queue.writeBuffer`. */
export interface RecordedWrite {
  byteLength: number;
  /** A COPY of the written bytes — buffer packing (offsets, strides, flag bits) is asserted from here. */
  data: Uint8Array;
  label: string | undefined;
  offset: number;
}

interface Recorder {
  bufferUsage: Map<string, number>;
  destroyed: string[];
  draws: RecordedDraw[];
  passes: RecordedPass[];
  textures: Map<string, boolean>;
  textureWrites: RecordedTextureWrite[];
  writes: RecordedWrite[];
}

/** A `GPUDevice` stand-in recording everything the engine asks of it. */
export function createFakeDevice(): FakeGpu {
  const recorder: Recorder = {
    bufferUsage: new Map(),
    destroyed: [],
    draws: [],
    passes: [],
    textures: new Map(),
    textureWrites: [],
    writes: [],
  };

  const view = (label: string): unknown => ({ label });

  const texture = (descriptor: GPUTextureDescriptor): unknown => {
    const label = descriptor.label ?? 'texture';
    recorder.textures.set(label, true);

    return {
      createView: (options?: GPUTextureViewDescriptor) => view(options?.label ?? label),
      destroy: (): void => {
        recorder.textures.set(label, false);
        recorder.destroyed.push(label);
      },
      label,
    };
  };

  const buffer = (descriptor: GPUBufferDescriptor): unknown => {
    recorder.bufferUsage.set(descriptor.label ?? 'buffer', descriptor.usage);

    return {
      destroy: (): void => {
        recorder.destroyed.push(descriptor.label ?? 'buffer');
      },
      getMappedRange: () => new ArrayBuffer(descriptor.size),
      label: descriptor.label,
      mapAsync: () => Promise.resolve(),
      size: descriptor.size,
      unmap: (): void => {},
    };
  };

  const commandEncoder = (): unknown => {
    let current: RecordedPass = { bundles: [], drawCount: 0, label: 'unlabelled' };

    return {
      beginRenderPass(descriptor: GPURenderPassDescriptor): unknown {
        current = { bundles: [], drawCount: 0, label: descriptor.label ?? 'unlabelled' };
        recorder.passes.push(current);

        return encoderRecorder(recorder, current);
      },
      copyBufferToBuffer(): void {},
      copyTextureToTexture(): void {},
      finish: () => ({ label: 'command-buffer' }),
      resolveQuerySet(): void {},
    };
  };

  const device = {
    createBindGroup: (descriptor: GPUBindGroupDescriptor): unknown => ({ label: descriptor.label }),
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor): unknown => ({ label: descriptor.label }),
    createBuffer: buffer,
    createCommandEncoder: commandEncoder,
    createPipelineLayout: (descriptor: GPUPipelineLayoutDescriptor): unknown => ({ label: descriptor.label }),
    createQuerySet: (descriptor: GPUQuerySetDescriptor): unknown => ({
      destroy: (): void => {},
      label: descriptor.label,
    }),
    createRenderBundleEncoder(descriptor: GPURenderBundleEncoderDescriptor): unknown {
      const pass: RecordedPass = { bundles: [], drawCount: 0, label: descriptor.label ?? 'bundle' };

      return {
        ...encoderRecorder(recorder, pass),
        finish: (options?: { label?: string }) => ({ label: options?.label ?? pass.label }),
      };
    },
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor): unknown => ({ label: descriptor.label }),
    // The engine compiles asynchronously (201/4-03); the fake resolves immediately, so a test still gets
    // its pipelines within one microtask turn.
    createRenderPipelineAsync: (descriptor: GPURenderPipelineDescriptor): Promise<unknown> =>
      Promise.resolve({ label: descriptor.label }),
    createSampler: (descriptor?: GPUSamplerDescriptor): unknown => ({ label: descriptor?.label }),
    createShaderModule: (descriptor: GPUShaderModuleDescriptor): unknown => ({ label: descriptor.label }),
    createTexture: texture,
    destroy: (): void => {},
    features: new Set<string>(['texture-compression-bc']),
    limits: { maxTextureArrayLayers: 256, maxTextureDimension2D: 8192 },
    queue: {
      onSubmittedWorkDone: (): Promise<void> => Promise.resolve(),
      submit: (): void => {},
      writeBuffer: (
        target: { label?: string },
        offset: number,
        data: ArrayBuffer | ArrayBufferView,
        dataOffset = 0,
        size?: number,
      ): void => {
        // dataOffset/size are in ELEMENTS for typed-array views (the WebGPU spec) — partial uploads
        // (coronas, the dynamic particle lane) must record what was actually written, not the whole scratch.
        const stride = ArrayBuffer.isView(data) ? ((data as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1) : 1;
        const view = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        const from = dataOffset * stride;
        const to = size === undefined ? view.byteLength : from + size * stride;
        const written = view.subarray(from, to);
        recorder.writes.push({
          byteLength: written.byteLength,
          data: new Uint8Array(written),
          label: target.label,
          offset,
        });
      },
      writeTexture: (
        destination: { origin?: { z?: number }; texture: { label?: string } },
        data: ArrayBuffer | ArrayBufferView,
      ): void => {
        const view = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        recorder.textureWrites.push({
          data: new Uint8Array(view),
          label: destination.texture.label,
          z: destination.origin?.z ?? 0,
        });
      },
    },
  };

  return {
    bufferUsage: recorder.bufferUsage,
    destroyed: recorder.destroyed,
    device: device as unknown as GPUDevice,
    draws: recorder.draws,
    liveTextures: () => [...recorder.textures].filter(([, live]) => live).map(([label]) => label),
    passes: recorder.passes,
    reset(): void {
      recorder.draws.length = 0;
      recorder.passes.length = 0;
      recorder.writes.length = 0;
      recorder.textureWrites.length = 0;
      recorder.destroyed.length = 0;
    },
    textureWrites: recorder.textureWrites,
    writes: recorder.writes,
  };
}

/**
 * Installs the fake as `navigator.gpu` plus a canvas stub, so `Engine.init()` runs unmodified.
 * Returns the recorder and a `restore()` to put the globals back.
 */
export function installFakeWebGpu(options: { adapterFeatures?: readonly string[]; timestamps?: boolean } = {}): {
  canvas: HTMLCanvasElement;
  gpu: FakeGpu;
  /** What `initDevice` asked `requestDevice` for — the no-BC gate reads it (see `device.test.ts`). */
  requestedFeatures: string[];
  restore(): void;
} {
  const gpu = createFakeDevice();
  // `adapterFeatures` is how a MOBILE adapter is simulated: the same fake, minus BC. A desktop-shaped
  // default keeps every existing caller unchanged.
  const features = new Set<string>(options.adapterFeatures ?? ['texture-compression-bc']);
  if (options.timestamps ?? true) {
    features.add('timestamp-query');
  }
  const requestedFeatures: string[] = [];

  // `navigator` is a getter-only global in the node test env, so plain assignment throws — define over it
  // and restore the original descriptor afterwards.
  const overridden = [
    'navigator',
    'window',
    'GPUBufferUsage',
    'GPUTextureUsage',
    'GPUShaderStage',
    'GPUMapMode',
    'GPUColorWrite',
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>(
    overridden.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const override = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
  };

  // The usage/stage bit namespaces are globals the browser provides. Real spec values, so any bit
  // arithmetic in engine code behaves exactly as it does in a browser.
  override('GPUBufferUsage', {
    COPY_DST: 0x0008,
    COPY_SRC: 0x0004,
    INDEX: 0x0010,
    INDIRECT: 0x0100,
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    QUERY_RESOLVE: 0x0200,
    STORAGE: 0x0080,
    UNIFORM: 0x0040,
    VERTEX: 0x0020,
  });
  override('GPUTextureUsage', {
    COPY_DST: 0x02,
    COPY_SRC: 0x01,
    RENDER_ATTACHMENT: 0x10,
    STORAGE_BINDING: 0x08,
    TEXTURE_BINDING: 0x04,
  });
  override('GPUShaderStage', { COMPUTE: 0x4, FRAGMENT: 0x2, VERTEX: 0x1 });
  override('GPUMapMode', { READ: 0x0001, WRITE: 0x0002 });
  override('GPUColorWrite', { ALL: 0xf, ALPHA: 0x8, BLUE: 0x4, GREEN: 0x2, RED: 0x1 });

  override('navigator', {
    gpu: {
      getPreferredCanvasFormat: () => 'bgra8unorm',
      requestAdapter: () =>
        Promise.resolve({
          features,
          info: { architecture: 'fake', vendor: 'opensa' },
          requestDevice: (descriptor?: { requiredFeatures?: readonly string[] }) => {
            const required = [...(descriptor?.requiredFeatures ?? [])];
            requestedFeatures.push(...required);
            // What a REAL browser does, and the reason a phone used to be unbootable: `requestDevice`
            // rejects outright when a required feature is not on the adapter. Faking it away would make
            // the one mistake this fake exists to catch invisible.
            const absent = required.filter((feature) => !features.has(feature));
            if (absent.length > 0) {
              return Promise.reject(new Error(`requestDevice: adapter does not support ${absent.join(', ')}`));
            }
            // The DEVICE carries what was granted, not what the adapter could have offered. Leaving the
            // fake's default set here would let `requireFormatSupport` (and anything else reading
            // `device.features`) pass on a simulated mobile GPU that has no BC at all.
            const granted = gpu.device.features as unknown as Set<string>;
            granted.clear();
            for (const feature of required) {
              granted.add(feature);
            }

            return Promise.resolve(gpu.device);
          },
        }),
    },
  });
  override('window', { devicePixelRatio: 1 });

  const canvas = {
    clientHeight: 900,
    clientWidth: 1440,
    getContext: (kind: string) =>
      kind === 'webgpu'
        ? {
            configure: (): void => {},
            getCurrentTexture: (): unknown => ({
              createView: (): unknown => ({ label: 'swapchain' }),
              label: 'swapchain',
            }),
          }
        : null,
    height: 900,
    width: 1440,
  } as unknown as HTMLCanvasElement;

  return {
    canvas,
    gpu,
    requestedFeatures,
    restore(): void {
      for (const [name, descriptor] of previous) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          delete (globalThis as Record<string, unknown>)[name];
        }
      }
    },
  };
}

/** Shared by render passes and bundle encoders — both accept the same draw-issuing calls. */
function encoderRecorder(recorder: Recorder, pass: RecordedPass): Record<string, unknown> {
  let pipeline: string | undefined;
  const bindGroups: (string | undefined)[] = [];
  const bindGroupOffsets: (readonly number[] | undefined)[] = [];

  return {
    draw(vertexCount: number, instanceCount = 1): void {
      pass.drawCount += 1;
      recorder.draws.push({
        bindGroupOffsets: [...bindGroupOffsets],
        bindGroups: [...bindGroups],
        instanceCount,
        kind: 'draw',
        pass: pass.label,
        pipeline,
        vertexCount,
      });
    },
    drawIndexed(indexCount: number, instanceCount = 1): void {
      pass.drawCount += 1;
      recorder.draws.push({
        bindGroupOffsets: [...bindGroupOffsets],
        bindGroups: [...bindGroups],
        indexCount,
        instanceCount,
        kind: 'drawIndexed',
        pass: pass.label,
        pipeline,
      });
    },
    end(): void {},
    executeBundles(bundles: { label: string }[]): void {
      for (const bundle of bundles) {
        pass.bundles.push(bundle.label);
      }
    },
    setBindGroup(index: number, group: null | { label?: string }, dynamicOffsets?: readonly number[]): void {
      bindGroups[index] = group?.label;
      bindGroupOffsets[index] = dynamicOffsets ? [...dynamicOffsets] : undefined;
    },
    setIndexBuffer(): void {},
    setPipeline(value: { label?: string }): void {
      pipeline = value.label;
    },
    setVertexBuffer(): void {},
    setViewport(): void {},
  };
}
