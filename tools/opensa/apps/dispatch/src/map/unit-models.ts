/**
 * Units as CARS (201/5-04): the model half of the symbology, under the chevron the 2D overlay draws.
 *
 * The decision this implements was taken on 2026-08-06 and is not a look choice — *cars and peds are drawn*,
 * because a dispatch map over a streamed world that replaces its units with icons has thrown away the one
 * thing it has that a tile stack does not. The symbol stays on top of the car (201/5-02): it carries the
 * callsign, the status colour and the priority, and it is what an operator picks out at city zoom. The model
 * is what makes the same board legible at street zoom.
 *
 * **Units are KINEMATIC, and that is the decision 201/1-03 was waiting for.** A unit's position is a CLAIM
 * the feed makes (202's first seam), not a simulation this surface runs: there is no physics here, no ECS
 * and no player, so a car is a root matrix written from the fix and nothing else. Nothing on this surface
 * reads collision — which is what lets the map profile drop the baked collision from its pak.
 *
 * **What happens when a model is absent is the step's real content**, because it is the normal case rather
 * than the error case: a pak deployed without its game dir, a build converted without `--vehicles`, a total
 * conversion that never had a car called `copcarls`, a board that does not know what a unit is in. Each leaves
 * the unit exactly as 5/02 drew it — chevron, chip and beacon — says so ONCE in the log, and counts itself
 * into `?inventory=1`. A hole where a unit should be is the one outcome that is not allowed.
 */
