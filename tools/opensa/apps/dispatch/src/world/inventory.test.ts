import type { EngineStats, FrameSpanTotals, StreamStats } from '@opensa/engine';

import { describe, expect, it } from 'vitest';

import { type FrameCpuSample, FrameInventory, UNNAMED_DISTRICT } from './inventory';

const NO_SPANS: FrameSpanTotals = { byName: [], totalMs: 0 };
/** A host that timed nothing — most tests are about the frame, not about where its CPU time went. */
const NO_CPU: FrameCpuSample = { bodyMs: 0, canvasPixels: 806 * 668, segments: NO_SPANS };
/** A streamer with nothing to do — most tests are about the frame, not about what the world was loading. */
const IDLE: StreamStats = {
  blobMs: 0,
  created: 0,
  evicted: 0,
  lateCreates: 0,
  loadedCells: 4,
  pendingCells: 0,
  uploadMs: 0,
  worstBlobMs: 0,
  worstCreateMs: 0,
};

/** One loop body: its wall time, and the segments inside it. */
function cpu(
  bodyMs: number,
  segments: readonly (readonly [string, number])[] = [],
  canvasPixels = 806 * 668,
): FrameCpuSample {
  return {
    bodyMs,
    canvasPixels,
    segments: { byName: segments, totalMs: segments.reduce((sum, [, ms]) => sum + ms, 0) },
  };
}

function stats(overrides: Partial<EngineStats> = {}): EngineStats {
  return {
    cellsTotal: 144,
    cellsVisible: 38,
    drawsRecorded: 162,
    gpuPassMs: 0,
    gpuPostMs: 0,
    gpuProbeMs: 0,
    residencyBytes: 37 * 1024 * 1024,
    roadsignQuadsRecorded: 0,
    submitMs: 0.4,
    trianglesRecorded: 120_000,
    ...overrides,
  };
}

const CONTEXT = {
  app: 'test',
  boot: { gpuMs: 0, openMs: 0, overlapMs: 0, phases: [] },
  build: 'original@test',
  byCategory: {},
  bytes: { byKind: [], cachedBytes: 0, cachedRequests: 0, requests: 0, totalBytes: 0 },
  camera: { at: [1480, -1720] as const, height: 900, projection: 'perspective' as const },
  device: {},
  district: 'los-santos-centre',
  errors: [],
  firstFrames: [],
  framesSkipped: 0,
  hasTimestamps: true,
  overlay: true,
  pickingBytes: 0,
  surface: { cssHeight: 364, cssWidth: 360, deviceHeight: 728, deviceWidth: 720, dpr: 2, renderScale: 1 },
  symbology: {
    beaconCapacity: 150,
    beaconGrowths: 0,
    chips: 9,
    chipsDropped: 2,
    incidents: 2,
    measures: 0,
    modelTextureMb: 12.5,
    modelTypes: 3,
    stale: 0,
    symbols: 11,
    units: 9,
    unitsAsModels: 7,
    unitsAsSymbolOnly: 2,
    unitsUnresolvedModels: 1,
  },
  tracks: { bytes: 2601, capacity: 17, incidentEvents: 4, samples: 42, tracks: 9, window: [0, 30_000] as const },
};

