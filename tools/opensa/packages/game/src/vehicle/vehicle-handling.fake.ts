/**
 * A full {@link VehicleHandling} row for tests (plan 081/02).
 *
 * The typed row is 24 fields, and a test that only cares about braking should not have to spell out the
 * suspension. The defaults are a mid-range sedan — bland on purpose, so a test that forgets to set the field
 * it is about fails on the assertion rather than on a surprising default.
 */
import type { VehicleHandling } from '../interfaces/world-adapter.interface';

export function fakeHandling(over: Partial<VehicleHandling> = {}): VehicleHandling {
  return {
    abs: false,
    axleFront: { reverse: false, type: 'independent' },
    axleRear: { reverse: false, type: 'independent' },
    brakeBias: 0.5,
    brakeDecel: 9,
    centreOfMass: [0, 0, 0],
    collisionDamageMult: 1,
    dragMult: 2,
    drive: 'R',
    engineAccel: 20,
    engineInertia: 20,
    engineType: 'P',
    gears: 5,
    mass: 1500,
    maxVelocity: 160,
    steeringLock: 30,
    suspAntiDive: 0,
    suspBias: 0.5,
    suspDamping: 0.1,
    suspForce: 0.9,
    suspHighSpeedDamp: 0,
    suspLower: -0.15,
    suspUpper: 0.3,
    tractionBias: 0.5,
    tractionLoss: 0.85,
    tractionMult: 0.75,
    turnMass: 3000,
    ...over,
  };
}
