/**
 * The end-to-end guard the story test structurally cannot be: OUR compiled artifact, on the VM, over
 * the part list of the REAL GTA 5 Rhino model — no hand-written name list, no permissive mock.
 *
 * This is the test that would have caught the field defect. Every headless check in step 3 passed
 * while the shipped script did nothing at all, because the recording host answers "yes" to any frame
 * name it is asked for, and the rhino's rig is exactly where the original's assumptions die: its
 * `misc_e` chain anchor is a dummy the vehicle builder never emits as a part. Assert against the rig
 * the builder actually produces, or assert nothing.
 */
import { createRecordingHost, decodeScript, ScriptRunner } from '@opensa/cleo';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { compileScript } from '../../sdk/src/build';
import { script as definition, SPEC } from './script';

const MODEL = 'fixtures/original/vehicles/rhino.dff';
const ORIGINAL = 'fixtures/original/cleo/rhino.cs';
const CAR = 257;
const FRAME_MS = 1000 / 60;
/** The big DFF is 1.7 MB and the builder is not cheap — well past vitest's 5 s default. */
const TIMEOUT = 30_000;

const realRig = (): { parts: readonly string[]; wheelRadius: number } => {
  const bytes = new Uint8Array(readFileSync(MODEL));
  const clump = parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const model = buildVehicleModel(clump, new VehicleTextures([]));

  return { parts: model.parts.map((part) => part.name), wheelRadius: model.wheels[0]?.radius ?? 0 };
};

/** A reference wheel rolled to `degrees`: heading = atan2(-forward.y, forward.z). */
const rolledTo = (degrees: number): readonly [number, number, number] => [
  0,
  -Math.sin((degrees * Math.PI) / 180),
  Math.cos((degrees * Math.PI) / 180),
];

const run = (bytes: Uint8Array, parts: readonly string[], degrees: number): readonly string[] => {
  const host = createRecordingHost({
    cars: [{ handle: CAR, model: 432 }],
    partForward: rolledTo(degrees),
    partNames: parts,
  });
  const runner = new ScriptRunner({ host });
  runner.spawn(decodeScript(bytes), 'rhino');
  for (let frame = 0; frame < 3; frame += 1) {
    runner.tick(FRAME_MS);
  }
  expect(runner.faults).toEqual([]);

  return host.calls;
};

const visibleLink = (calls: readonly string[]): string | undefined =>
  calls
    .filter((line) => line.startsWith('natives.setPartTranslation') && line.includes('track_'))
    .slice(-SPEC.TRACK_LINKS)
    .filter((line) => line.endsWith('z=0'))
    .map((line) => line.split(' ')[2].split('#')[0])[0];

describe.skipIf(!existsSync(MODEL))('rhino-tracks on the real model', () => {
  describe('negative cases', () => {
    it.skipIf(!existsSync(ORIGINAL))(
      "the AUTHOR'S original does nothing on this rig — the defect, pinned",
      () => {
        // Its chain anchor is `m_aCarNodes[CAR_MISC_E]` = `misc_e`, a dummy the builder does not emit
        // as a part, so the walk never starts. If this ever stops being true the rig changed and the
        // whole 001 diagnosis needs re-reading.
        const { parts } = realRig();
        expect(parts).not.toContain('misc_e');
        const calls = run(new Uint8Array(readFileSync(ORIGINAL)), parts, 40);

        expect(calls.filter((line) => line.startsWith('natives.setPart'))).toEqual([]);
      },
      TIMEOUT,
    );
  });

  describe('positive cases', () => {
    it(
      'the real rig carries every frame our script addresses',
      () => {
        const { parts } = realRig();
        const wanted = [
          'wheel_rb_dummy',
          'wheel_big_0',
          'wheel_big_1',
          ...Array.from({ length: 8 }, (_, index) => `wheel_small_${index + 1}`),
          ...Array.from({ length: SPEC.TRACK_LINKS }, (_, index) => `track_${index + 1}`),
        ];
        for (const name of wanted) {
          expect(parts).toContain(name);
        }
      },
      TIMEOUT,
    );

    it(
      'OUR artifact drives that rig: one link visible, and it ADVANCES with the wheel',
      () => {
        const { parts } = realRig();
        const bytes = compileScript(definition).bytes;
        const seen = [0, 2, 5, 11, 17.9].map((degrees) => visibleLink(run(bytes, parts, degrees)));

        expect(seen).toEqual(['track_1', 'track_2', 'track_4', 'track_8', 'track_12']);
        // A parked tank (heading 270, the original ladder's uncovered point) still shows a link.
        expect(visibleLink(run(bytes, parts, 270))).toBe('track_1');
      },
      TIMEOUT,
    );

    it(
      "the builder leaves this model's MARKER wheel unscaled but keeps a real physics radius",
      () => {
        // The `wheel` atomic here is a flat 2 cm triangle — the author hiding the SA road wheels.
        // Fitting it to the ide diameter scaled it 23.5x and drew six shards that swept with the
        // wheels (field 2026-08-07). The radius may never follow the marker down.
        const { wheelRadius } = realRig();

        expect(wheelRadius).toBeGreaterThan(0.3);
      },
      TIMEOUT,
    );
  });
});
