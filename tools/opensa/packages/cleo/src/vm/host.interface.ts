/**
 * `CleoHost` (plan 097/03 decision 1): everything the VM may ask of the world, as an injected
 * interface — the VM itself is engine-agnostic and fully testable against a mock. Facet shapes are
 * declared here from the corpus's demand (plan 04 decision 6 implements them over the real engine;
 * plan 05 adds the native-memory facet). Units are GTA-native throughout: metres, degrees, Z-up.
 */
import type { NativeArg, NativeValue } from './native-atlas';

export interface CleoHost {
  readonly memory: CleoMemoryFacet;
  readonly models: CleoModelFacet;
  readonly objects: CleoObjectFacet;
  /** An opcode no handler serves — called ONCE per id per runner (the plan 07 tier policy's seam). */
  onUnimplemented(opcode: number, thread: string): void;
  readonly player: CleoPlayerFacet;
  readonly text: CleoTextFacet;
  readonly vehicles: CleoVehicleFacet;
  readonly world: CleoWorldFacet;
}

/** The native memory/call facade (plan 097/05): tokens + the SA address atlas. `AtlasMemory`
 *  implements it over a `NativeWorld`; the VM's 0A8C/0A8D/0A97/0AEB/0AA5-0AA8 handlers route here. */
export interface CleoMemoryFacet {
  call(address: number, struct: null | number, args: readonly NativeArg[]): NativeValue;
  /** `0AEB` — token back to a script handle, or null. */
  handleOf(value: number): null | number;
  /** `0A97` — the token a script stores as a vehicle's "address". */
  pointerOf(car: number): number;
  read(address: number, size: number): NativeValue;
  write(address: number, size: number, value: { float: number; int: number }): boolean;
}

/** Model identity as scripts use it: numeric ids (IDE/`GET_MODEL_BY_NAME` results). */
export interface CleoModelFacet {
  /** `0E9C GET_MODEL_BY_NAME` — null when no model carries the name (the opcode's condition). */
  byName(name: string): null | number;
  /** `0EF8 GET_MODEL_INFO` — an opaque token plan 05's memory facet can read; 0 = unknown. */
  info(model: number): number;
  /** `0248 HAS_MODEL_LOADED` — true once registered (the SCM request/poll contract). */
  isAvailable(model: number): boolean;
  /** `0249 MARK_MODEL_AS_NO_LONGER_NEEDED`. */
  markUnneeded(model: number): void;
  /** `0247 REQUEST_MODEL` — must be idempotent; the script polls with `isAvailable`. */
  request(model: number): void;
}

/** Script objects: engine rigid instances behind opaque handles (plan 04 decision 4). */
export interface CleoObjectFacet {
  /** `0827 CONNECT_LODS` — pair the near/far script objects for the visibility swap. */
  connectLods(near: number, far: number): void;
  /** `0E01 CREATE_OBJECT_NO_SAVE` — allocate + place; returns the script handle. */
  create(model: number, x: number, y: number, z: number): number;
  delete(handle: number): void;
  /** `03CA DOES_OBJECT_EXIST`. */
  exists(handle: number): boolean;
  /** `01BB GET_OBJECT_COORDINATES`. */
  getCoordinates(handle: number): readonly [number, number, number];
  /** `0400 GET_OFFSET_FROM_OBJECT_IN_WORLD_COORDS`. */
  offsetInWorldCoords(handle: number, x: number, y: number, z: number): readonly [number, number, number];
  /** `01BC SET_OBJECT_COORDINATES`. */
  setCoordinates(handle: number, x: number, y: number, z: number): void;
  /** `0177 SET_OBJECT_HEADING` (degrees). */
  setHeading(handle: number, degrees: number): void;
  /** `0453 SET_OBJECT_ROTATION` (degrees about each GTA axis). */
  setRotation(handle: number, rx: number, ry: number, rz: number): void;
}

/** Player/char queries the corpus needs — the full ped-task surface is class C, deferred. */
export interface CleoPlayerFacet {
  /** `00A0 GET_CHAR_COORDINATES`. */
  charCoordinates(char: number): readonly [number, number, number];
  /** `056D DOES_CHAR_EXIST`. */
  exists(char: number): boolean;
  /** `0256 IS_PLAYER_PLAYING`. */
  isPlaying(player: number): boolean;
  /** `01F5 GET_PLAYER_CHAR` — the player's char handle. */
  playerChar(player: number): number;
}

/** On-screen text (plan 04 decision 6's text facet). */
export interface CleoTextFacet {
  /** `0ACD PRINT_STRING_NOW` (ms). */
  printNow(text: string, ms: number): void;
}

/** Vehicle queries (plan 04 decision 6; the part-animation natives are plan 05). */
export interface CleoVehicleFacet {
  /** `0AE2`/`0EA8` recursive car finds — null when the walk is exhausted (the condition). */
  anyCar(progress: number): null | { car: number; progress: number };
  carInSphere(x: number, y: number, z: number, radius: number, findNext: boolean, skipWrecked: boolean): null | number;
  /** `0441 GET_CAR_MODEL`. */
  carModel(car: number): number;
  /** `095F GET_DOOR_ANGLE_RATIO` — current openness 0..1 (door 2-5 = SA ids), null when unknown. */
  doorAngleRatio(car: number, door: number): null | number;
  /** `046C GET_DRIVER_OF_CAR` — char handle, or null (condition false). */
  driverOf(car: number): null | number;
  /** `0A01 IS_THIS_MODEL_A_CAR` — the model id names a car-class vehicle. */
  isCarModel(model: number): boolean;
  /** `00DB`/`00DF` seat checks. */
  isCharInAnyCar(char: number): boolean;
  isCharInCar(char: number, car: number): boolean;
  /** `03C0 STORE_CAR_CHAR_IS_IN_NO_SAVE`. */
  storeCarCharIsIn(char: number): number;
}

/** Camera / world-state queries + the draw surface. */
export interface CleoWorldFacet {
  /** `0EBE LOCATE_CAMERA_DISTANCE_TO_COORDINATES` — the condition: camera within `radius`. */
  cameraWithin(x: number, y: number, z: number, radius: number): boolean;
  /** `0E40 GET_CURRENT_HOUR` (game clock, 0-23). */
  currentHour(): number;
  /** `024F DRAW_CORONA` — fire-and-forget, this frame only. */
  drawCorona(
    x: number,
    y: number,
    z: number,
    size: number,
    coronaType: number,
    flareType: number,
    r: number,
    g: number,
    b: number,
  ): void;
  isGameVersionOriginal(): boolean;
  /** `0485 IS_PC_VERSION` / `0AA9 IS_GAME_VERSION_ORIGINAL` — the impersonation doctrine says both true. */
  isPcVersion(): boolean;
  /** `077E GET_AREA_VISIBLE` — the visible interior area id (0 = outside). */
  visibleArea(): number;
}
