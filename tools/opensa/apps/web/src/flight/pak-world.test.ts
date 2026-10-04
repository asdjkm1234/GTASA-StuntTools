import type { Engine } from '@opensa/engine';
import type { Mock } from 'vitest';

import { afterEach, expect, it, vi } from 'vitest';

import { PakWorld } from './pak-world';

afterEach(() => vi.unstubAllGlobals());

it('submits a copy-only batch and waits for GPU completion before declaring the pak ready', async () => {
  let uploaded = false;
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const drainUploads = vi.fn(() => {
    uploaded = true;
  });
  const submit = vi.fn();
  const onSubmittedWorkDone = vi.fn(() => completion);
  const engine = {
    device: { queue: { onSubmittedWorkDone, submit } },
    textures: { beginLoad: vi.fn(), drainUploads, has: () => uploaded },
  } as unknown as Engine;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string): Promise<Response> =>
        Promise.resolve(
          new Response(
            url.endsWith('/index.json')
              ? JSON.stringify({ arrays: [{ layers: 1, ref: 7 }], cells: [], cellSize: 300 })
              : new ArrayBuffer(1),
          ),
        ),
    ),
  );
  const pak = new PakWorld(engine, '/map-pak');
  await pak.load();
  pak.pump(1);
  expect(drainUploads).toHaveBeenCalledWith(1, 1024 * 1024);
  expect(submit).toHaveBeenCalledWith([]);
  expect(onSubmittedWorkDone).toHaveBeenCalledOnce();
  expect(submit.mock.invocationCallOrder[0]).toBeLessThan(onSubmittedWorkDone.mock.invocationCallOrder[0]);
  pak.pump(1);
  expect(drainUploads).toHaveBeenCalledOnce();
  expect(pak.isReady).toBe(false);
  finish();
  await completion;
  pak.pump(1);
  expect(pak.isReady).toBe(true);
  expect(submit).toHaveBeenCalledOnce();
});

async function streamingPak(
  cells: { cx: number; cy: number; lod: boolean }[],
  fetchCell: (url: string) => Promise<Response>,
): Promise<{ fence: Mock<() => Promise<void>>; load: Mock; pak: PakWorld; submit: Mock }> {
  const load = vi.fn();
  const submit = vi.fn();
  const fence = vi.fn(() => Promise.resolve());
  const engine = {
    cells: { load, unload: vi.fn() },
    device: { queue: { onSubmittedWorkDone: fence, submit } },
    textures: { beginLoad: vi.fn(), drainUploads: vi.fn(), has: () => true },
  } as unknown as Engine;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.endsWith('/index.json'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              arrays: [{ layers: 1, ref: 7 }],
              cells,
              cellSize: 100,
            }),
          ),
        );
      if (url.endsWith('.ostex')) return Promise.resolve(new Response(new ArrayBuffer(1)));

      return fetchCell(url);
    }),
  );
  const pak = new PakWorld(engine, '/map-pak');
  await pak.load();
  pak.pump(1);

  return { fence, load, pak, submit };
}

it('waits for unscheduled cells beyond the first two-fetch batch and fences their uploads', async () => {
  let active = 0;
  let maximum = 0;
  const { fence, load, pak, submit } = await streamingPak(
    Array.from({ length: 7 }, (_, cx) => ({ cx, cy: 0, lod: false })),
    async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active--;

      return new Response(new ArrayBuffer(1));
    },
  );
  pak.update(350, 50, 400, 400);
  expect(pak.missingCells).toBe(7);
  await pak.waitForExport();
  expect(maximum).toBe(2);
  expect(pak.loadedCells).toBe(7);
  expect(pak.missingCells).toBe(0);
  expect(pak.isLoading).toBe(false);
  expect(load).toHaveBeenCalledTimes(7);
  const lastLoad = load.mock.invocationCallOrder[load.mock.calls.length - 1];
  const lastSubmit = submit.mock.invocationCallOrder[submit.mock.calls.length - 1];
  const lastFence = fence.mock.invocationCallOrder[fence.mock.calls.length - 1];
  expect(lastLoad).toBeLessThan(lastSubmit);
  expect(lastSubmit).toBeLessThan(lastFence);
});

it('rejects an unavailable required tile instead of exporting incomplete terrain or retrying forever', async () => {
  const { pak } = await streamingPak([{ cx: 0, cy: 0, lod: false }], () =>
    Promise.resolve(new Response('missing', { status: 404 })),
  );
  pak.update(50, 50, 100, 100);
  await expect(pak.waitForExport()).rejects.toThrow('导出地图地块 0,0 载入失败：404');
  expect(pak.missingCells).toBe(1);
});

it('times out a stalled tile instead of declaring the ring ready', async () => {
  const { pak } = await streamingPak(
    [{ cx: 0, cy: 0, lod: false }],
    () =>
      new Promise<Response>(() => {
        /* Never responds. */
      }),
  );
  pak.update(50, 50, 100, 100);
  await expect(pak.waitForExport(20)).rejects.toThrow('地图地块载入超时（剩余 1）');
});

it('discards in-flight tiles from the old camera region and completes the new export region', async () => {
  let release!: () => void;
  const oldFetch = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { load, pak } = await streamingPak(
    [
      { cx: 0, cy: 0, lod: false },
      { cx: 20, cy: 0, lod: false },
    ],
    async (url) => {
      if (url.endsWith('/0_0.bin')) await oldFetch;

      return new Response(new ArrayBuffer(1));
    },
  );
  pak.update(50, 50, 100, 100);
  pak.update(2050, 50, 100, 100);
  release();
  await pak.waitForExport();
  expect(load).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledWith('20,0', expect.any(Uint8Array));
  expect(pak.loadedCells).toBe(1);
});

it('pins departure cells during travel and releases them through normal streaming afterwards', async () => {
  const { pak } = await streamingPak(
    [
      { cx: 0, cy: 0, lod: false },
      { cx: 20, cy: 0, lod: false },
    ],
    () => Promise.resolve(new Response(new ArrayBuffer(1))),
  );
  pak.update(50, 50, 100, 100);
  await pak.waitForExport();
  expect(pak.loadedCells).toBe(1);
  pak.retainForTravel(true);
  pak.update(2050, 50, 100, 100);
  await pak.waitForExport();
  expect(pak.loadedCells).toBe(2);
  pak.retainForTravel(false);
  pak.update(2050, 50, 100, 100);
  expect(pak.loadedCells).toBe(1);
});
