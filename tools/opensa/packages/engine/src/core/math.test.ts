import { describe, expect, it } from 'vitest';

import type { Mat4, Vec3 } from './math';

import {
  frustumFromViewProj,
  frustumIntersectsSphere,
  mat4Identity,
  mat4Invert,
  mat4LookAt,
  mat4Multiply,
  mat4OrthographicZO,
  mat4PerspectiveZO,
  sphereFullyBeyond,
} from './math';

/**
 * Defends the camera/culling core: a wrong matrix here does not crash, it quietly puts the whole world in
 * the wrong place (skewed projection, mirrored view, geometry culled while on screen). Every case pins a
 * guarantee a renderer depends on — column-major layout, 0..1 clip depth, normalized frustum planes, and
 * inverse/multiply round-trips.
 */

function expectMatrixClose(actual: Mat4, expected: Mat4, precision = 4): void {
  for (let index = 0; index < 16; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index], precision);
  }
}

/** The same view, projected orthographically — `halfHeight` world units tall (201/7-01's plan view). */
function orthoViewProj(
  eye: [number, number, number],
  target: [number, number, number],
  halfHeight: number,
): Float32Array {
  const proj = mat4Identity();
  const view = mat4Identity();
  const out = mat4Identity();
  mat4OrthographicZO(proj, halfHeight, 16 / 9, 0.1, 1000);
  mat4LookAt(view, eye, target, [0, 1, 0]);

  return mat4Multiply(out, proj, view);
}

/** Apply a column-major mat4 to a point, returning the perspective-divided result plus clip w. */
function transformPoint(m: Mat4, p: Vec3): { w: number; xyz: [number, number, number] } {
  const out: number[] = [];
  for (let row = 0; row < 4; row += 1) {
    out.push(m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row]);
  }
  const w = out[3];

  return { w, xyz: [out[0] / w, out[1] / w, out[2] / w] };
}

/** Column-major mat4 from a translation — a convenient non-identity, invertible matrix. */
function translation(tx: number, ty: number, tz: number): Mat4 {
  const m = mat4Identity();
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;

  return m;
}

function viewProj(eye: [number, number, number], target: [number, number, number]): Float32Array {
  const proj = mat4Identity();
  const view = mat4Identity();
  const out = mat4Identity();
  mat4PerspectiveZO(proj, Math.PI / 3, 16 / 9, 0.1, 1000);
  mat4LookAt(view, eye, target, [0, 1, 0]);

  return mat4Multiply(out, proj, view);
}

