/**
 * The scripted vehicle-animation clip names, in ONE place. Shared by the system that REQUESTS them by name
 * (`enter-vehicle.system`) and the player that RESOLVES them from `ped.ifp` (`apps/web` engine-player). A
 * single source so a rename can't silently desync the two — a mismatch makes the driver ride STANDING with
 * his legs out of the car (the exact failure the player's resolution guards against).
 */
export const CAR_GETIN = 'car_getin_lhs';
export const CAR_GETOUT = 'car_getout_lhs';
export const CAR_SIT = 'car_sit';
/** Passenger-side climb-in + the slide across to the driver seat (plan 088/09b). */
export const CAR_GETIN_RHS = 'car_getin_rhs';
export const CAR_SHUFFLE = 'car_shuffle_rhs';
/** Passenger-side climb-out + the overturned/windscreen crawl-out (plan 088/09d). */
export const CAR_GETOUT_RHS = 'car_getout_rhs';
export const CAR_CRAWLOUT = 'car_crawloutrhs';

/** Every scripted clip, in the order the player registers them. */
export const VEHICLE_SCRIPTED_CLIPS = [
  CAR_GETIN,
  CAR_GETOUT,
  CAR_SIT,
  CAR_GETIN_RHS,
  CAR_SHUFFLE,
  CAR_GETOUT_RHS,
  CAR_CRAWLOUT,
] as const;
