/**
 * bitECS components for dynamic entities.
 *
 * bitECS 0.4 stores no data itself — a component is a plain Structure-of-Arrays
 * object indexed by entity id; membership is tracked by `addComponent`/`query`.
 * Values are GTA Z-up (physics + ECS run in Z-up; the −90°X is display-only).
 */

/** Tag: the entity the local player controls. */
export const PlayerControlled = {};

/** Link to a Rapier rigid body (+ its collider, for the kinematic character controller). */
export const RigidBody = {
  collider: [] as number[],
  handle: [] as number[],
};

/** Locomotion state the controller owns and the renderer reads (plan 088): rate-limited heading (yaw, rad),
 *  the jump/fall FSM state (`LOCOMOTION_*` in character/locomotion.ts) + seconds in it, and the vertical
 *  impact speed of the last touchdown (units/s — picks the land tier; 080's camera shake will want it too). */
export const Locomotion = {
  fallSpeed: [] as number[],
  heading: [] as number[],
  state: [] as number[],
  stateTime: [] as number[],
};

/** Player velocity (Z-up, units/s) + grounded flag — owned by the character controller. */
export const Velocity = {
  grounded: [] as number[],
  x: [] as number[],
  y: [] as number[],
  z: [] as number[],
};

/** World position (x,y,z) + orientation quaternion (qx,qy,qz,qw). */
export const Transform = {
  qw: [] as number[],
  qx: [] as number[],
  qy: [] as number[],
  qz: [] as number[],
  x: [] as number[],
  y: [] as number[],
  z: [] as number[],
};