import type { Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';

import type { Unit } from '../ops/types';
import type { ModelSource } from '../world/model-source';

import { UNIT_MODEL_TEXTURE_BYTES } from '../ops/budget';
import { gtaRootMatrix } from './coords';

/** What the model layer is holding, for the inventory report. */
export interface UnitModelStats {
  /** Units drawn as a model on the last update. */
  readonly drawn: number;
  /** Texture bytes the uploaded types are holding (the dominant per-type cost). */
  readonly textureBytes: number;
  /** Model types uploaded to the engine right now. */
  readonly types: number;
  /** Names this build carried no `.osm` for — every one of them is a unit drawn as a symbol alone. */
  readonly unresolved: number;
  /** Units on the board with no model drawn — absent, unresolved, or still loading. */
  readonly withoutModel: number;
}

/** One uploaded model TYPE. Instances share its geometry and its texture arrays. */
interface ModelType {
  /** Submeshes an instance must show; every other one is a damaged twin, a LOD or an unchosen extra. */
  readonly bodySubmeshes: readonly number[];
  readonly id: VehicleModelId;
  /** Live instances — a type with any is pinned, never trimmed. */
  instances: number;
  lastUsed: number;
  readonly submeshCount: number;
  readonly textureBytes: number;
}

export class UnitModels {
  private disposed = false;
  private readonly drawnUnits = new Set<string>();
  private readonly instances = new Map<string, { instance: VehicleInstance; name: string }>();
  private readonly loading = new Set<string>();
  private readonly root = new Float32Array(16);
  private readonly types = new Map<string, ModelType>();
  /** Names asked for that this build cannot draw — never asked for twice, and reported once each. */
  private readonly unresolved = new Set<string>();

  private withoutModelCount = 0;

  /**
   * @param source `null` when there is nothing to read models out of (the demo, or a pak served alone).
   * @param onLoaded called when a model arrives between frames — the render gate is a comparison of VALUES
   *   and a newly uploaded car changes none of them, so without this wake the first frame that shows the
   *   fleet is whatever frame the operator happens to cause next.
   */
  constructor(
    private readonly engine: Engine,
    private readonly source: ModelSource | null,
    private readonly onLoaded: () => void,
  ) {}

  dispose(): void {
    this.disposed = true;
    for (const { instance } of this.instances.values()) {
      this.engine.destroyVehicle(instance);
    }
    this.instances.clear();
    for (const type of this.types.values()) {
      this.engine.destroyVehicleModel(type.id);
    }
    this.types.clear();
  }

  stats(): UnitModelStats {
    let textureBytes = 0;
    for (const type of this.types.values()) {
      textureBytes += type.textureBytes;
    }

    return {
      drawn: this.drawnUnits.size,
      textureBytes,
      types: this.types.size,
      unresolved: this.unresolved.size,
      withoutModel: this.withoutModelCount,
    };
  }

  /** Place every unit that has a model, drop the ones that left the board, and upload what is missing. */
  update(units: readonly Unit[]): void {
    this.drawnUnits.clear();
    let withoutModel = 0;
    for (const unit of units) {
      const name = unit.model === null ? null : unit.model.toLowerCase();
      const type = name === null ? undefined : this.types.get(name);
      if (name === null || !type) {
        withoutModel += 1;
        this.release(unit.id);
        if (name !== null) {
          this.request(name);
        }
        continue;
      }
      const held = this.instances.get(unit.id);
      const instance = held?.name === name ? held.instance : this.claim(unit.id, name, type);
      gtaRootMatrix(this.root, unit.at, unit.elevation, unit.heading);
      instance.entity.setRoot(this.root);
      type.lastUsed = performance.now();
      this.drawnUnits.add(unit.id);
    }
    this.withoutModelCount = withoutModel;
    const onBoard = new Set(units.map((unit) => unit.id));
    for (const id of [...this.instances.keys()]) {
      if (!onBoard.has(id)) {
        this.release(id);
      }
    }
    this.trim();
    this.engine.updateVehicles();
  }

  /** Take an instance of `type` for `unit`, replacing whatever it was driving before. */
  private claim(unitId: string, name: string, type: ModelType): VehicleInstance {
    this.release(unitId);
    const instance = this.engine.createVehicle(type.id);
    // The `_dam` twins, the `_vlo` LOD and every unchosen extra ride in the same buffers as the body: a car
    // whose visibility is never set draws its own wreck through itself. The paint stays the engine default
    // until a feed reports carcols — a colour invented here would be a claim nobody made.
    for (let submesh = 0; submesh < type.submeshCount; submesh += 1) {
      instance.setSubmeshVisible(submesh, false);
    }
    for (const submesh of type.bodySubmeshes) {
      instance.setSubmeshVisible(submesh, true);
    }
    this.instances.set(unitId, { instance, name });
    type.instances += 1;

    return instance;
  }

  /** Give up `unit`'s car, if it has one. The TYPE stays uploaded — the next shift usually wants it back. */
  private release(unitId: string): void {
    const held = this.instances.get(unitId);
    if (!held) {
      return;
    }
    this.engine.destroyVehicle(held.instance);
    this.instances.delete(unitId);
    const type = this.types.get(held.name);
    if (type) {
      type.instances = Math.max(0, type.instances - 1);
    }
  }

  /** Say once, per name, that a unit is drawn as a symbol alone — and why. */
  private report(name: string, reason: string): void {
    this.unresolved.add(name);
    // eslint-disable-next-line no-console -- a unit drawn without its car must be visible, never silent
    console.warn(`[units] '${name}' is drawn as a symbol: ${reason}`);
  }

  /** Load one model type, once. A name that cannot be drawn is recorded rather than retried every frame. */
  private request(name: string): void {
    if (this.source === null || this.loading.has(name) || this.types.has(name) || this.unresolved.has(name)) {
      return;
    }
    this.loading.add(name);
    void this.source
      .read(name)
      .then((read) => {
        if (this.disposed) {
          return;
        }
        if (read === null) {
          this.report(name, 'this build carries no model of that name');

          return;
        }
        const bodySubmeshes: number[] = [];
        read.fixture.submeshes.forEach((submesh, index) => {
          if (submesh.kind === 'body' && !submesh.extra) {
            bodySubmeshes.push(index);
          }
        });
        this.types.set(name, {
          bodySubmeshes,
          id: this.engine.createVehicleModel(read.model),
          instances: 0,
          lastUsed: performance.now(),
          submeshCount: read.fixture.submeshes.length,
          textureBytes: read.model.textures.reduce(
            (total, texture) => total + (texture.kind === 'ostex' ? texture.bytes.byteLength : texture.rgba.byteLength),
            0,
          ),
        });
        this.onLoaded();
      })
      .catch((error: unknown) => {
        this.report(name, error instanceof Error ? error.message : String(error));
      })
      .finally(() => this.loading.delete(name));
  }

  /**
   * Trim idle types back to the declared texture allowance. A type with live instances is never trimmed —
   * the allowance is a floor to trim TO, not a cap on what the board may draw ([budget](../ops/budget.ts)).
   */
  private trim(): void {
    let total = 0;
    for (const type of this.types.values()) {
      total += type.textureBytes;
    }
    while (total > UNIT_MODEL_TEXTURE_BYTES) {
      let oldestName: null | string = null;
      let oldest: ModelType | null = null;
      for (const [name, type] of this.types) {
        if (type.instances === 0 && (oldest === null || type.lastUsed < oldest.lastUsed)) {
          oldest = type;
          oldestName = name;
        }
      }
      if (oldest === null || oldestName === null) {
        return; // every uploaded type is on the board — trimming one would take a unit off the map
      }
      this.engine.destroyVehicleModel(oldest.id);
      this.types.delete(oldestName);
      total -= oldest.textureBytes;
    }
  }
}
