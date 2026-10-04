import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { wheelAnimPoses } from './anim-poses';
import { type ClumpModel, writeClump } from './rig/clump-io';
import { IDENTITY_ROTATION } from './rig/matrix';
import { canonicalPartName, extractBikeTemplate, extractBoatTemplate, extractCarTemplate } from './template';

const CS_BOBCAT = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csbobcat92.dff'));
const CS_TAXI = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/cstaxi92.dff'));
const CS_REMINGTON = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csremington92.dff'));
const CS_MTBIKE = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csmtbike92.dff'));
const CS_DINGHY = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csdinghy.dff'));

/** A minimal synthetic clump: named frames under a root, no HAnim — not a cutscene rig. */
function clumpWithoutBones(): Uint8Array {
  const frame = (name: string, parentIndex: number): ClumpModel['frames'][number] => ({
    flags: 3,
    name,
    parentIndex,
    position: [0, 0, 0],
    rotation: [...IDENTITY_ROTATION],
  });

  return writeClump({
    atomics: [],
    frames: [frame('root', -1), frame('chassis', 0)],
    geometries: [],
    version: 0x1803ffff,
  });
}

describe('canonicalPartName', () => {
  describe('negative cases', () => {
    it('leaves non-hi names untouched', () => {
      expect(canonicalPartName('chassis_vlo')).toBe('chassis_vlo');
    });
  });

  describe('positive cases', () => {
    it('strips the taxi-style _hi segment', () => {
      expect(canonicalPartName('door_lf_hi_ok')).toBe('door_lf_ok');
      expect(canonicalPartName('bonnet_hi_ok')).toBe('bonnet_ok');
    });
  });
});

describe('extractCarTemplate', () => {
  describe('negative cases', () => {
    it('throws on a model with no HAnim skeleton root', () => {
      expect(() => extractCarTemplate(clumpWithoutBones())).toThrow('no HAnim skeleton root');
    });
  });

  describe('positive cases', () => {
    it('reads the bobcat style: Box nodes, chassis bone 9, left-wheel z-180 meshes', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      expect(template.rootName).toBe('bobcat_dummy');
      expect(template.chassisBoneId).toBe(9);
      expect(template.wheelRadius).toBeCloseTo(0.349, 2);
      expect([...template.parts.keys()]).toEqual([
        'bonnet_ok',
        'boot_ok',
        'bump_front_ok',
        'bump_rear_ok',
        'door_lf_ok',
        'door_rf_ok',
        'extra1',
        'extra2',
        'exhaust_ok',
      ]);
      expect(template.wheels.get('rf')).toMatchObject({ meshBoneId: 2, nodeBoneId: 1, nodeName: 'Box01' });
      expect(template.wheels.get('rf')?.nodeZ).toBeCloseTo(0.35, 3);
      // Left meshes carry the measured 180°-about-z; right meshes are identity.
      expect(template.wheels.get('lf')?.meshRotation[0]).toBeCloseTo(-1, 4);
      expect(template.wheels.get('rf')?.meshRotation[0]).toBeCloseTo(1, 4);
    });

    it('reads the taxi style: _hi part names kept, canonical keys stripped', () => {
      const template = extractCarTemplate(CS_TAXI);
      expect(template.rootName).toBe('taxi');
      expect(template.parts.get('door_lf_ok')?.frameName).toBe('door_lf_hi_ok');
      expect(template.parts.get('door_lr_ok')?.boneId).toBe(15);
      expect(template.wheels.get('lb')?.nodeName).toBe('wheel_lb_node');
    });

    it('reads the remington style: chassis bone 1, wheels after the parts', () => {
      const template = extractCarTemplate(CS_REMINGTON);
      expect(template.rootName).toBe('remingtn');
      expect(template.chassisBoneId).toBe(1);
      expect(template.wheels.get('lf')?.nodeName).toBe('wheelLFNode');
      expect(template.wheels.get('lf')?.nodeZ).toBeCloseTo(-0.35, 3);
    });

    it('wheel corners follow the scene ANIM poses over a lying bind (round 16)', () => {
      // R*'s csglendale92 binds its LEFT wheels crossed front-to-rear versus what every scene drives:
      // wheel02 binds at the left REAR but SMOKE1B animates it to the left FRONT (and wheel03 the
      // reverse). Classifying corners from the bind handed each left wheel the other end's mod-corner
      // shim — in game each sat 0.21 m off its arch. The anim pose is where the runtime puts the bone.
      const csGlendale = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csglendale92.dff'));
      const ifp = new Uint8Array(readFileSync('fixtures/original/anim/smoke1b.ifp'));
      const poses = wheelAnimPoses(buildVer2Buffer([{ data: ifp, name: 'smoke1b.ifp' }]));
      const wheelPoses = poses.get('csglendale92')!;
      expect(wheelPoses.get('wheel02')![1]).toBeCloseTo(1.792, 3); // the anim's left FRONT

      const template = extractCarTemplate(csGlendale, wheelPoses);
      expect(template.wheels.get('lf')?.meshName).toBe('wheel02');
      expect(template.wheels.get('lf')?.nodePosition[1]).toBeCloseTo(1.792, 3);
      expect(template.wheels.get('lb')?.meshName).toBe('wheel03');

      // Bind-only fallback keeps R*'s crossed labels — the pre-round-16 behaviour.
      const bindTemplate = extractCarTemplate(csGlendale);
      expect(bindTemplate.wheels.get('lf')?.meshName).toBe('wheel03');
    });
  });
});

