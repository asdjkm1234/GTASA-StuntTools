/**
 * Structural shapes instead of class imports: they keep the modules acyclic (Vector3 needs a quaternion,
 * Quaternion needs a matrix, a matrix needs vectors) and let callers pass plain objects or the engine's
 * own math types without converting.
 */

/** Column-major, 16 entries — the same layout three.js uses, so buffers transfer verbatim. */
export interface Matrix4Like {
  elements: ArrayLike<number>;
}

export interface QuaternionLike {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface Vector2Like {
  x: number;
  y: number;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface Vector4Like {
  w: number;
  x: number;
  y: number;
  z: number;
}
