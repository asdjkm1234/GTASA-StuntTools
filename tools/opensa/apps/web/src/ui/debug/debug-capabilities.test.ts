import { describe, expect, it } from 'vitest';

import {
  ALL_DEBUG_CAPABILITIES,
  cameraControlsFor,
  ENGINE_DEBUG_CAPABILITIES,
  menuFor,
  skyControlsFor,
  worldLightControlsFor,
} from './debug-capabilities';

describe('menuFor', () => {
  describe('negative cases', () => {
    it('drops the Map screen when the host cannot inspect the map', () => {
      const screens = menuFor({ ...ENGINE_DEBUG_CAPABILITIES, mapScreen: false }, false).map((item) => item.screen);

      expect(screens).not.toContain('map');
    });

    it('drops the Physics screen on a host without vehicle telemetry', () => {
      const screens = menuFor(ALL_DEBUG_CAPABILITIES, false).map((item) => item.screen);

      expect(screens).not.toContain('physics');
    });

    it('drops the CLEO screen on a host without the script VM', () => {
      const screens = menuFor(ALL_DEBUG_CAPABILITIES, false).map((item) => item.screen);

      expect(screens).not.toContain('cleo');
    });

    it('drops the dev-only screens in the deploy build', () => {
      const screens = menuFor(ALL_DEBUG_CAPABILITIES, true).map((item) => item.screen);

      expect(screens).not.toContain('atmosphere');
      expect(screens).not.toContain('camera');
      expect(screens).not.toContain('graphics');
      expect(screens).not.toContain('procobj');
      expect(screens).not.toContain('map');
      expect(screens).not.toContain('physics');
    });
  });

  describe('positive cases', () => {
    it('keeps every screen for a fully capable host in a dev build', () => {
      const screens = menuFor({ ...ALL_DEBUG_CAPABILITIES, physicsScreen: true }, false).map((item) => item.screen);

      expect(screens).toEqual([
        'player',
        'vehicles',
        'physics',
        'time',
        'atmosphere',
        'camera',
        'graphics',
        'perf',
        'procobj',
        'weather',
        'position',
        'map',
      ]);
    });

    it('keeps the renderer-agnostic screens for the engine host, Map included (restored 074/22 phase 7)', () => {
      const screens = menuFor(ENGINE_DEBUG_CAPABILITIES, false).map((item) => item.screen);

      expect(screens).toEqual([
        'player',
        'vehicles',
        'physics',
        'cleo',
        'time',
        'atmosphere',
        'camera',
        'graphics',
        'perf',
        'procobj',
        'weather',
        'position',
        'map',
      ]);
    });
  });
});

describe('skyControlsFor', () => {
  describe('negative cases', () => {
    it('hides the god-rays shader sliders when the host has a single-strength pass', () => {
      const keys = skyControlsFor(ENGINE_DEBUG_CAPABILITIES);

      expect(keys).not.toContain('density');
      expect(keys).not.toContain('exposure');
      expect(keys).not.toContain('weight');
    });
  });

  describe('positive cases', () => {
    it('keeps the shared sky sliders on every host', () => {
      expect(skyControlsFor(ENGINE_DEBUG_CAPABILITIES)).toEqual(['mood', 'pbrExposure']);
    });

    it('lists the shader sliders first for a fully capable host', () => {
      expect(skyControlsFor(ALL_DEBUG_CAPABILITIES)).toEqual(['density', 'exposure', 'weight', 'mood', 'pbrExposure']);
    });
  });
});

describe('cameraControlsFor', () => {
  describe('negative cases', () => {
    it('hides the rig sliders on a host without a rig to tune', () => {
      const keys = cameraControlsFor({ ...ENGINE_DEBUG_CAPABILITIES, cameraRig: false }).map(([key]) => key);

      expect(keys).toEqual(['followDistance', 'followZoomMin', 'followZoomMax']);
    });
  });

  describe('positive cases', () => {
    it('keeps distance and the zoom bounds first, everywhere', () => {
      expect(
        cameraControlsFor(ALL_DEBUG_CAPABILITIES)
          .slice(0, 3)
          .map(([key]) => key),
      ).toEqual(['followDistance', 'followZoomMin', 'followZoomMax']);
    });

    it('gives the engine host the 080 rig rows (framing, look, and the 02 feel channels)', () => {
      const keys = cameraControlsFor(ENGINE_DEBUG_CAPABILITIES).map(([key]) => key);

      for (const key of ['followHeight', 'sensitivity', 'pitchMin', 'pitchMax'] as const) {
        expect(keys).toContain(key);
      }
      for (const key of ['inputSmoothTime', 'positionLagTime', 'verticalLagTime', 'deadZone', 'yawLagTime'] as const) {
        expect(keys).toContain(key); // a field round tunes the feel live, without a rebuild
      }
      for (const key of ['recenterDelaySec', 'recenterRate', 'lookAheadDistance', 'lookAheadTime'] as const) {
        expect(keys).toContain(key); // the 03 composition channels
      }
      for (const key of [
        'vehicleDistanceScale',
        'collisionRadius',
        'collisionMinDistance',
        'collisionReleaseTime',
        'collisionWhiskerAngle',
      ] as const) {
        expect(keys).toContain(key); // the 04 collision channels + the car-distance scale
      }
      for (const key of [
        'vehicleDistanceGain',
        'vehicleFovKick',
        'vehicleYawLagTime',
        'vehicleRecenterDelaySec',
        'vehicleVerticalLagTime',
        'vehicleCollisionReleaseTime',
        'driftLookBlend',
        'driftSlipDeadZone',
        'driftMinSpeed',
      ] as const) {
        expect(keys).toContain(key); // the 05 vehicle tuning table — the drive round turns these live
      }
      for (const key of ['bobAmplitude', 'landingDipScale', 'shakeScale', 'sprintFovKick'] as const) {
        expect(keys).toContain(key); // 06 motion feel (its `reducedMotion` master switch is a toggle, not a slider)
      }
      for (const key of [
        'footYawAuthorityStart',
        'footYawAuthorityFull',
        'footRunDistanceGain',
        'footIdleDistanceEase',
        'vehicleAccelDistanceGain',
      ] as const) {
        expect(keys).toContain(key); // the 09 follow policy — its field round turns these live
      }
      // The close-out prune (07/3) took the three reference points no round ever turned.
      for (const key of ['landingDipFullSpeed', 'shakeImpactForce', 'vehicleFovLambda'] as const) {
        expect(keys).not.toContain(key);
      }
      expect(keys).toHaveLength(46);
    });
  });
});

describe('worldLightControlsFor', () => {
  describe('negative cases', () => {
    it('hides the scalars the engine world light never reads', () => {
      const keys = worldLightControlsFor(ENGINE_DEBUG_CAPABILITIES).map(([key]) => key);

      expect(keys).not.toContain('duskBrightness');
      expect(keys).not.toContain('shadowStrength');
      expect(keys).not.toContain('sunDirect');
    });
  });

  describe('positive cases', () => {
    it('keeps the knobs the environment driver actually applies (day/night + the 093 ambient)', () => {
      expect(worldLightControlsFor(ENGINE_DEBUG_CAPABILITIES).map(([key]) => key)).toEqual([
        'dayBrightness',
        'nightPrelitBrightness',
        'ambient',
        'ambientFloor',
      ]);
    });

    it('shows all nine for a fully capable host', () => {
      expect(worldLightControlsFor(ALL_DEBUG_CAPABILITIES)).toHaveLength(9);
    });
  });
});
