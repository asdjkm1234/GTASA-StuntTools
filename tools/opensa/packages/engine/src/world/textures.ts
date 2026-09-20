/**
 * Texture-array store (plan 074/01 world module): one `.ostex` blob → one `texture_2d_array` + its material
 * bind group. The upload itself lives in `core/ostex-upload` (per-model dictionaries share it); this class
 * owns the world's ref keying, material bind group and residency.
 * The CPU payload is released after upload (JS holds handles — the 073 memory lesson).
 */
import type { Resources } from '../core/resources';

import { beginOstexUpload, type OstexUploadTask, uploadOstexTexture } from '../core/ostex-upload';

/** One missing-texture stand-in layer (pak manifest `missingLayers`, plan 085 row B): a 4×4 RGBA8 colour
 *  layer the highlight repaints magenta; `color` is the packed texel that restores the quiet look. */
export interface MissingLayer {
  array: number;
  color: [number, number, number, number];
  layer: number;
}

export interface TextureArrayHandle {
  bindGroup: GPUBindGroup;
  byteEstimate: number;
  layers: number;
  texture: GPUTexture;
}

/** Stand-in layers are 4×4 RGBA8 single-mip (the planner's colour bucket). */
const STAND_IN_SIZE = 4;
const MAGENTA: readonly number[] = [255, 0, 255, 255];

export class TextureArrays {
  private readonly arrays = new Map<number, TextureArrayHandle>();
  private readonly device: GPUDevice;
  private highlightMissing = false;
  private readonly materialLayout: GPUBindGroupLayout;
  /** Missing-texture stand-ins by array ref (fed from the pak manifest before streaming starts). */
  private readonly missingByRef = new Map<number, MissingLayer[]>();
  /** Uploads mid-drain (`beginLoad` → `drainUploads`): the texture exists, `has` stays false until the
   *  last (layer, mip) write lands. Insertion order IS the drain order. */
  private readonly pending = new Map<number, { bindGroup: GPUBindGroup; task: OstexUploadTask }>();
  private readonly resources: Resources;
  private readonly sampler: GPUSampler;

