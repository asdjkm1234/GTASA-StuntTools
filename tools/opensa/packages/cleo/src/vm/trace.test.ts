import { describe, expect, it } from 'vitest';

import { AtlasMemory, SA } from './native-atlas';
import { createRecordingHost } from './recording-host';
import { ScriptRunner } from './runner';
import { buildScript, int } from './test-script';
import { TraceRing } from './trace';

/** WAIT / HAS_MODEL_LOADED / TERMINATE — enough surface to exercise every tracer seam. */
const WAIT = 0x0001;
const TERMINATE = 0x004e;
const HAS_MODEL_LOADED = 0x0248;

const world = {
  doorAngleRatio: (): null => null,
  lightStatus: (): number => 0,
  lodDistMultiplier: (): number => 1,
  nextSiblingPart: (): null => null,
  partForward: (): readonly [number, number, number] => [0, 1, 0],
  partIndex: (): null => null,
  partTranslation: (): readonly [number, number, number] => [0, 0, 0],
  setLightStatus: (): void => undefined,
  setPartRotation: (): void => undefined,
  setPartTranslationComponent: (): void => undefined,
  vehicleHandles: (): readonly number[] => [],
  wind: (): number => 0.4,
};

describe('TraceRing', () => {
  describe('negative cases', () => {
    it('records nothing while disabled — the field default costs one boolean per instruction', () => {
      const trace = new TraceRing();
      expect(trace.push('a', 'line')).toBeUndefined();
      expect(trace.snapshot()).toEqual([]);
    });

    it('a disabled ring on the runner leaves the tick untraced', () => {
      const trace = new TraceRing();
      const runner = new ScriptRunner({ host: createRecordingHost(), trace });
      runner.spawn(buildScript([{ op: WAIT, operands: [int(0)] }]), 'quiet');
      runner.tick(16);
      expect(trace.snapshot()).toEqual([]);
    });

    it('snapshot of a thread that never traced is empty', () => {
      const trace = new TraceRing();
      trace.enabled = true;
      trace.push('a', 'line');
      expect(trace.snapshot('b')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('records dispatched instructions in the disasm contract format, per thread', () => {
      const trace = new TraceRing();
      trace.enabled = true;
      const runner = new ScriptRunner({ host: createRecordingHost(), trace });
      runner.spawn(buildScript([{ op: WAIT, operands: [int(250)] }]), 'ferris');
      runner.tick(16);
      const lines = trace.snapshot('ferris').map((entry) => entry.line);
      expect(lines).toEqual(['000000: 0001 WAIT 250']);
    });

    it('a conditional line carries the gate ANSWER appended after dispatch', () => {
      const trace = new TraceRing();
      trace.enabled = true;
      const runner = new ScriptRunner({ host: createRecordingHost(), trace });
      runner.spawn(buildScript([{ op: HAS_MODEL_LOADED, operands: [int(400)] }, { op: TERMINATE }]), 'gate');
      runner.tick(16);
      const lines = trace.snapshot('gate').map((entry) => entry.line);
      expect(lines[0]).toBe('000000: 0248 HAS_MODEL_LOADED 400 -> true');
    });

    it('wraps at capacity keeping the NEWEST entries, seq still rising', () => {
      const trace = new TraceRing(3);
      trace.enabled = true;
      for (let index = 0; index < 5; index += 1) {
        trace.push('t', `line ${index}`);
      }
      const entries = trace.snapshot();
      expect(entries.map((entry) => entry.line)).toEqual(['line 2', 'line 3', 'line 4']);
      expect(entries.map((entry) => entry.seq)).toEqual([2, 3, 4]);
    });

    it('atlas ops land as SYMBOLISED host effects under the current thread', () => {
      const trace = new TraceRing();
      trace.enabled = true;
      trace.currentThread = 'windfarm';
      const atlas = new AtlasMemory(world, (line) => trace.hostEffect(line));
      atlas.read(SA.WEATHER_WIND, 4);
      const lines = trace.snapshot('windfarm').map((entry) => entry.line);
      expect(lines).toEqual(['  read CWeather::Wind -> 0.400']);
    });

    it('step() dispatches exactly ONE instruction, even while the thread sleeps', () => {
      const trace = new TraceRing();
      trace.enabled = true;
      const runner = new ScriptRunner({ host: createRecordingHost(), trace });
      const thread = runner.spawn(
        buildScript([
          { op: WAIT, operands: [int(10_000)] },
          { op: HAS_MODEL_LOADED, operands: [int(400)] },
          { op: TERMINATE },
        ]),
        'stepper',
      );
      runner.tick(16); // dispatches the WAIT — the thread now sleeps far past this tick
      expect(thread.instructionsLastTick).toBe(1);
      runner.step(thread);
      const lines = trace.snapshot('stepper').map((entry) => entry.line);
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe('000010: 0248 HAS_MODEL_LOADED 400 -> true');
      expect(thread.terminated).toBe(false);
    });

    it('a handler throw leaves a located fault line in the story', () => {
      const trace = new TraceRing();
      trace.enabled = true;
      const runner = new ScriptRunner({ host: createRecordingHost(), trace });
      // 0002 GOTO to a non-boundary offset faults inside the handler.
      runner.spawn(buildScript([{ op: 0x0002, operands: [int(-7)] }]), 'crash');
      runner.tick(16);
      const lines = trace.snapshot('crash').map((entry) => entry.line);
      expect(lines.some((line) => line.startsWith('  ! thread killed at offset 0'))).toBe(true);
    });
  });
});
