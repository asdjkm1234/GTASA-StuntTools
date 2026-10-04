import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import type { MaterialReport, ProcessOptions, ProcessResult, VehicleAdapter, VehicleReport } from '../../core/types';

import { copyMaterialEffects } from './copy-effects';
import { scaleDff } from './scale';

/**
 * GTA-SA (RenderWare) vehicle adapter, operating on DFF **bytes** (the CLI reads/writes files). `inspect` is
 * implemented (read-only reuse of the DFF parser); `process` does the uniform scale (plan 002) and the
 * reflection-strength copy from a prototype (plan 003). Output stays standard RenderWare, so it runs in the
 * real game.
 */
export function createGtaSaVehicleAdapter(): VehicleAdapter {
  return {
    inspect(dff: Uint8Array, name: string): VehicleReport {
      const clump = parseDff(toArrayBuffer(dff));
      let vertices = 0;
      let triangles = 0;
      const materials: MaterialReport[] = [];
      for (const geometry of clump.geometries) {
        vertices += geometry.positions.length / 3;
        triangles += geometry.triangles.length;
        for (const material of geometry.materials) {
          materials.push({
            envMap: Boolean(material.effects?.envMap),
            reflection: Boolean(material.effects?.reflection),
            specular: Boolean(material.effects?.specular),
            texture: material.texture?.name.toLowerCase() ?? '',
          });
        }
      }

      return {
        dummies: clump.frames.map((frame) => frame.name).filter(Boolean),
        frames: clump.frames.length,
        geometries: clump.geometries.length,
        materials,
        model: name,
        triangles,
        vertices,
      };
    },
    process(dff: Uint8Array, options: ProcessOptions): ProcessResult {
      let bytes = dff;
      const notes: string[] = [];
      if (options.scale && options.scale !== 1) {
        bytes = scaleDff(bytes, options.scale);
        notes.push(`scale ×${options.scale} — geometry, dummy rig and collision`);
      }
      const forced =
        options.coefficient !== undefined || options.reflection !== undefined || options.specular !== undefined;
      if (options.prototype || forced) {
        const copied = copyMaterialEffects(bytes, options.prototype, {
          ...(options.coefficient === undefined ? {} : { coefficient: options.coefficient }),
          ...(options.reflection === undefined ? {} : { reflection: options.reflection }),
          ...(options.specular === undefined ? {} : { specular: options.specular }),
        });
        bytes = copied.bytes;
        const value = (label: string, number: null | number): string =>
          number === null ? `${label} —` : `${label} ${number.toFixed(3)}`;
        notes.push(
          `effects: ${copied.patched} of ${copied.materials} material(s) retuned ` +
            `(${copied.coefficients} env-map coefficient, ${copied.intensities} reflection intensity, ` +
            `${copied.speculars} specular level)` +
            (copied.fellBack ? ' — no env-map-marked material, so every reflective one was taken' : '') +
            `; ${copied.byTexture} matched the prototype by texture name, the rest took ` +
            `${options.prototype ? 'its median' : 'the value given'} ` +
            `[${value('coefficient', copied.reference.coefficient)}, ${value('intensity', copied.reference.intensity)}` +
            `, ${value('specular', copied.reference.specular)}]`,
        );
      }

      return { bytes, notes };
    },
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