describe('engine math', () => {
  describe('negative cases', () => {
    it('culls a sphere far behind the camera', () => {
      const planes = new Float32Array(24);
      frustumFromViewProj(planes, viewProj([0, 0, 10], [0, 0, 0]));

      expect(frustumIntersectsSphere(planes, 0, 0, 100, 5)).toBe(false);
    });

    it('culls a sphere far off to the side', () => {
      const planes = new Float32Array(24);
      frustumFromViewProj(planes, viewProj([0, 0, 10], [0, 0, 0]));

      expect(frustumIntersectsSphere(planes, 500, 0, 0, 5)).toBe(false);
    });

    it('does not report a sphere beyond when any part of it is inside the distance', () => {
      // Centre at 1150 with radius 100 → closest point 1050 < 1100: still (partly) visible.
      expect(sphereFullyBeyond([0, 0, 0], 1150, 0, 0, 100, 1100)).toBe(false);
      // The eye is inside the sphere.
      expect(sphereFullyBeyond([0, 0, 0], 10, 0, 0, 50, 1100)).toBe(false);
    });

    it('falls back to identity instead of NaNs when inverting a singular matrix', () => {
      const singular = mat4Identity();
      singular[0] = 0; // collapses the X axis → determinant 0
      const out = new Float32Array(16) as Mat4;

      expect(mat4Invert(out, singular)).toBe(out);
      expectMatrixClose(out, mat4Identity());
    });

    it('produces a finite view matrix when the eye sits on its own target', () => {
      const view = mat4Identity();
      mat4LookAt(view, [5, 5, 5], [5, 5, 5], [0, 1, 0]);

      expect(Array.from(view).every((value) => Number.isFinite(value))).toBe(true);
    });

    it('produces a finite view matrix when up is parallel to the view direction', () => {
      const view = mat4Identity();
      mat4LookAt(view, [0, 10, 0], [0, 0, 0], [0, 1, 0]);

      expect(Array.from(view).every((value) => Number.isFinite(value))).toBe(true);
    });

    it('culls a sphere outside an orthographic box that a perspective frustum at the same pose would hold', () => {
      const ortho = new Float32Array(24);
      const perspective = new Float32Array(24);
      frustumFromViewProj(ortho, orthoViewProj([0, 0, 10], [0, 0, 0], 5));
      frustumFromViewProj(perspective, viewProj([0, 0, 10], [0, 0, 0]));

      // 60 units off the axis and 500 deep: inside a widening frustum, outside a box 5 units tall. Reading
      // an orthographic view through perspective planes is how a plan view draws cells nobody can see.
      expect(frustumIntersectsSphere(perspective, 60, 0, -500, 1)).toBe(true);
      expect(frustumIntersectsSphere(ortho, 60, 0, -500, 1)).toBe(false);
    });

    it('culls a sphere entirely behind the near plane', () => {
      const planes = new Float32Array(24);
      frustumFromViewProj(planes, viewProj([0, 0, 10], [0, 0, 0]));

      expect(frustumIntersectsSphere(planes, 0, 0, 10.5, 0.1)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('projects a point in front of the camera inside clip space with 0..1 depth', () => {
      const m = viewProj([0, 0, 10], [0, 0, 0]);
      // Transform the origin (world) — camera at z=10 looking at origin → view depth 10.
      const clipW = m[3] * 0 + m[7] * 0 + m[11] * 0 + m[15];
      const clipZ = m[2] * 0 + m[6] * 0 + m[10] * 0 + m[14];
      const ndcZ = clipZ / clipW;

      expect(clipW).toBeGreaterThan(0);
      expect(ndcZ).toBeGreaterThan(0);
      expect(ndcZ).toBeLessThan(1);
    });

    it('maps an orthographic near plane to depth 0 and its far plane to depth 1', () => {
      const m = mat4OrthographicZO(mat4Identity(), 5, 16 / 9, 0.1, 1000);
      const near = transformPoint(m, [0, 0, -0.1]);
      const far = transformPoint(m, [0, 0, -1000]);

      expect(near.xyz[2]).toBeCloseTo(0, 5);
      expect(far.xyz[2]).toBeCloseTo(1, 5);
      // Reversed-Z is the same call with the planes swapped, exactly as the renderer does for perspective.
      const reversed = mat4OrthographicZO(mat4Identity(), 5, 16 / 9, 1000, 0.1);
      expect(transformPoint(reversed, [0, 0, -0.1]).xyz[2]).toBeCloseTo(1, 5);
      expect(transformPoint(reversed, [0, 0, -1000]).xyz[2]).toBeCloseTo(0, 5);
    });

    it('draws a distant point the same size as a near one, which is what a plan view is', () => {
      const m = mat4OrthographicZO(mat4Identity(), 5, 16 / 9, 0.1, 1000);
      const near = transformPoint(m, [2.5, 0, -10]);
      const far = transformPoint(m, [2.5, 0, -900]);

      expect(near.w).toBe(1);
      expect(far.xyz[0]).toBeCloseTo(near.xyz[0], 6);
      // Half the box height across, at any depth: the edge of the picture is a world distance, not an angle.
      expect(transformPoint(m, [0, 5, -10]).xyz[1]).toBeCloseTo(1, 6);
    });

    it('accepts a front plane behind the eye, so nothing above a plan camera is sliced off', () => {
      const planes = new Float32Array(24);
      const proj = mat4OrthographicZO(mat4Identity(), 200, 1, -500, 1000);
      const view = mat4LookAt(mat4Identity(), [0, 300, 0], [0, 0, 0], [0, 0, -1]);
      frustumFromViewProj(planes, mat4Multiply(mat4Identity(), proj, view));

      // A tower whose top stands 100 units ABOVE the camera still passes the box.
      expect(frustumIntersectsSphere(planes, 0, 400, 0, 1)).toBe(true);
    });

    it('extracts parallel side planes from an orthographic view, which is what makes the culling correct', () => {
      const planes = new Float32Array(24);
      frustumFromViewProj(planes, orthoViewProj([0, 0, 10], [0, 0, 0], 5));
      const left = [planes[0], planes[1], planes[2]];
      const right = [planes[4], planes[5], planes[6]];

      // Opposed, not converging: the two walls of a box rather than the sides of a wedge.
      expect(left[0]).toBeCloseTo(-right[0], 5);
      expect(left[1]).toBeCloseTo(-right[1], 5);
      expect(left[2]).toBeCloseTo(-right[2], 5);
      // And what is inside stays inside all the way down the box.
      expect(frustumIntersectsSphere(planes, 4, 0, 0, 0)).toBe(true);
      expect(frustumIntersectsSphere(planes, 4, 0, -900, 0)).toBe(true);
    });

    it('keeps a visible sphere and one straddling the frustum edge', () => {
      const planes = new Float32Array(24);
      frustumFromViewProj(planes, viewProj([0, 0, 10], [0, 0, 0]));

      expect(frustumIntersectsSphere(planes, 0, 0, 0, 1)).toBe(true);
      // Far to the side but with a huge radius → still intersects.
      expect(frustumIntersectsSphere(planes, 500, 0, 0, 600)).toBe(true);
    });

    it('reports a sphere fully beyond the fog cut (closest point at/past the distance)', () => {
      // Closest point exactly AT the cut: the shader's hard cut is 1 there — cullable.
      expect(sphereFullyBeyond([0, 0, 0], 1200, 0, 0, 100, 1100)).toBe(true);
      // 3D distance counts: a high cell over the horizon is farther than its ground distance.
      expect(sphereFullyBeyond([0, 200, 0], 1150, 0, 0, 50, 1100)).toBe(true);
    });

    it('builds an identity that leaves points untouched', () => {
      const identity = mat4Identity();

      expect(identity).toHaveLength(16);
      expect(transformPoint(identity, [3, -4, 5]).xyz).toEqual([3, -4, 5]);
      expect(transformPoint(identity, [3, -4, 5]).w).toBe(1);
    });

    it('inverts a view matrix back to itself through a round trip', () => {
      const view = mat4Identity();
      mat4LookAt(view, [12, 34, -56], [1, 2, 3], [0, 1, 0]);
      const inverse = mat4Identity();
      const roundTrip = mat4Identity();
      mat4Invert(inverse, view);
      mat4Invert(roundTrip, inverse);

      expectMatrixClose(roundTrip, view, 3);
    });

    it('multiplies a matrix by its inverse to identity', () => {
      const m = mat4Identity();
      mat4LookAt(m, [7, -3, 2], [0, 0, 0], [0, 0, 1]);
      const inverse = mat4Identity();
      const product = mat4Identity();
      mat4Invert(inverse, m);
      mat4Multiply(product, m, inverse);

      expectMatrixClose(product, mat4Identity(), 4);
    });

    it('inverts a camera view so it maps the origin back onto the eye', () => {
      const eye: Vec3 = [10, 20, 30];
      const view = mat4Identity();
      mat4LookAt(view, eye, [0, 0, 0], [0, 1, 0]);
      const inverse = mat4Identity();
      mat4Invert(inverse, view);

      const back = transformPoint(inverse, [0, 0, 0]).xyz;
      expect(back[0]).toBeCloseTo(eye[0], 3);
      expect(back[1]).toBeCloseTo(eye[1], 3);
      expect(back[2]).toBeCloseTo(eye[2], 3);
    });

    it('applies the right-hand operand first when multiplying', () => {
      const scaleX2 = mat4Identity();
      scaleX2[0] = 2;
      const shift = translation(5, 0, 0);
      const out = mat4Identity();
      mat4Multiply(out, shift, scaleX2);

      // shift × scale on (1,0,0) → scale first (2,0,0) then shift → (7,0,0); the other order gives 12.
      expect(transformPoint(out, [1, 0, 0]).xyz[0]).toBeCloseTo(7, 5);
    });

    it('leaves a matrix unchanged when multiplied by identity from either side', () => {
      const m = translation(1, 2, 3);
      const left = mat4Identity();
      const right = mat4Identity();
      mat4Multiply(left, mat4Identity(), m);
      mat4Multiply(right, m, mat4Identity());

      expectMatrixClose(left, m, 6);
      expectMatrixClose(right, m, 6);
    });

    it('maps the near plane to depth 0 and the far plane to depth 1', () => {
      const near = 0.1;
      const far = 1000;
      const proj = mat4Identity();
      mat4PerspectiveZO(proj, Math.PI / 3, 16 / 9, near, far);

      expect(transformPoint(proj, [0, 0, -near]).xyz[2]).toBeCloseTo(0, 4);
      expect(transformPoint(proj, [0, 0, -far]).xyz[2]).toBeCloseTo(1, 3);
    });

    it('narrows the horizontal field of view as the aspect ratio widens', () => {
      const wide = mat4Identity();
      const square = mat4Identity();
      mat4PerspectiveZO(wide, Math.PI / 3, 16 / 9, 0.1, 1000);
      mat4PerspectiveZO(square, Math.PI / 3, 1, 0.1, 1000);

      // Same world point projects closer to the centre in X on the wider viewport; Y is unaffected.
      expect(Math.abs(transformPoint(wide, [1, 1, -10]).xyz[0])).toBeLessThan(
        Math.abs(transformPoint(square, [1, 1, -10]).xyz[0]),
      );
      expect(transformPoint(wide, [1, 1, -10]).xyz[1]).toBeCloseTo(transformPoint(square, [1, 1, -10]).xyz[1], 5);
    });

    it('projects a point at the vertical fov edge onto the top of the viewport', () => {
      const fovY = Math.PI / 3;
      const proj = mat4Identity();
      mat4PerspectiveZO(proj, fovY, 1, 0.1, 1000);
      const depth = 10;
      const edgeY = Math.tan(fovY / 2) * depth;

      expect(transformPoint(proj, [0, edgeY, -depth]).xyz[1]).toBeCloseTo(1, 4);
    });

    it('flips handedness so the projection carries a negative w for points behind the camera', () => {
      const proj = mat4Identity();
      mat4PerspectiveZO(proj, Math.PI / 3, 1, 0.1, 1000);

      expect(transformPoint(proj, [0, 0, -10]).w).toBeCloseTo(10, 5);
      expect(transformPoint(proj, [0, 0, 10]).w).toBeCloseTo(-10, 5);
    });

    it('builds a view that puts the eye at the origin looking down negative Z', () => {
      const view = mat4Identity();
      mat4LookAt(view, [0, 0, 10], [0, 0, 0], [0, 1, 0]);

      const atEye = transformPoint(view, [0, 0, 10]).xyz;
      expect(atEye[0]).toBeCloseTo(0, 5);
      expect(atEye[1]).toBeCloseTo(0, 5);
      expect(atEye[2]).toBeCloseTo(0, 5);
      // The target sits straight ahead at the eye-target distance.
      expect(transformPoint(view, [0, 0, 0]).xyz[2]).toBeCloseTo(-10, 5);
      // World +X stays screen-right and world +Y stays screen-up for this camera.
      expect(transformPoint(view, [1, 2, 0]).xyz[0]).toBeCloseTo(1, 5);
      expect(transformPoint(view, [1, 2, 0]).xyz[1]).toBeCloseTo(2, 5);
    });

    it('keeps the view basis orthonormal for an arbitrary camera', () => {
      const view = mat4Identity();
      mat4LookAt(view, [13, -7, 21], [2, 3, -4], [0, 1, 0]);
      const rows = [
        [view[0], view[4], view[8]],
        [view[1], view[5], view[9]],
        [view[2], view[6], view[10]],
      ];
      const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

      for (const row of rows) {
        expect(Math.hypot(row[0], row[1], row[2])).toBeCloseTo(1, 5);
      }
      expect(dot(rows[0], rows[1])).toBeCloseTo(0, 5);
      expect(dot(rows[0], rows[2])).toBeCloseTo(0, 5);
      expect(dot(rows[1], rows[2])).toBeCloseTo(0, 5);
    });

    it('returns normalized frustum planes so plane distance is metric', () => {
      const planes = new Float32Array(24);
      const out = frustumFromViewProj(planes, viewProj([0, 0, 10], [0, 0, 0]));

      expect(out).toBe(planes);
      for (let plane = 0; plane < 6; plane += 1) {
        expect(Math.hypot(planes[plane * 4], planes[plane * 4 + 1], planes[plane * 4 + 2])).toBeCloseTo(1, 5);
      }
    });

    it('keeps a zero-radius point on the view axis inside the frustum', () => {
      const planes = new Float32Array(24);
      frustumFromViewProj(planes, viewProj([0, 0, 10], [0, 0, 0]));

      expect(frustumIntersectsSphere(planes, 0, 0, 0, 0)).toBe(true);
      expect(frustumIntersectsSphere(planes, 0, 0, -900, 0)).toBe(true);
    });

    it('culls beyond the far plane but keeps geometry just inside it', () => {
      const planes = new Float32Array(24);
      frustumFromViewProj(planes, viewProj([0, 0, 10], [0, 0, 0]));

      expect(frustumIntersectsSphere(planes, 0, 0, -1100, 1)).toBe(false);
      expect(frustumIntersectsSphere(planes, 0, 0, -980, 1)).toBe(true);
    });

    it('treats the fog cut as a 3D reach so a zero-radius point cuts exactly at the distance', () => {
      expect(sphereFullyBeyond([0, 0, 0], 1100, 0, 0, 0, 1100)).toBe(true);
      expect(sphereFullyBeyond([0, 0, 0], 1099.9, 0, 0, 0, 1100)).toBe(false);
      // Eye position is honoured, not assumed to be the origin.
      expect(sphereFullyBeyond([1000, 0, 0], 1100, 0, 0, 0, 1100)).toBe(false);
    });
  });
});
