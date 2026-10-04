/* eslint-disable no-console -- the module under test records console.error; the test has to make the calls. */
import { afterEach, describe, expect, it } from 'vitest';

import { createErrorLog } from './error-log';

const target = new EventTarget();
let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

describe('createErrorLog', () => {
  describe('negative cases', () => {
    it('collapses a repeated message into one entry with its count', () => {
      const log = createErrorLog(target, 10);
      dispose = () => log.dispose();
      console.error('cell create failed');
      console.error('cell create failed');
      console.error('cell create failed');

      expect(log.entries()).toEqual(['3x cell create failed']);
    });

    it('drops the oldest message past the limit rather than growing without bound', () => {
      const log = createErrorLog(target, 2);
      dispose = () => log.dispose();
      console.error('first');
      console.error('second');
      console.error('third');

      expect(log.entries()).toEqual(['second', 'third']);
    });

    it('records nothing once disposed', () => {
      const log = createErrorLog(target, 10);
      log.dispose();
      console.error('after dispose');

      expect(log.entries()).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('starts empty, so an empty list in a capture means the page raised nothing', () => {
      const log = createErrorLog(target, 10);
      dispose = () => log.dispose();

      expect(log.entries()).toEqual([]);
    });

    it('records a console.warn too, because the engine reports a failed pak entry as a warning', () => {
      const log = createErrorLog(target, 10);
      dispose = () => log.dispose();
      console.warn('[stream] array array-3 failed: range fetch 416 — will retry');

      expect(log.entries()).toEqual(['warn: [stream] array array-3 failed: range fetch 416 — will retry']);
    });

    it('records an error event and an unhandled rejection', () => {
      const log = createErrorLog(target, 10);
      dispose = () => log.dispose();
      target.dispatchEvent(Object.assign(new Event('error'), { message: 'boom' }));
      target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'nope' }));

      expect(log.entries()).toEqual(['boom', 'unhandled rejection: nope']);
    });
  });
});
