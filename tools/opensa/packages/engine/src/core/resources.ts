/**
 * Handle-based GPU resources + the residency ledger (plan 074/01). Every create is categorized and counted;
 * destroy decrements — a cell unload that doesn't return the ledger to its prior line is a LEAK (assertable in
 * tests and visible in the HUD). This is the 073 3.5-GB lesson turned into an API.
 */

export type ResidencyCategory = 'cellIndex' | 'cellVertex' | 'debris' | 'target' | 'texture' | 'uniform';

export class Resources {
  private readonly bytes = new Map<ResidencyCategory, number>();
  private readonly counts = new Map<ResidencyCategory, number>();
  private readonly device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  createBuffer(category: ResidencyCategory, descriptor: GPUBufferDescriptor): GPUBuffer {
    const buffer = this.device.createBuffer(descriptor);
    this.track(category, descriptor.size);

    return buffer;
  }

  createTexture(category: ResidencyCategory, descriptor: GPUTextureDescriptor, byteEstimate: number): GPUTexture {
    const texture = this.device.createTexture(descriptor);
    this.track(category, byteEstimate);

    return texture;
  }

  destroyBuffer(category: ResidencyCategory, buffer: GPUBuffer): void {
    this.track(category, -buffer.size, -1);
    buffer.destroy();
  }

  destroyTexture(category: ResidencyCategory, texture: GPUTexture, byteEstimate: number): void {
    this.track(category, -byteEstimate, -1);
    texture.destroy();
  }

  /** Residency snapshot for the HUD / leak assertions. */
  ledger(): Record<ResidencyCategory, { bytes: number; count: number }> {
    const snapshot = {} as Record<ResidencyCategory, { bytes: number; count: number }>;
    for (const category of ['cellIndex', 'cellVertex', 'target', 'texture', 'uniform'] as const) {
      snapshot[category] = { bytes: this.bytes.get(category) ?? 0, count: this.counts.get(category) ?? 0 };
    }

    return snapshot;
  }

  totalBytes(): number {
    let total = 0;
    for (const value of this.bytes.values()) {
      total += value;
    }

    return total;
  }

  private track(category: ResidencyCategory, deltaBytes: number, deltaCount = 1): void {
    this.bytes.set(category, (this.bytes.get(category) ?? 0) + deltaBytes);
    this.counts.set(category, (this.counts.get(category) ?? 0) + deltaCount);
  }
}