  constructor(device: GPUDevice, resources: Resources, materialLayout: GPUBindGroupLayout) {
    this.device = device;
    this.resources = resources;
    this.materialLayout = materialLayout;
    this.sampler = device.createSampler({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
  }

  /**
   * Start a resumable load: decode + `createTexture` now (cheap — the payload stays compressed), the
   * (layer, mip) writes wait for {@link drainUploads}. This is the streaming path's entry: a whole-array
   * upload in the worker's `message` handler ran BETWEEN frames at 15–85 ms a call
   * (`docs/performance/applied/texture-upload-budget.md`); the frame loop pays instead,
   * under its own budget. `has(ref)` stays false until the last write lands. Idempotent per ref.
   */
  beginLoad(ref: number, bytes: Uint8Array): void {
    if (this.arrays.has(ref) || this.pending.has(ref)) {
      return;
    }
    const task = beginOstexUpload(this.device, this.resources, bytes, `array-${ref}`);
    this.pending.set(ref, { bindGroup: this.materialBindGroup(ref, task.texture), task });
  }

  /**
   * Advance pending uploads until `budgetMs` is spent — always at least one write, so a single write
   * larger than the budget still makes progress. Arrays finish in arrival order: one COMPLETED array
   * unblocks its waiting cells sooner than several half-drained ones. Returns the milliseconds spent.
   */
  drainUploads(budgetMs: number): number {
    if (this.pending.size === 0) {
      return 0;
    }
    const started = performance.now();
    for (const [ref, upload] of this.pending) {
      for (;;) {
        const finished = upload.task.step();
        if (finished) {
          this.pending.delete(ref);
          const { byteEstimate, layers, texture } = upload.task;
          const handle: TextureArrayHandle = { bindGroup: upload.bindGroup, byteEstimate, layers, texture };
          this.arrays.set(ref, handle);
          if (this.highlightMissing) {
            this.paint(ref, handle, true);
          }
          break;
        }
        if (performance.now() - started >= budgetMs) {
          return performance.now() - started;
        }
      }
    }

    return performance.now() - started;
  }

  get(ref: number): TextureArrayHandle {
    const handle = this.arrays.get(ref);
    if (!handle) {
      throw new Error(`texture array ${ref} not loaded (cells must load after their arrays)`);
    }

    return handle;
  }

  has(ref: number): boolean {
    return this.arrays.has(ref);
  }

  /** Decode + upload one `.ostex`; idempotent per ref. Returns the handle. */
  load(ref: number, bytes: Uint8Array): TextureArrayHandle {
    const existing = this.arrays.get(ref);
    if (existing) {
      return existing;
    }
    const { byteEstimate, layers, texture } = uploadOstexTexture(this.device, this.resources, bytes, `array-${ref}`);
    const handle: TextureArrayHandle = {
      bindGroup: this.materialBindGroup(ref, texture),
      byteEstimate,
      layers,
      texture,
    };
    this.arrays.set(ref, handle);
    if (this.highlightMissing) {
      this.paint(ref, handle, true);
    }

    return handle;
  }

  /** Turn the missing-texture highlight on/off: repaints every RESIDENT stand-in layer now, and every
   *  later-streamed one on load. Off restores the packed material colour — no re-fetch needed. */
  setMissingHighlight(on: boolean): void {
    if (this.highlightMissing === on) {
      return;
    }
    this.highlightMissing = on;
    for (const [ref, handle] of this.arrays) {
      this.paint(ref, handle, on);
    }
  }

  /** Feed the pak manifest's `missingLayers` (once, before streaming). */
  setMissingLayers(entries: readonly MissingLayer[]): void {
    this.missingByRef.clear();
    for (const entry of entries) {
      const list = this.missingByRef.get(entry.array);
      if (list) {
        list.push(entry);
      } else {
        this.missingByRef.set(entry.array, [entry]);
      }
    }
  }

  unload(ref: number): void {
    const pending = this.pending.get(ref);
    if (pending) {
      // Cancelled mid-drain (evicted before its cells ever created): drop the cursor with the texture.
      this.pending.delete(ref);
      this.resources.destroyTexture('texture', pending.task.texture, pending.task.byteEstimate);

      return;
    }
    const handle = this.arrays.get(ref);
    if (!handle) {
      return;
    }
    this.arrays.delete(ref);
    this.resources.destroyTexture('texture', handle.texture, handle.byteEstimate);
  }

  /** The material bind group over one array texture — shared by the eager and the resumable path. */
  private materialBindGroup(ref: number, texture: GPUTexture): GPUBindGroup {
    return this.device.createBindGroup({
      entries: [
        { binding: 0, resource: texture.createView({ dimension: '2d-array' }) },
        { binding: 1, resource: this.sampler },
      ],
      label: `material-${ref}`,
      layout: this.materialLayout,
    });
  }

  /** Rewrite an array's stand-in layers: magenta (`loud = true`) or the packed material colour back. */
  private paint(ref: number, handle: TextureArrayHandle, loud: boolean): void {
    const entries = this.missingByRef.get(ref);
    if (!entries) {
      return;
    }
    const texels = new Uint8Array(STAND_IN_SIZE * STAND_IN_SIZE * 4);
    for (const entry of entries) {
      if (entry.layer >= handle.layers) {
        continue; // malformed manifest row — never write past the array
      }
      const texel = loud ? MAGENTA : entry.color;
      for (let index = 0; index < STAND_IN_SIZE * STAND_IN_SIZE; index += 1) {
        texels.set(texel, index * 4);
      }
      this.device.queue.writeTexture(
        { origin: { x: 0, y: 0, z: entry.layer }, texture: handle.texture },
        texels,
        { bytesPerRow: STAND_IN_SIZE * 4, rowsPerImage: STAND_IN_SIZE },
        { depthOrArrayLayers: 1, height: STAND_IN_SIZE, width: STAND_IN_SIZE },
      );
    }
  }
}
