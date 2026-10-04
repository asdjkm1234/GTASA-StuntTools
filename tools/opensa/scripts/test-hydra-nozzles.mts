/** Exercise the replay aircraft driver against locally baked geometry, without a GPU or game writes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { Engine, VehicleModelInit } from '@opensa/engine';
import { RigidEntity } from '@opensa/engine/entities/rigid';

import { loadAircraft } from '../apps/web/src/flight/aircraft';
import { parseFlightCsv, sampleTrack } from '../apps/web/src/flight/csv';
import { HYDRA_NOZZLE_NODE_NAMES } from '../apps/web/src/flight/nozzle';
import type { PakResources } from '../apps/web/src/flight/pak-resources';
import { visualPropellerMotion } from '../apps/web/src/flight/propeller';

// Constructors create the cockpit canvas, but no instrument drawing is needed for this geometry check.
Object.assign(globalThis, { document: { createElement: () => ({ getContext: () => ({}) }) } });
const models: VehicleModelInit[] = [];
const visibility = new Map<number, boolean[]>();
const engine = {
  createVehicleModel(init: VehicleModelInit): number {
    models.push(init);
    return models.length - 1;
  },
  createVehicle(id: number) {
    const visible: boolean[] = [];
    visibility.set(id, visible);
    return {
      entity: new RigidEntity(models[id].parts),
      setSubmeshVisible(index: number, value: boolean): void {
        visible[index] = value;
      },
      setPaint(): void {},
    };
  },
  destroyVehicle(): void {},
  destroyVehicleModel(): void {},
} as unknown as Engine;
const resources = {
  async readRaw(name: string): Promise<Uint8Array> {
    return readFileSync(`map-pak/aircraft/${name}`);
  },
  getText(name: string): string {
    return readFileSync(`map-pak/${name}`, 'utf8');
  },
} as unknown as PakResources;

for (const model of [520, 476]) {
  const aircraft = await loadAircraft(engine, resources, model);
  const entity = aircraft.instance.entity;
  entity.flatten();
  const original = entity.matrices.slice();
  const nozzleParts = HYDRA_NOZZLE_NODE_NAMES.map((name) => entity.partIndex(name));
  const check = (control: number): void => {
    aircraft.applyProps({ nozzleRotation: control });
    entity.flatten();
    if (model === 476) {
      assert.deepEqual(entity.matrices, original, 'Hydra nozzle control must not drive Rustler');
      return;
    }
    for (const part of nozzleParts) {
      assert(part >= 0, 'The real Hydra must supply both nozzle assemblies');
      const m = entity.matrices.subarray(part * 16, part * 16 + 16);
      const angle = Math.atan2(m[6], m[5]);
      assert(Math.abs(angle - ((control / 5000) * Math.PI) / 2) < 1e-6, 'Absolute native-X rotation matches GTA');
      assert.deepEqual(
        Array.from(m.subarray(12, 15)),
        Array.from(original.subarray(part * 16 + 12, part * 16 + 15)),
        'Pivot stays fixed',
      );
      // The authored outlet points aft (-Y). At 5000 it must point down (-Z), on both sides.
      if (control === 5000) assert(-m[6] < -0.999 && Math.abs(m[5]) < 1e-6);
    }
    for (let part = 0; part < aircraft.data.parts.length; part++) {
      if (nozzleParts.includes(part)) continue;
      assert.deepEqual(
        entity.matrices.subarray(part * 16, part * 16 + 16),
        original.subarray(part * 16, part * 16 + 16),
        'Only nozzle parts rotate',
      );
    }
  };
  for (const control of [0, 2500, 5000, 0, 5000, 2500]) check(control);
  aircraft.applyProps({ nozzleRotation: null });
  entity.flatten();
  assert.deepEqual(entity.matrices, original, 'Unknown nozzle control clears the preceding animation');
  if (model === 520) {
    const tyres = aircraft.data.wheels.filter((w) =>
      HYDRA_NOZZLE_NODE_NAMES.some((n) => aircraft.data.parts[w.part].name === n),
    );
    assert.equal(tyres.length, 2, 'Exercise the generic builder middle-wheel duplication');
    for (const visible of [false, true]) {
      aircraft.setVisible(visible);
      aircraft.data.submeshes.forEach((mesh, index) => {
        const expected = visible && mesh.kind === 'body' && !tyres.some((w) => w.part === mesh.part);
        assert.equal(visibility.get(aircraft.modelId)?.[index], expected, 'No phantom tyres after visibility toggles');
      });
    }
    const track = parseFlightCsv(
      readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv', 'utf8'),
      'real.csv',
    );
    const low = track.rows.find((r) => r.nozzleRotation === 0)!;
    const high = track.rows.find((r) => r.nozzleRotation === 5000)!;
    assert(low && high);
    for (const row of [high, low, high]) {
      const pose = sampleTrack(track, row.s);
      aircraft.applyProps({ nodes: pose.row.propNodes, nozzleRotation: pose.row.nozzleRotation });
      entity.flatten();
      const m = entity.matrices.subarray(nozzleParts[0] * 16, nozzleParts[0] * 16 + 16);
      assert(Math.abs(Math.atan2(m[6], m[5]) - ((row.nozzleRotation! / 5000) * Math.PI) / 2) < 1e-6);
    }
  }
  if (model === 476) {
    const track = parseFlightCsv(
      readFileSync('../../GTA San Andreas/flight_recordings/flight_20260928_003025_495_m476_003.csv', 'utf8'),
      'rustler.csv',
    );
    assert(
      track.rows.every((row) => row.propNodes.every((node) => !node)),
      'Old Rustler recording lacks measured props',
    );
    const staticPart = entity.partIndex('static_prop');
    const movingPart = entity.partIndex('moving_prop');
    assert(staticPart >= 0 && movingPart >= 0);
    const propParts = [staticPart, movingPart];
    const checkVisibility = (spinning: boolean, visible = true): void => {
      aircraft.data.submeshes.forEach((mesh, index) => {
        const expected =
          visible &&
          mesh.kind === 'body' &&
          (mesh.part === staticPart ? !spinning : mesh.part === movingPart ? spinning : true);
        assert.equal(visibility.get(aircraft.modelId)?.[index], expected, 'Exactly one prop representation visible');
      });
    };
    checkVisibility(false);
    const at = 0.123;
    const motion = visualPropellerMotion(track, at)!;
    assert(motion.spinning);
    aircraft.applyProps({ propeller: motion });
    entity.flatten();
    const spinning = entity.matrices.slice();
    for (const part of propParts) {
      const m = entity.matrices.subarray(part * 16, part * 16 + 16);
      const angle = part === staticPart ? motion.phase * 2 : -motion.phase;
      assert(Math.abs(m[0] - Math.cos(angle)) < 1e-6);
      assert(Math.abs(m[2] + Math.sin(angle)) < 1e-6, 'Native Y shaft rotation');
      assert.deepEqual(m.subarray(12, 15), original.subarray(part * 16 + 12, part * 16 + 15), 'Prop pivot fixed');
    }
    for (let part = 0; part < aircraft.data.parts.length; part++) {
      if (!propParts.includes(part))
        assert.deepEqual(
          spinning.subarray(part * 16, part * 16 + 16),
          original.subarray(part * 16, part * 16 + 16),
          'Body and landing gear unchanged',
        );
    }
    checkVisibility(true);
    for (const visible of [false, true]) {
      aircraft.setVisible(visible);
      checkVisibility(true, visible);
    }
    aircraft.applyProps({ propeller: visualPropellerMotion(track, 1) });
    entity.flatten();
    assert.notDeepEqual(entity.matrices, spinning, 'Advancing capture time rotates props');
    aircraft.applyProps({ propeller: motion });
    entity.flatten();
    assert.deepEqual(entity.matrices, spinning, 'Reverse seek exactly restores prop angle');
    aircraft.applyProps({ propeller: { ...motion, spinning: false } });
    checkVisibility(false);
    aircraft.applyProps({
      propeller: motion,
      nodes: [
        [0, 0, 0, 1],
        [0, 0, 0, 1],
      ],
    });
    entity.flatten();
    assert.deepEqual(entity.matrices, original, 'Measured quaternions override inferred angles');
    aircraft.applyProps({});
    entity.flatten();
    checkVisibility(false);
    assert.deepEqual(entity.matrices, original, 'Missing animation resets prop pose');
  }
  aircraft.dispose();
  console.log(`PASS: ${model}, actual aircraft geometry, replay driver, scrub and visibility`);
}
