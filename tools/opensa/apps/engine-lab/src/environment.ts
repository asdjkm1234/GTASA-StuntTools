/**
 * Environment drive (plan 074/06 row 14): thin lab wrappers over the SHARED config→Environment driver
 * (`@opensa/game/adapters/engine-environment-driver` — the 074/10 config-API parity module). The lab runs the
 * standalone defaults (no game config) plus its `?fogscale=` camera-altitude compensation.
 */
import type { Engine } from '@opensa/engine';

import {
  createEngineEnvironmentDriver,
  DEFAULT_ENGINE_ENV_CONFIG,
  type EngineEnvConfig,
  FOG_RING_MARGIN,
} from '@opensa/game/adapters/engine-environment-driver';

export { FOG_RING_MARGIN };

export interface EnvironmentDriver {
  apply(hour: number): void;
}

/** Fallback parametric arc (no timecyc in the manifest — old paks). */
export function parametricDriver(engine: Engine, aces = true, bloom: null | number = null): EnvironmentDriver {
  return createEngineEnvironmentDriver(engine.environment, { config: labConfig(aces, bloom) });
}

/** The real thing: timecyc colours + fog ranges per hour/weather.
 *  The lab camera flies hundreds of units up — radial ground distances dwarf street-level ones, so the
 *  timecyc fog mood needs a scale (`?fogscale=N`, default 2.5); the game host runs it at 1.
 *  `fogCap` (074/21, `?draw=` opt-in) clamps the cut to the streaming ring's margin — see the game host. */
export function timecycDriver(
  engine: Engine,
  timecycText: string,
  weather: number,
  fogScale = 2.5,
  aces = true,
  bloom: null | number = null,
  fogCap?: number,
): EnvironmentDriver {
  return createEngineEnvironmentDriver(engine.environment, {
    config: labConfig(aces, bloom),
    ...(fogCap !== undefined ? { fogCap } : {}),
    fogScale,
    timecyc: { text: timecycText },
    weather,
  });
}

/** Lab standalone config with the `?aces=0` / `?bloom=` A/B folded in (074/09): `bloom` null = default,
 *  0 = off, any other number = intensity override. */
function labConfig(aces: boolean, bloom: null | number): EngineEnvConfig {
  if (aces && bloom === null) {
    return DEFAULT_ENGINE_ENV_CONFIG;
  }
  const base = DEFAULT_ENGINE_ENV_CONFIG.graphics;

  return {
    ...DEFAULT_ENGINE_ENV_CONFIG,
    graphics: {
      ...base,
      bloom:
        bloom === null
          ? base.bloom
          : {
              enabled: bloom > 0,
              intensity: bloom > 0 ? bloom : base.bloom.intensity,
              threshold: base.bloom.threshold,
            },
      toneMapping: aces,
    },
  };
}
