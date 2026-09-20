/**
 * A recording `CleoHost` (the [[engine-fake-gpu-device]] philosophy: assert DECISIONS, not API
 * calls): every facet call appends one readable line to `calls`, and canned answers make the corpus
 * scripts take their happy path headless. Tests and `cleo-run` (plan 02) share this one mock —
 * the trace IS the story ("create 14645 at x,y,z · rotate …").
 *
 * The `memory` facet is the REAL `AtlasMemory` (plan 05) over a recording fake world — the token
 * and atlas logic under test is production code; only the world behind it is canned. Part indices
 * are auto-assigned per (car, name) so traces read `part misc_a#0`.
 */
import type { CleoHost } from './host.interface';
import type { TraceRing } from './trace';

import { AtlasMemory, type NativeWorld } from './native-atlas';

export interface RecordingHost extends CleoHost {
  readonly atlas: AtlasMemory;
  readonly calls: string[];
}

export interface RecordingHostOptions {
  /** Answer for camera-distance checks (default true — scripts near-gate their work on it). */
  readonly cameraWithin?: boolean;
  /** Live vehicles: script handle (slot*256+counter, counter bit7 clear) + model id. Drives the
   *  car finds, `carModel`, and the pool walk. */
  readonly cars?: readonly { readonly handle: number; readonly model: number }[];
  /** Door openness for `095F` (default 0.5 — vandoor copies it into the slide). */
  readonly doorAngleRatio?: number;
  /** Game hour (default 12). */
  readonly hour?: number;
  /** Model name → id for `GET_MODEL_BY_NAME` (default: every name resolves, ids assigned 20000+). */
  readonly knownModels?: ReadonlyMap<string, number>;
  /** The frame m_forward column every part reports (default (0,1,0) — an UNROTATED frame, i.e. a
   *  parked vehicle). Rhino's tread reads its reference wheel's roll out of this column. */
  readonly partForward?: readonly [number, number, number];
  /** Frame names each car's model carries (default: every asked name exists). */
  readonly partNames?: readonly string[];
  /** The car the player currently sits in (a `cars` handle). */
  readonly playerInCar?: number;
  /** Plan 07 tracer: atlas ops emit their symbolised lines into this ring as host effects. */
  readonly trace?: TraceRing;
  /** CWeather::Wind (default 0.4). */
  readonly wind?: number;
}

