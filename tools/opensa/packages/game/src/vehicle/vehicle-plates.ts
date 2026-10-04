/**
 * Which plate a spawning car wears (plan 082/04) — pure, so the same placement always resolves to the same
 * plate: a parked car keeps its number across LOD respawns, reloads and sessions.
 *
 * The city is read at the car's OWN position, not the player's. A San Fierro car streamed in while the
 * player stands in Los Santos wears SF plates, which is the whole point of resolving it per placement.
 */
import type { City, CityBox } from '../zones/city';
import type { PlateCity } from './plate-raster';

import { cityAt } from '../zones/city';
import { generatePlateText } from './plate-raster';

/** Per-city mask (the plan-01 DSL). An empty mask falls back to the game's own `LLDD DLL`. */
export interface PlateMasks {
  readonly la: string;
  readonly sf: string;
  readonly vegas: string;
}

/** The placement fields plates care about — a subset of `VehiclePlacement`. */
export interface PlatePlacement {
  readonly model: string;
  /** An explicit plate (debug spawner, a mission car): wins over the deterministic hash. */
  readonly plate?: string;
  readonly position: readonly [number, number, number];
}

/** What a spawn needs to dress its plate quads. */
export interface PlateResolution {
  readonly city: PlateCity;
  readonly text: string;
}

/** Outside every city and desert box there is no local authority — pick one, but pick it stably. */
const OUT_OF_CITY: readonly PlateCity[] = ['LA', 'SF', 'VEGAS'];

/**
 * The plate for one placement. `COUNTRYSIDE` and `DESERT` have no plate design of their own, so they take a
 * deterministic one of the three off the same seed — a country road shows a stable mix rather than one
 * city's plates on every car.
 */
export function resolvePlate(placement: PlatePlacement, masks: PlateMasks, boxes: readonly CityBox[]): PlateResolution {
  const [x, y, z] = placement.position;
  const seed = placementSeed(placement.model, x, y, z);
  const city = plateCityOf(cityAt(x, y, boxes), seed);

  return { city, text: placement.plate ?? generatePlateText(maskFor(city, masks), seed) };
}

function maskFor(city: PlateCity, masks: PlateMasks): string {
  switch (city) {
    case 'LA':
      return masks.la;
    case 'SF':
      return masks.sf;
    case 'VEGAS':
      return masks.vegas;
  }
}

/**
 * A stable integer from the placement. The POSITION is quantised to centimetres before hashing: a car
 * generator's stored coordinates survive a round trip exactly, but a ground-snapped spawn can land a
 * float's-breadth away, and an unquantised hash would give it a different plate on every respawn.
 */
function placementSeed(model: string, x: number, y: number, z: number): number {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193);
  };
  for (let at = 0; at < model.length; at += 1) {
    mix(model.charCodeAt(at));
  }
  mix(Math.round(x * 100));
  mix(Math.round(y * 100));
  mix(Math.round(z * 100));

  return hash >>> 0;
}

function plateCityOf(city: City, seed: number): PlateCity {
  if (city === 'COUNTRYSIDE' || city === 'DESERT') {
    return OUT_OF_CITY[seed % OUT_OF_CITY.length];
  }

  return city;
}
