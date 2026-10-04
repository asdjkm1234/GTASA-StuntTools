/**
 * Defends "the game remembers your install folder": the boot/gesture decisions ({@link restoreDir} /
 * {@link pickDir}) around a denied, revoked or deleted folder, and the IndexedDB persistence itself — a lost or
 * half-written handle means the user re-picks their GTA folder on every visit, and a leaked connection blocks
 * the next open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DirHandleDeps } from './dir-handle-store';

import { browserDirHandleDeps, clearStoredDir, loadStoredDir, pickDir, restoreDir, storeDir } from './dir-handle-store';

const STORED = { name: 'stored' } as unknown as FileSystemDirectoryHandle;
const PICKED = { name: 'picked' } as unknown as FileSystemDirectoryHandle;

/** Deps with sensible defaults (no stored handle; pick→PICKED; permission granted; alive); override per test. */
function deps(overrides: Partial<DirHandleDeps> = {}): DirHandleDeps {
  return {
    clear: vi.fn(() => Promise.resolve()),
    isAlive: vi.fn(() => Promise.resolve(true)),
    load: vi.fn(() => Promise.resolve(null)),
    pick: vi.fn(() => Promise.resolve(PICKED)),
    queryPermission: vi.fn(() => Promise.resolve<PermissionState>('granted')),
    requestPermission: vi.fn(() => Promise.resolve<PermissionState>('granted')),
    store: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('restoreDir', () => {
  describe('negative cases', () => {
    it('reports not-ready (and no handle) when nothing is remembered', async () => {
      await expect(restoreDir(deps())).resolves.toEqual({ handle: null, ready: false });
    });

    it('returns the stored handle but not ready when permission is no longer granted', async () => {
      const d = deps({
        load: vi.fn(() => Promise.resolve(STORED)),
        queryPermission: vi.fn(() => Promise.resolve<PermissionState>('prompt')),
      });

      await expect(restoreDir(d)).resolves.toEqual({ handle: STORED, ready: false });
    });

    it('returns the stored handle but not ready when the folder is gone', async () => {
      const d = deps({ isAlive: vi.fn(() => Promise.resolve(false)), load: vi.fn(() => Promise.resolve(STORED)) });

      await expect(restoreDir(d)).resolves.toEqual({ handle: STORED, ready: false });
    });
  });

  describe('positive cases', () => {
    it('is ready when the stored handle is granted and alive', async () => {
      const d = deps({ load: vi.fn(() => Promise.resolve(STORED)) });

      await expect(restoreDir(d)).resolves.toEqual({ handle: STORED, ready: true });
    });
  });
});

describe('pickDir', () => {
  describe('negative cases', () => {
    it('forgets the stored handle and throws when its permission is denied (no picker)', async () => {
      const d = deps({ requestPermission: vi.fn(() => Promise.resolve<PermissionState>('denied')) });

      await expect(pickDir(d, STORED)).rejects.toThrow(/denied/i);
      expect(d.clear).toHaveBeenCalledOnce();
      expect(d.pick).not.toHaveBeenCalled();
    });

    it('forgets the stored handle and throws when its folder is gone (no picker)', async () => {
      const d = deps({ isAlive: vi.fn(() => Promise.resolve(false)) });

      await expect(pickDir(d, STORED)).rejects.toThrow(/click play again/i);
      expect(d.clear).toHaveBeenCalledOnce();
    });
  });

  describe('positive cases', () => {
    it('reuses the stored handle (request-permission first) without prompting or re-storing', async () => {
      const d = deps();

      await expect(pickDir(d, STORED)).resolves.toBe(STORED);
      expect(d.requestPermission).toHaveBeenCalledWith(STORED);
      expect(d.pick).not.toHaveBeenCalled();
      expect(d.store).not.toHaveBeenCalled();
    });

    it('prompts for and stores a fresh folder when nothing is remembered', async () => {
      const d = deps();

      await expect(pickDir(d, null)).resolves.toBe(PICKED);
      expect(d.store).toHaveBeenCalledWith(PICKED);
    });
  });
});

interface FakeIdb {
  /** How many times a db connection was closed (must match the number of operations). */
  closes: () => number;
  data: Map<string, unknown>;
  fail: (what: 'none' | 'open' | 'request') => void;
}

interface FakeRequest<T> {
  error: DOMException | null;
  onerror?: (() => void) | null;
  onsuccess?: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
  result: T;
}

/** Stand-in for the browser class the store uses as its `instanceof` type guard. */
class FakeDirectoryHandle {
  constructor(readonly name: string) {}
}

/** A minimal in-memory IndexedDB covering exactly what dir-handle-store uses (open/upgrade/get/put/delete). */
function installFakeIndexedDb(): FakeIdb {
  const data = new Map<string, unknown>();
  let closes = 0;
  let firstOpen = true;
  let mode: 'none' | 'open' | 'request' = 'none';
  const store = {
    delete: (key: string): unknown => makeRequest(() => data.delete(key), mode === 'request'),
    get: (key: string): unknown => makeRequest(() => data.get(key), mode === 'request'),
    put: (value: unknown, key: string): unknown => makeRequest(() => data.set(key, value), mode === 'request'),
  };
  const db = {
    close: (): void => {
      closes += 1;
    },
    createObjectStore: (): unknown => store,
    transaction: (): unknown => ({ objectStore: (): unknown => store }),
  };
  // The first open runs onupgradeneeded (creating the object store) before onsuccess, like the real API.
  globalThis.indexedDB = {
    open: (): unknown =>
      makeRequest(
        () => db,
        mode === 'open',
        (request) => {
          if (firstOpen) {
            firstOpen = false;
            request.onupgradeneeded?.();
          }
        },
      ),
  } as unknown as IDBFactory;

  return {
    closes: () => closes,
    data,
    fail: (what): void => {
      mode = what;
    },
  };
}

/** Resolve/reject an IDB request on the task queue, the way the real API does (handlers are attached after). */
function makeRequest<T>(
  run: () => T,
  fail: boolean,
  beforeSuccess?: (request: FakeRequest<T>) => void,
): FakeRequest<T> {
  const request: FakeRequest<T> = { error: null, result: undefined as T };
  setTimeout(() => {
    if (fail) {
      request.onerror?.(); // error stays null → exercises the fallback Error the code supplies

      return;
    }
    request.result = run();
    beforeSuccess?.(request);
    request.onsuccess?.();
  }, 0);

  return request;
}

describe('stored handle persistence', () => {
  let idb: FakeIdb;

  beforeEach(() => {
    idb = installFakeIndexedDb();
    globalThis.FileSystemDirectoryHandle = FakeDirectoryHandle as unknown as typeof FileSystemDirectoryHandle;
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'indexedDB');
    Reflect.deleteProperty(globalThis, 'FileSystemDirectoryHandle');
  });

  describe('negative cases', () => {
    it('restores nothing when the user has never picked a folder', async () => {
      await expect(loadStoredDir()).resolves.toBeNull();
    });

    it('restores nothing when the persisted value is not a directory handle', async () => {
      idb.data.set('gameDir', { name: 'not-a-handle' });

      await expect(loadStoredDir()).resolves.toBeNull();
    });

    it('rejects with a named error when the database cannot be opened', async () => {
      idb.fail('open');

      await expect(loadStoredDir()).rejects.toThrow(/indexedDB open failed/);
    });

    it('rejects with a named error when a read fails, and still closes the connection', async () => {
      idb.fail('request');

      await expect(loadStoredDir()).rejects.toThrow(/indexedDB request failed/);
      expect(idb.closes()).toBe(1);
    });

    it('forgets the remembered folder so the next visit prompts again', async () => {
      const handle = new FakeDirectoryHandle('gta-sa') as unknown as FileSystemDirectoryHandle;
      await storeDir(handle);
      await clearStoredDir();

      await expect(loadStoredDir()).resolves.toBeNull();
    });
  });

  describe('positive cases', () => {
    it('round-trips the picked folder so a reload restores it without prompting', async () => {
      const handle = new FakeDirectoryHandle('gta-sa') as unknown as FileSystemDirectoryHandle;
      await storeDir(handle);

      await expect(loadStoredDir()).resolves.toBe(handle);
    });

    it('replaces the remembered folder when the user picks a different one', async () => {
      const first = new FakeDirectoryHandle('old') as unknown as FileSystemDirectoryHandle;
      const second = new FakeDirectoryHandle('new') as unknown as FileSystemDirectoryHandle;
      await storeDir(first);
      await storeDir(second);

      await expect(loadStoredDir()).resolves.toBe(second);
    });

    it('closes the database connection after every operation (no leaked handles)', async () => {
      const handle = new FakeDirectoryHandle('gta-sa') as unknown as FileSystemDirectoryHandle;
      await storeDir(handle);
      await loadStoredDir();
      await clearStoredDir();

      expect(idb.closes()).toBe(3);
    });
  });
});

describe('browserDirHandleDeps', () => {
  describe('negative cases', () => {
    it('reports a folder as not alive when listing it throws (deleted or access revoked)', async () => {
      const handle = {
        values: (): { next: () => Promise<never> } => ({
          next: (): Promise<never> => Promise.reject(new Error('NotFoundError')),
        }),
      } as unknown as FileSystemDirectoryHandle;

      await expect(browserDirHandleDeps().isAlive(handle)).resolves.toBe(false);
    });
  });

  describe('positive cases', () => {
    it('reports an empty folder as alive (yielding nothing is not a failure)', async () => {
      const handle = {
        values: (): { next: () => Promise<{ done: boolean; value: undefined }> } => ({
          next: (): Promise<{ done: boolean; value: undefined }> => Promise.resolve({ done: true, value: undefined }),
        }),
      } as unknown as FileSystemDirectoryHandle;

      await expect(browserDirHandleDeps().isAlive(handle)).resolves.toBe(true);
    });

    it('asks the picker and the permission APIs for read access only', async () => {
      const picked = { name: 'gta-sa' } as unknown as FileSystemDirectoryHandle;
      const showDirectoryPicker = vi.fn(() => Promise.resolve(picked));
      globalThis.window = { showDirectoryPicker } as unknown as typeof globalThis & Window;
      const queryPermission = vi.fn(() => Promise.resolve<PermissionState>('granted'));
      const requestPermission = vi.fn(() => Promise.resolve<PermissionState>('prompt'));
      const handle = { queryPermission, requestPermission } as unknown as FileSystemDirectoryHandle;
      const deps = browserDirHandleDeps();

      await expect(deps.pick()).resolves.toBe(picked);
      expect(showDirectoryPicker).toHaveBeenCalledWith({ id: 'opensa-game', mode: 'read' });
      await expect(deps.queryPermission(handle)).resolves.toBe('granted');
      await expect(deps.requestPermission(handle)).resolves.toBe('prompt');
      expect(queryPermission).toHaveBeenCalledWith({ mode: 'read' });
      expect(requestPermission).toHaveBeenCalledWith({ mode: 'read' });
      Reflect.deleteProperty(globalThis, 'window');
    });
  });
});