export function createRecordingHost(options: RecordingHostOptions = {}): RecordingHost {
  const calls: string[] = [];
  const record = (line: string): void => {
    calls.push(line);
  };
  const namedModels = new Map(options.knownModels ?? []);
  let nextNamedModel = 20000;
  let nextObject = 1;
  let sphereWalk = 0;
  const objects = new Set<number>();
  const fixed = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(3));

  // --- The plan 05 native world: parts auto-assigned per (car, name), everything recorded. ---
  const partsByCar = new Map<number, Map<string, number>>();
  const partName = (car: number, part: number): string => {
    for (const [name, index] of partsByCar.get(car) ?? []) {
      if (index === part) {
        return `${name}#${part}`;
      }
    }

    return `#${part}`;
  };
  // CDamageManager's light status, per car — a real state, not a canned answer: a script that smashes a
  // lamp and reads it back must see its own write, and a story test must be able to assert on it.
  const lightsByCar = new Map<number, number[]>();
  const lightsOf = (car: number): number[] => {
    const lights = lightsByCar.get(car) ?? [0, 0, 0, 0];
    lightsByCar.set(car, lights);

    return lights;
  };
  const world: NativeWorld = {
    doorAngleRatio: (): null | number => options.doorAngleRatio ?? 0.5,
    lightStatus: (car, light): number => lightsOf(car)[light] ?? 0,
    lodDistMultiplier: (): number => 1,
    nextSiblingPart: (car, part): null | number => {
      // The fake frame tree is a flat chain: sibling = the next auto-assigned part, 3 links deep.
      return part < 2 ? part + 1 : null;
    },
    partForward: (): readonly [number, number, number] => options.partForward ?? [0, 1, 0],
    partIndex: (car, name): null | number => {
      if (options.partNames && !options.partNames.includes(name)) {
        record(`natives.partIndex car#${car} ${name} -> missing`);

        return null;
      }
      const parts = partsByCar.get(car) ?? new Map<string, number>();
      partsByCar.set(car, parts);
      if (!parts.has(name)) {
        parts.set(name, parts.size);
      }

      return parts.get(name) ?? null;
    },
    partTranslation: (): readonly [number, number, number] => [0, 0, 0],
    setLightStatus: (car, light, status): void => {
      const lights = lightsOf(car);
      if (light >= 0 && light < lights.length) {
        lights[light] = status;
      }
      record(`natives.setLightStatus car#${car} light ${light} -> ${status === 0 ? 'OK' : 'SMASHED'}`);
    },
    setPartRotation: (car, part, quat): void => {
      record(`natives.setPartRotation car#${car} ${partName(car, part)} quat(${quat.map(fixed).join(',')})`);
    },
    setPartTranslationComponent: (car, part, axis, value): void => {
      record(`natives.setPartTranslation car#${car} ${partName(car, part)} ${'xyz'[axis]}=${fixed(value)}`);
    },
    vehicleHandles: (): readonly number[] => (options.cars ?? []).map((car) => car.handle),
    wind: (): number => options.wind ?? 0.4,
  };
  const ring = options.trace;
  const atlas = new AtlasMemory(world, ring ? (line): void => ring.hostEffect(line) : undefined);

  return {
    atlas,
    calls,
    memory: atlas,
    models: {
      byName(name): null | number {
        if (!namedModels.has(name)) {
          if (options.knownModels) {
            record(`models.byName ${name} -> miss`);

            return null;
          }
          namedModels.set(name, nextNamedModel);
          nextNamedModel += 1;
        }
        const model = namedModels.get(name) ?? null;
        record(`models.byName ${name} -> ${model}`);

        return model;
      },
      info(model): number {
        record(`models.info ${model}`);

        return 0x1000 + model;
      },
      isAvailable(model): boolean {
        record(`models.isAvailable ${model} -> true`);

        return true;
      },
      markUnneeded(model): void {
        record(`models.markUnneeded ${model}`);
      },
      request(model): void {
        record(`models.request ${model}`);
      },
    },
    objects: {
      connectLods(near, far): void {
        record(`objects.connectLods ${near} ${far}`);
      },
      create(model, x, y, z): number {
        const handle = nextObject;
        nextObject += 1;
        objects.add(handle);
        record(`objects.create ${model} at ${fixed(x)},${fixed(y)},${fixed(z)} -> #${handle}`);

        return handle;
      },
      delete(handle): void {
        objects.delete(handle);
        record(`objects.delete #${handle}`);
      },
      exists(handle): boolean {
        return objects.has(handle);
      },
      getCoordinates(): readonly [number, number, number] {
        return [0, 0, 0];
      },
      offsetInWorldCoords(handle, x, y, z): readonly [number, number, number] {
        return [x, y, z];
      },
      setCoordinates(handle, x, y, z): void {
        record(`objects.setCoordinates #${handle} ${fixed(x)},${fixed(y)},${fixed(z)}`);
      },
      setHeading(handle, degrees): void {
        record(`objects.setHeading #${handle} ${fixed(degrees)}`);
      },
      setRotation(handle, rx, ry, rz): void {
        record(`objects.setRotation #${handle} ${fixed(rx)},${fixed(ry)},${fixed(rz)}`);
      },
    },
    onUnimplemented(opcode, thread): void {
      record(`onUnimplemented ${opcode.toString(16).toUpperCase().padStart(4, '0')} (${thread})`);
    },
    player: {
      charCoordinates(): readonly [number, number, number] {
        return [0, 0, 0];
      },
      exists(): boolean {
        return true;
      },
      isPlaying(): boolean {
        return true;
      },
      playerChar(): number {
        return 1;
      },
    },
    text: {
      printNow(text, ms): void {
        record(`text.printNow '${text}' ${ms}`);
      },
    },
    vehicles: {
      anyCar(progress): null | { car: number; progress: number } {
        const car = (options.cars ?? [])[progress];

        return car ? { car: car.handle, progress: progress + 1 } : null;
      },
      carInSphere(x, y, z, radius, findNext): null | number {
        // REAL walk semantics (the intake postmortem's recorded defect, fixed 2026-08-06):
        // findNext=false restarts, findNext=true continues, and the walk EXHAUSTS to null — a
        // mock that always answers car[0] hid a full budget burn behind a happy story.
        sphereWalk = findNext ? sphereWalk + 1 : 0;
        const car = (options.cars ?? [])[sphereWalk];
        record(`vehicles.carInSphere findNext=${findNext} -> ${car ? `#${car.handle}` : 'exhausted'}`);

        return car?.handle ?? null;
      },
      carModel(car): number {
        return (options.cars ?? []).find((entry) => entry.handle === car)?.model ?? 0;
      },
      doorAngleRatio(car, door): null | number {
        const ratio = options.doorAngleRatio ?? 0.5;
        record(`vehicles.doorAngleRatio car#${car} door ${door} -> ${ratio}`);

        return ratio;
      },
      driverOf(): null {
        return null;
      },
      isCarModel(): boolean {
        return true;
      },
      isCharInAnyCar(): boolean {
        return options.playerInCar !== undefined;
      },
      isCharInCar(char, car): boolean {
        return options.playerInCar === car;
      },
      storeCarCharIsIn(): number {
        return options.playerInCar ?? -1;
      },
    },
    world: {
      cameraWithin(): boolean {
        return options.cameraWithin ?? true;
      },
      currentHour(): number {
        return options.hour ?? 12;
      },
      drawCorona(): void {
        // visual-only; the trace does not need every frame's corona
      },
      isGameVersionOriginal(): boolean {
        return true;
      },
      isPcVersion(): boolean {
        return true;
      },
      visibleArea(): number {
        return 0;
      },
    },
  };
}
