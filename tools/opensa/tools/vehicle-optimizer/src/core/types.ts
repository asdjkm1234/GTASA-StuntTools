/**
 * Game-agnostic types for the vehicle optimizer. A standalone modding tool (output is valid SA DFF/COL, usable
 * in the real game) with two operations: **uniform scale** (geometry + the dummy rig + collision) and
 * **material-effect copy** (reflection / specular / env-map only) from a reference model. Game specifics live
 * behind {@link VehicleAdapter}.
 */

/** One material's reflective-effect presence (the only material data the copy touches). */
export interface MaterialReport {
  envMap: boolean;
  reflection: boolean;
  specular: boolean;
  texture: string;
}

/** What to do to one vehicle DFF. All of them may be combined in a single run. */
export interface ProcessOptions {
  /** Env-map coefficient to set outright — the mirror-the-world strength. Overrides the prototype's value. */
  coefficient?: number;
  /** Reference vehicle DFF bytes to copy reflection/specular/env-map effects from (plan 003). */
  prototype?: Uint8Array;
  /** SA reflection intensity to set outright. Overrides the prototype's value. */
  reflection?: number;
  /** Uniform scale factor for geometry + frame rig + collision (plan 002); 1 / undefined = no scale. */
  scale?: number;
  /** SA specular level to set outright — the HIGHLIGHT, a different term from the reflection. */
  specular?: number;
}

/** What a run produced: the finished bytes plus the lines the CLI prints — a run that changed almost nothing
 *  used to look exactly like one that worked. */
export interface ProcessResult {
  bytes: Uint8Array;
  notes: readonly string[];
}

/** Per-game contract operating on DFF bytes (the CLI handles file I/O). */
export interface VehicleAdapter {
  /** Parse + report a vehicle DFF's structure (read-only). `name` labels the report. */
  inspect(dff: Uint8Array, name: string): VehicleReport;
  /** Scale and/or copy effects → the finished DFF bytes + what each operation actually did (plans 002/003). */
  process(dff: Uint8Array, options: ProcessOptions): ProcessResult;
}

/** Structure report — the parts/dummies scaling touches + the materials the effect-copy uses. */
export interface VehicleReport {
  /** Named frames (the rig: wheel/door/seat/light dummies, chassis_vlo, …). */
  dummies: string[];
  frames: number;
  geometries: number;
  materials: MaterialReport[];
  model: string;
  triangles: number;
  vertices: number;
}
