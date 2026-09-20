import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootBytes, bootDone, bootFail, bootStep } from './boot-progress';

interface Shell {
  done: () => void;
  fail: (message: string) => void;
  step: (text: string, done?: number, total?: number, note?: string) => void;
}

function installShell(): Shell {
  const shell: Shell = { done: vi.fn(), fail: vi.fn(), step: vi.fn() };
  (globalThis as { __opensaBoot?: Shell }).__opensaBoot = shell;

  return shell;
}

afterEach(() => {
  delete (globalThis as { __opensaBoot?: Shell }).__opensaBoot;
});

describe('boot-progress', () => {
  describe('negative cases', () => {
    it('does nothing when no shell is present — the viewer harness and the tests have none', () => {
      expect(() => {
        bootStep('starting the GPU…');
        bootFail('no adapter');
        bootDone();
      }).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('passes the phase, its fraction and its note through to the shell', () => {
      const shell = installShell();

      bootStep('streaming the world…', 3, 4, '12.4 MB read');

      expect(shell.step).toHaveBeenCalledWith('streaming the world…', 3, 4, '12.4 MB read');
    });

    it('forwards the failure and the release', () => {
      const shell = installShell();

      bootFail('no WebGPU adapter');
      bootDone();

      expect(shell.fail).toHaveBeenCalledWith('no WebGPU adapter');
      expect(shell.done).toHaveBeenCalledTimes(1);
    });

    it('shows kilobytes under a megabyte so a small read is not "0.0 MB"', () => {
      expect(bootBytes(0)).toBe('0 kB');
      expect(bootBytes(64 * 1024)).toBe('64 kB');
      expect(bootBytes(1024 * 1024 - 1)).toBe('1024 kB');
    });

    it('shows one decimal megabyte from a megabyte up', () => {
      expect(bootBytes(1024 * 1024)).toBe('1.0 MB');
      expect(bootBytes(13 * 1024 * 1024)).toBe('13.0 MB');
      expect(bootBytes(38.64 * 1024 * 1024)).toBe('38.6 MB');
    });
  });
});