describe('FrameInventory', () => {
  describe('negative cases', () => {
    it('reports zeroes rather than dividing by no frames', () => {
      const report = new FrameInventory().report(CONTEXT);

      expect(report.frames).toBe(0);
      expect(report.frame.fps).toBe(0);
      expect(report.frame.dtP50Ms).toBe(0);
      expect(report.windowMs).toBe(0);
    });

    it('discards the FIRST delta, which carries page load rather than a frame', () => {
      const inventory = new FrameInventory();
      inventory.sample(41_026, stats(), NO_SPANS, NO_CPU, IDLE); // the load stall the 2026-08-07 capture reported as dtMax
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      const report = inventory.report(CONTEXT);

      expect(report.frames).toBe(2);
      expect(report.frame.dtMaxMs).toBe(16);
    });

    it('still reads the world off the discarded first sample, so an early report is not blank', () => {
      const inventory = new FrameInventory();
      inventory.sample(41_026, stats({ cellsTotal: 9, cellsVisible: 4 }), NO_SPANS, NO_CPU, IDLE);

      const report = inventory.report(CONTEXT);

      expect(report.frames).toBe(0);
      expect(report.world.cellsTotal).toBe(9);
    });

    it('VOIDS a capture that streamed no cells — the failure the first real capture shipped with', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats({ cellsTotal: 0, cellsVisible: 0 }), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(16, stats({ cellsTotal: 0, cellsVisible: 0 }), NO_SPANS, NO_CPU, IDLE);

      const warnings = inventory.report(CONTEXT).warnings;

      expect(warnings.some((warning) => warning.startsWith('VOID'))).toBe(true);
    });

    it('warns about a window too short to carry a percentile, and about an unnamed district', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      const warnings = inventory.report({ ...CONTEXT, district: UNNAMED_DISTRICT }).warnings;

      expect(warnings.some((warning) => warning.includes('frames sampled'))).toBe(true);
      expect(warnings.some((warning) => warning.includes('district not named'))).toBe(true);
    });

    it('marks GPU passes UNAVAILABLE when the adapter cannot time them, instead of reporting them as free', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      const report = inventory.report({ ...CONTEXT, hasTimestamps: false });
      const gpu = report.passes.find((pass) => pass.name === 'gpuPassMs');

      expect(gpu?.available).toBe(false);
      expect(report.unavailable).toHaveLength(1);
      expect(report.unavailable[0]).toContain('timestamp-query');
    });

    it('keeps submitMs available without timestamps — it is a CPU number', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      const submit = inventory.report({ ...CONTEXT, hasTimestamps: false }).passes.find((p) => p.name === 'submitMs');

      expect(submit?.available).toBe(true);
    });

    it('records no spans when nothing between frames was wrapped', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      expect(inventory.report(CONTEXT).spans).toEqual([]);
    });

    it('says the loop body was never timed instead of reporting a CPU share of zero as a finding', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      const report = inventory.report(CONTEXT);

      expect(report.cpu.shareOfFrame).toBe(0);
      expect(report.warnings.some((warning) => warning.includes('did not time its loop body'))).toBe(true);
    });

    it('warns that a capture off the PINNED district is not part of the chain series', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, cpu(6), IDLE);

      const warnings = inventory.report({ ...CONTEXT, district: 'ganton' }).warnings;

      expect(warnings.some((warning) => warning.includes("not on 'los-santos-centre'"))).toBe(true);
      expect(warnings.some((warning) => warning.includes('this build knows'))).toBe(false);
    });

    it('says so when the district is not one this build knows at all', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, cpu(6), IDLE);

      const warnings = inventory.report({ ...CONTEXT, district: 'somewhere' }).warnings;

      expect(warnings.some((warning) => warning.includes('this build knows'))).toBe(true);
    });

    it('never reports a negative time outside the loop, whatever the body claims', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);
      // A body longer than the frame is arithmetically impossible with the previous-body pairing; the clamp
      // is here so a host that pairs them wrong reports 0 rather than a negative that reads as an insight.
      inventory.sample(16, stats(), NO_SPANS, cpu(40), IDLE);

      expect(inventory.report(CONTEXT).cpu.outsideMeanMs).toBe(0);
    });

    it('does not let the interval that SPANS a rest into the frame percentiles', () => {
      // 201/3-05, measured on the phone 2026-08-31. The collector is never called on a skipped pass — but a
      // skipped pass arms the next loop entry with setTimeout(IDLE_WAKE_MS), so the frame drawn AFTER one
      // carries a ~100 ms dt that is 99 % sleep. On a live 150-unit board the console alternates draw/skip,
      // and 706 of that capture's 835 samples were that interval: dtP50 read 100.6 ms, which is the idle
      // poll rather than anything a frame cost.
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE); // primes the clock
      for (let frame = 0; frame < 8; frame += 1) {
        inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);
        inventory.sample(100, stats(), NO_SPANS, NO_CPU, IDLE, 'after-rest');
      }
      const report = inventory.report(CONTEXT);

      expect(report.frame.dtP50Ms).toBe(16);
      expect(report.frame.fps).toBe(63);
      // The rest is not thrown away — it is reported as what it is, so a window can still be read.
      expect({ frames: report.rest.frames, totalMs: report.rest.totalMs }).toEqual({ frames: 8, totalMs: 800 });
      // `frames` keeps meaning "frames drawn", so the two halves add up and neither is inferred.
      expect(report.frames).toBe(16);
    });

    it('does not let a resting loop report itself as a frame that is 98 % outside the CPU', () => {
      // The same defect where it read as a FINDING: shareOfFrame 2.3 % on the 08-31 capture, which invites
      // "the frame is GPU-bound" when the truth is that the loop was asleep on purpose for most of it.
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, cpu(8), IDLE); // primes the clock
      for (let frame = 0; frame < 8; frame += 1) {
        inventory.sample(16, stats(), NO_SPANS, cpu(8), IDLE);
        inventory.sample(100, stats(), NO_SPANS, cpu(8), IDLE, 'after-rest');
      }
      const report = inventory.report(CONTEXT);

      expect(report.cpu.shareOfFrame).toBeCloseTo(0.5, 2);
      expect(report.cpu.outsideMeanMs).toBeCloseTo(8, 2);
    });

    it('does not average a SKIPPED pass body in with the frames, which is what `cpu` carries after a rest', () => {
      // Found by the field run of 2026-08-31, one layer below the dt split. `cpu.bodyMs` is paired one frame
      // late on purpose — the body that ran inside the interval being reported is the previous pass's — but
      // when the previous pass was SKIPPED that body is the gate's own ~0.2 ms, not a frame's. The capture
      // reported bodyMeanMs 1.48 ms against a real paced body of 13.84: 480 skip bodies averaged in with 47.
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, cpu(12, [['engine-frame', 9]]), IDLE); // primes the clock
      inventory.sample(16, stats(), NO_SPANS, cpu(12, [['engine-frame', 9]]), IDLE);
      for (let rest = 0; rest < 8; rest += 1) {
        inventory.sample(100, stats(), NO_SPANS, cpu(0.2), IDLE, 'after-rest');
      }
      const report = inventory.report(CONTEXT);

      expect(report.cpu.bodyMeanMs).toBe(12);
      expect(report.cpu.segmentsMs).toContainEqual(['engine-frame', 9]);
    });

    it('READS the streamer running totals instead of summing them, whatever the window length', () => {
      const inventory = new FrameInventory();
      // Four cells created at boot and nothing since — what a settled district reports on every update.
      const settled: StreamStats = { ...IDLE, created: 4, worstCreateMs: 25.5 };
      for (let i = 0; i < 101; i += 1) {
        inventory.sample(32, stats(), NO_SPANS, NO_CPU, settled);
      }

      const { streaming } = inventory.report(CONTEXT);

      // Summed, this read 2454 against 4 resident cells and 0 evictions on the 2026-08-12 phone capture:
      // the same handful of creates counted again on every one of 685 frames, which looks like churn.
      expect(streaming.cellsCreated).toBe(4);
      expect(streaming.cellsEvicted).toBe(0);
      expect(streaming.worstCreateMs).toBe(25.5);
    });
  });

  describe('positive cases', () => {
    it('reports the p95 of dt, not its mean — a mean hides the hitches this is looking for', () => {
      const inventory = new FrameInventory();
      // 10 % of frames hitch. A mean would read 38 ms and hide both the healthy body and the stalls; p50 and
      // p95 report them separately, which is the whole reason the window keeps every dt.
      for (let i = 0; i < 90; i += 1) {
        inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);
      }
      for (let i = 0; i < 10; i += 1) {
        inventory.sample(240, stats(), NO_SPANS, NO_CPU, IDLE);
      }

      const report = inventory.report(CONTEXT);

      expect(report.frame.dtP50Ms).toBe(16);
      expect(report.frame.dtP95Ms).toBe(240);
      expect(report.frame.dtMaxMs).toBe(240);
      expect(report.frame.fps).toBe(63);
    });

    it('averages a span over every sampled frame, not over the frames that paid it', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE); // primes the clock — the first delta is not a frame time
      inventory.sample(16, stats(), { byName: [['cell-collision', 30]], totalMs: 30 }, NO_CPU, IDLE);
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      const [[name, meanMs]] = inventory.report(CONTEXT).spans;

      expect(name).toBe('cell-collision');
      expect(meanMs).toBe(15);
    });

    it('orders passes by mean cost so the table reads top-down', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE); // primes the clock — the first delta is not a frame time
      inventory.sample(16, stats({ gpuPassMs: 12, gpuPostMs: 3, submitMs: 0.4 }), NO_SPANS, NO_CPU, IDLE);

      const names = inventory.report(CONTEXT).passes.map((pass) => pass.name);

      expect(names.slice(0, 3)).toEqual(['gpuPassMs', 'gpuPostMs', 'submitMs']);
    });

    it('splits the frame into the loop body and everything outside it', () => {
      const inventory = new FrameInventory();
      inventory.sample(32, stats(), NO_SPANS, NO_CPU, IDLE); // primes the clock — the first delta is not a frame time
      // The shape of the 2026-08-07 mobile row: a 32 ms frame whose main thread ran for 6 of it. The chain
      // needs to read that as "the frame is waiting", not as "94 % is unknown".
      inventory.sample(32, stats(), NO_SPANS, cpu(6), IDLE);
      inventory.sample(32, stats(), NO_SPANS, cpu(6), IDLE);

      const { cpu: measured } = inventory.report(CONTEXT);

      expect(measured.bodyMeanMs).toBe(6);
      expect(measured.outsideMeanMs).toBe(26);
      expect(measured.shareOfFrame).toBeCloseTo(0.1875, 4);
    });

    it('names the body time no segment claimed, so the breakdown adds up to the body', () => {
      const inventory = new FrameInventory();
      inventory.sample(32, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(
        32,
        stats(),
        NO_SPANS,
        cpu(10, [
          ['engine-frame', 4],
          ['overlay-2d', 1],
        ]),
        IDLE,
      );

      const segments = inventory.report(CONTEXT).cpu.segmentsMs;

      expect(segments).toEqual([
        ['other', 5],
        ['engine-frame', 4],
        ['overlay-2d', 1],
      ]);
    });

    it('bins dt, so a frame waiting on vsync can be told from one that is simply slow', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE); // primes the clock
      inventory.sample(33.4, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(33.9, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(16.7, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(240, stats(), NO_SPANS, NO_CPU, IDLE);

      // Past 100 ms the bins are 20 ms wide rather than one tail bucket (`frame-histogram.ts`). This row
      // used to read [100, 1]: correct while the tail was only there to stop a hitch opening 70 empty bins,
      // and wrong once a percentile is taken off these bins, because a p95 above 100 would saturate and
      // report `100` for a window that ran far past it. The 2026-08-31 capture's was 108.4.
      expect(inventory.report(CONTEXT).frame.dtHistogramMs).toEqual([
        [16, 1],
        [32, 2],
        [240, 1],
      ]);
    });

    it('keeps the WORST body with its own segments — a mean cannot say which part of it grew', () => {
      const inventory = new FrameInventory();
      inventory.sample(32, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(32, stats(), NO_SPANS, cpu(6, [['engine-frame', 4]]), IDLE);
      // The shape of both field captures: one frame an order of magnitude worse than the rest.
      inventory.sample(1097, stats(), NO_SPANS, cpu(1068, [['engine-frame', 1050]]), IDLE);
      inventory.sample(32, stats(), NO_SPANS, cpu(6, [['engine-frame', 4]]), IDLE);

      const { worstFrame } = inventory.report(CONTEXT).cpu;

      expect(worstFrame.bodyMs).toBe(1068);
      expect(worstFrame.segmentsMs).toEqual([['engine-frame', 1050]]);
    });

    it('records the CONDITIONS the worst frame happened under, not only its cost', () => {
      // The 2026-08-23 field capture had a 600 ms frame and nothing to attribute it to: no time, no surface,
      // no idea whether the streamer was delivering. A number that large with no conditions cannot be acted
      // on, only argued about.
      const inventory = new FrameInventory();
      inventory.sample(32, stats(), NO_SPANS, NO_CPU, { ...IDLE, created: 9 });
      inventory.sample(
        700,
        stats({ cellsVisible: 12, drawsRecorded: 140 }),
        NO_SPANS,
        cpu(680, [['overlay-2d', 500]], 1280 * 720),
        { ...IDLE, created: 11, evicted: 1, pendingCells: 3 },
      );

      const { worstFrame } = inventory.report(CONTEXT).cpu;

      expect(worstFrame.dtMs).toBe(700);
      expect(worstFrame.canvasPixels).toBe(1280 * 720);
      expect(worstFrame.cellsVisible).toBe(12);
      expect(worstFrame.draws).toBe(140);
      expect(worstFrame.pending).toBe(3);
      // Per-frame, from the driver's RUNNING totals: two created in this frame, not the eleven since boot.
      expect(worstFrame.cellsCreated).toBe(2);
      expect(worstFrame.cellsEvicted).toBe(1);
      expect(worstFrame.atMs).toBeGreaterThanOrEqual(0);
    });

    it('does not charge the first sampled frame with everything the streamer did before the window', () => {
      const inventory = new FrameInventory();
      inventory.sample(32, stats(), NO_SPANS, NO_CPU, { ...IDLE, created: 40 });
      inventory.sample(32, stats(), NO_SPANS, cpu(9), { ...IDLE, created: 41 });

      expect(inventory.report(CONTEXT).cpu.worstFrame.cellsCreated).toBe(1);
    });

    it("carries the STREAMER's own numbers, which the console used to drop on the floor", () => {
      const inventory = new FrameInventory();
      inventory.sample(32, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(32, stats(), NO_SPANS, NO_CPU, {
        ...IDLE,
        blobMs: 40,
        created: 2,
        lateCreates: 1,
        uploadMs: 6,
        worstBlobMs: 38,
        worstCreateMs: 12,
      });
      // The driver's counters are cumulative, so a later update still reports the creates it has made.
      inventory.sample(32, stats(), NO_SPANS, NO_CPU, {
        ...IDLE,
        blobMs: 10,
        created: 2,
        evicted: 1,
        lateCreates: 1,
        worstBlobMs: 9,
        worstCreateMs: 12,
      });

      const { streaming } = inventory.report(CONTEXT);

      expect(streaming.blobMeanMs).toBe(25); // 50 ms over two sampled frames
      expect(streaming.uploadMeanMs).toBe(3);
      expect(streaming.cellsCreated).toBe(2);
      expect(streaming.cellsEvicted).toBe(1);
      expect(streaming.lateCreates).toBe(1);
      // The worsts are MAXIMA, never averages: one 38 ms upload and four 9 ms ones are different problems.
      expect(streaming.worstBlobMs).toBe(38);
      expect(streaming.worstCreateMs).toBe(12);
    });

    it("breaks residency down by the engine's own ledger categories, non-zero only", () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      const report = inventory.report({
        ...CONTEXT,
        byCategory: {
          cellIndex: { bytes: 4 * 1024 * 1024, count: 8 },
          cellVertex: { bytes: 20 * 1024 * 1024, count: 8 },
          debris: { bytes: 0, count: 0 },
          target: { bytes: 24 * 1024 * 1024, count: 6 },
          texture: { bytes: 100 * 1024 * 1024, count: 20 },
          uniform: { bytes: 1024 * 1024, count: 40 },
        },
      });

      expect(report.world.byCategoryMb).toEqual([
        ['texture', 100],
        ['target', 24],
        ['cellVertex', 20],
        ['cellIndex', 4],
        ['uniform', 1],
      ]);
    });

    it('carries the pak traffic the surface actually read, so the build can be argued against it', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      const report = inventory.report({
        ...CONTEXT,
        bytes: {
          byKind: [
            { bytes: 24_000_000, kind: 'texture-array', requests: 20 },
            { bytes: 3_000_000, kind: 'cell-hd', requests: 4 },
          ],
          cachedBytes: 3_000_000,
          cachedRequests: 4,
          requests: 24,
          totalBytes: 27_000_000,
        },
      });

      expect(report.bytes.byKind[0].kind).toBe('texture-array');
      expect(report.bytes.totalBytes).toBe(27_000_000);
      expect(report.bytes.requests).toBe(24);
      expect(report.bytes.cachedBytes).toBe(3_000_000);
      expect(report.bytes.cachedRequests).toBe(4);
    });

    it('carries the world counters and the context the capture must state', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      const report = inventory.report({ ...CONTEXT, pickingBytes: 2 * 1024 * 1024 });

      expect(report.world).toEqual({
        byCategoryMb: [],
        cellsTotal: 144,
        cellsVisible: 38,
        draws: 162,
        // The capability's HOST cost, kept apart from `residencyMb` because that ledger counts GPU bytes.
        pickingMb: 2,
        residencyMb: 37,
        triangles: 120_000,
      });
      expect(report.district).toBe('los-santos-centre');
      expect(report.build).toBe('original@test');
    });
  });
});

describe('FrameInventory idle frames (201/4-01)', () => {
  describe('negative cases', () => {
    it('does not invent a skip count — a capture on a moving map reports zero', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      expect(inventory.report({ ...CONTEXT, framesSkipped: 0 }).framesSkipped).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('reports the frames the gate skipped beside the ones it drew', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);
      const report = inventory.report({ ...CONTEXT, framesSkipped: 3580 });

      // A capture at rest: a handful of drawn frames and thousands the console did not spend.
      expect(report.frames).toBe(1);
      expect(report.framesSkipped).toBe(3580);
    });
  });
});

describe('FrameInventory overlay state (201/2, ?overlay=0)', () => {
  describe('negative cases', () => {
    it('does not let a bare-engine window pass for an ordinary one', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      expect(inventory.report({ ...CONTEXT, overlay: false }).overlay).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('says the map was drawn over when it was', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS, NO_CPU, IDLE);

      expect(inventory.report({ ...CONTEXT, overlay: true }).overlay).toBe(true);
    });
  });
});
