/**
 * Per-pass GPU timestamps (plan 074/01 — instrumentation is core, not afterthought). Double-buffered readback:
 * never blocks the frame; the HUD shows the last resolved value. Degrades to `available = false` when the
 * adapter lacks `timestamp-query` (HUD then shows CPU timings only).
 *
 * Three measured spans: the WORLD pass (slots 0/1), the POST CHAIN (slots 2/3 — bloom passes + the composite;
 * the ≤3 ms post budget is measured, not guessed) and the ENV PROBE (slots 4/5 — the face render + its mip
 * chain, 074/16 step 2; the ≤0.5 ms amortised gate is measured the same way). The first pass of a span writes
 * the begin slot, the last writes the end slot.
 */
export class GpuTimers {
  readonly available: boolean;
  /** Last resolved world-pass duration, milliseconds. */
  lastPassMs = 0;
  /** Last resolved post-chain duration (bloom + composite), milliseconds. */
  lastPostMs = 0;
  /** Last resolved probe span (face pass + blit + mips), milliseconds. Stale frames are cleared by the engine. */
  lastProbeMs = 0;

  private readonly device: GPUDevice;
  private mapInFlight = false;
  private probeWritten = false;
  private readonly querySet: GPUQuerySet | null = null;
  private readonly readBuffer: GPUBuffer | null = null;
  private readonly resolveBuffer: GPUBuffer | null = null;

  constructor(device: GPUDevice, available: boolean) {
    this.device = device;
    this.available = available;
    if (!available) {
      return;
    }
    this.querySet = device.createQuerySet({ count: 6, label: 'pass', type: 'timestamp' });
    this.resolveBuffer = device.createBuffer({
      label: 'ts-resolve',
      size: 48,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readBuffer = device.createBuffer({
      label: 'ts-read',
      size: 48,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  /** Attach to the WORLD render pass descriptor (no-op object when unavailable). */
  passTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }

    return {
      timestampWrites: { beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1, querySet: this.querySet },
    };
  }

  /** Attach to the FIRST pass of the post chain (begin slot only). */
  postBeginTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }

    return { timestampWrites: { beginningOfPassWriteIndex: 2, querySet: this.querySet } };
  }

  /** Attach to the LAST pass of the post chain (end slot only; the composite). */
  postEndTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }

    return { timestampWrites: { endOfPassWriteIndex: 3, querySet: this.querySet } };
  }

  /** Attach to a SINGLE-pass post chain (bloom off — the composite is the whole chain). */
  postOnlyTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }

    return {
      timestampWrites: { beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3, querySet: this.querySet },
    };
  }

  /** Attach to the probe FACE render pass (begin slot only — 074/16 step 2). */
  probeBeginTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }
    this.probeWritten = true;

    return { timestampWrites: { beginningOfPassWriteIndex: 4, querySet: this.querySet } };
  }

  /** Attach to the LAST probe mip pass (end slot only). */
  probeEndTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }

    return { timestampWrites: { endOfPassWriteIndex: 5, querySet: this.querySet } };
  }

  /** Call on frames that skip the probe: a stale span must read as 0, not as last week's number. */
  probeSkipped(): void {
    this.probeWritten = false;
    this.lastProbeMs = 0;
  }

  /** After submit: map (async) and update the last durations. Fire-and-forget. */
  read(): void {
    const readBuffer = this.readBuffer;
    if (!readBuffer || this.mapInFlight) {
      return;
    }
    this.mapInFlight = true;
    const probeWritten = this.probeWritten;
    readBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const values = new BigUint64Array(readBuffer.getMappedRange().slice(0));
        readBuffer.unmap();
        this.lastPassMs = Number(values[1] - values[0]) / 1e6;
        // Post = END of the post chain − END of the world pass, NOT the chain's own begin slot: on
        // Apple/Metal a pass's begin timestamp fires when its VERTEX stage starts, and TBDR overlaps
        // that with the previous pass's fragments — a begin→end span swallows most of the frame
        // (field-measured: `?bloom=0` "post" ≈ the whole world pass). The post fragments serialize
        // behind the scene resolve, so end−end IS the chain's added tail.
        this.lastPostMs = Math.max(0, Number(values[3] - values[1]) / 1e6);
        // The probe span is an UPPER BOUND, not an honest cost: its own submit precedes the world pass,
        // but on Metal the face pass's begin timestamp (vertex start) still overlaps the PREVIOUS frame's
        // trailing fragments — the span tracks the prior frame's load (bench-measured: it follows the
        // scene's world-pass time, and a probe on/off A/B moves NOTHING at the frame level). Judge probe
        // cost by that A/B, not by this column.
        if (probeWritten) {
          this.lastProbeMs = Math.max(0, Number(values[5] - values[4]) / 1e6);
        }
        this.mapInFlight = false;
      })
      .catch(() => {
        this.mapInFlight = false;
      });
  }

  /** Resolve + kick an async readback (skipped while a previous map is in flight). Call after pass end. */
  resolve(encoder: GPUCommandEncoder): void {
    if (!this.querySet || !this.resolveBuffer || !this.readBuffer || this.mapInFlight) {
      return;
    }
    encoder.resolveQuerySet(this.querySet, 0, 6, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, 48);
  }
}