describe('extractBikeTemplate', () => {
  describe('negative cases', () => {
    it('throws on a model with no HAnim skeleton root', () => {
      expect(() => extractBikeTemplate(clumpWithoutBones())).toThrow('no HAnim skeleton root');
    });

    it('throws on a car rig (no wheel_rear part)', () => {
      expect(() => extractBikeTemplate(CS_BOBCAT)).toThrow('no wheel_rear part');
    });
  });

  describe('positive cases', () => {
    it('reads csmtbike92: seven mesh-bone parts under the chassis, rear-wheel ground reference', () => {
      const template = extractBikeTemplate(CS_MTBIKE);
      expect(template.rootName).toBe('csbikechassis_dummy');
      expect(template.chassisBoneId).toBe(1);
      expect([...template.parts.keys()]).toEqual([
        'wheel_rear',
        'chainset',
        'pedal_r',
        'pedal_l',
        'handlebars',
        'forks_front',
        'wheel_front',
      ]);
      expect(template.parts.get('wheel_rear')?.boneId).toBe(2);
      expect(template.parts.get('wheel_front')?.parentCanonical).toBe('forks_front');
      expect(template.parts.get('pedal_l')?.parentCanonical).toBe('chainset');
      expect(template.groundZ).toBeCloseTo(-0.256, 3);
      expect(template.wheelRadius).toBeGreaterThan(0.25);
    });
  });
});

describe('extractBoatTemplate', () => {
  describe('negative cases', () => {
    it('throws on a model with no HAnim skeleton root', () => {
      expect(() => extractBoatTemplate(clumpWithoutBones())).toThrow('no HAnim skeleton root');
    });

    it('throws on a car rig (no boat_hi frame)', () => {
      expect(() => extractBoatTemplate(CS_BOBCAT)).toThrow('no boat_hi frame');
    });
  });

  describe('positive cases', () => {
    it('reads csdinghy: boat_hi body bone 1, two transom-flap parts', () => {
      const template = extractBoatTemplate(CS_DINGHY);
      expect(template.rootName).toBe('dinghy');
      expect(template.bodyName).toBe('boat_hi');
      expect(template.bodyBoneId).toBe(1);
      expect(template.bodyLocal.position[2]).toBeCloseTo(0.357, 3);
      expect([...template.parts.keys()]).toEqual(['boat_rearflap_right', 'boat_rearflap_left']);
      expect(template.parts.get('boat_rearflap_right')?.boneId).toBe(2);
      expect(template.parts.get('boat_rearflap_left')?.boneId).toBe(3);
      expect(template.parts.get('boat_rearflap_left')?.parentCanonical).toBe('boat_hi');
    });
  });
});
