/**
 * The F2 Physics tab (plan 081/01): what the driven car is actually doing, while it does it.
 *
 * The chain's founding rule is that nothing gets tuned blind, and this is where that starts — the same
 * {@link TelemetryFrame} a scripted capture records, printed live. The two complaints 081 exists for are read
 * straight off it: the pitch row under braking (positive = the nose LIFTS) and the roll row through a corner.
 *
 * The sampler runs only while this panel is open — mounting turns the capture on, leaving turns it off, so a
 * closed debugger costs the physics step nothing.
 */
import type { TelemetryFrame } from '@opensa/game/vehicle/vehicle-telemetry';

import { type ReactElement, useEffect, useState } from 'react';

import { styles } from './debug-styles';

/** The slice of DebugActions this panel reads (kept narrow so the panel is reusable/testable). */
export interface PhysicsPanelActions {
  /** The shared vehicle tuning as `[label, value]` rows — read-only until plans 02-06 make it per-car. */
  physicsConstants?: () => readonly (readonly [string, number])[];
  /** The driven car's latest frame; null on foot or before the capture produced a step. */
  physicsReadout?: () => null | PhysicsReadout;
  /** Run the telemetry sampler (this panel owns the switch, like the Perf panel owns perf sampling). */
  setPhysicsCapture?: (enabled: boolean) => void;
}

/** The live physics readout: one frame plus what a reader needs to make sense of its wheel order. */
export interface PhysicsReadout {
  /** Corner name per wheel index (`FL`, `RR`, …) — see `wheelCornerLabels`. */
  readonly corners: readonly string[];
  readonly frame: TelemetryFrame;
  /** What an SA surface id MEANS (plan 081/10): its name and the share of tarmac grip it gives. Null for an
   *  unknown id, and absent entirely for a world with no surface table. */
  readonly surfaceOf?: (id: number) => null | { factor: number; name: string };
}

/** 10 Hz: fast enough to watch a dip build, slow enough not to flood React. */
const POLL_MS = 100;
const RAD_TO_DEG = 180 / Math.PI;
const MS_TO_KMH = 3.6;
/** Cells in a meter bar — 10 reads as percent without arithmetic. */
const BAR_CELLS = 10;

/**
 * A monospace meter: `████░░░░░░` for 0.4. Text rather than a sized div because the panel is already Courier
 * — the bar lines up with the numbers beside it for free, and there is no style to keep in sync.
 */
export function bar(fraction: number, cells: number = BAR_CELLS): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * cells);

  return '█'.repeat(filled) + '░'.repeat(cells - filled);
}

/** The body channels as the tab prints them. Pure, so the units are unit-tested rather than eyeballed. */
export function bodyRows(frame: TelemetryFrame): readonly (readonly [string, string])[] {
  return [
    ['speed', `${(frame.speed * MS_TO_KMH).toFixed(1)} km/h`],
    ['lateral', `${frame.speedLateral.toFixed(2)} m/s`],
    ['slip angle', `${(frame.slipAngle * RAD_TO_DEG).toFixed(1)}°`],
    ['slip ratio', frame.slipRatio.toFixed(3)],
    ['yaw rate', `${(frame.yawRate * RAD_TO_DEG).toFixed(1)}°/s`],
    // The chain's braking complaint IS this row's sign, so it says which way is which.
    ['pitch (+ nose up)', `${(frame.pitch * RAD_TO_DEG).toFixed(1)}°`],
    ['roll (+ right down)', `${(frame.roll * RAD_TO_DEG).toFixed(1)}°`],
    ['g long / lat', `${frame.gLong.toFixed(2)} / ${frame.gLat.toFixed(2)}`],
    ['g vert', frame.gVert.toFixed(2)],
    ['throttle', frame.throttle.toFixed(2)],
    ['steer', `${(frame.steer * RAD_TO_DEG).toFixed(1)}°`],
    ['engine / brake', `${(frame.engineForce / 1000).toFixed(1)} / ${(frame.brake / 1000).toFixed(1)} kN`],
    // The handbrake sends NO brake force — it locks the rear axle inside the physics layer — so watching the
    // brake row alone cannot tell you whether the lever registered. This row can.
    ['gear / handbrake', `${frame.gear === 0 ? 'R' : frame.gear} / ${frame.handbrake ? 'UP' : '—'}`],
  ];
}

export function PhysicsPanel({ actions }: { actions: PhysicsPanelActions }): ReactElement {
  const [readout, setReadout] = useState<null | PhysicsReadout>(null);

  useEffect(() => {
    actions.setPhysicsCapture?.(true);
    const timer = window.setInterval(() => setReadout(actions.physicsReadout?.() ?? null), POLL_MS);

    return (): void => {
      window.clearInterval(timer);
      actions.setPhysicsCapture?.(false);
    };
  }, [actions]);

  const constants = actions.physicsConstants?.() ?? [];

  return (
    <div style={styles.group}>
      <div style={styles.groupLabel}>DRIVEN CAR</div>
      {readout === null ? (
        <div style={styles.hint}>get in a car and drive — only the seated car is sampled</div>
      ) : (
        <>
          <StatRows rows={bodyRows(readout.frame)} />
          <div style={styles.groupLabel}>WHEELS — CONTACT · TRAVEL · LOAD · SLIP</div>
          <StatRows rows={wheelRows(readout.frame, readout.corners, readout.surfaceOf)} />
        </>
      )}
      <div style={styles.divider} />
      <div style={styles.groupLabel}>SHARED CONSTANTS (READ-ONLY — EVERY CAR RUNS THESE)</div>
      <StatRows rows={constants.map(([label, value]): readonly [string, string] => [label, String(value)])} />
    </div>
  );
}

/**
 * One line per wheel: contact, suspension travel, normal load, longitudinal slip — and WHAT IT IS STANDING ON
 * (plan 081/10), because "grass feels the same as tarmac" is only answerable once the panel can say whether
 * the wheel is on grass at all. Most green-looking SA ground is adhesion group ROAD (`dirt`, `dirttrack`),
 * and then ×1.00 is the correct, deliberate answer rather than a bug.
 */
export function wheelRows(
  frame: TelemetryFrame,
  corners: readonly string[],
  surfaceOf?: (id: number) => null | { factor: number; name: string },
): readonly (readonly [string, string])[] {
  return frame.wheels.map((wheel, index) => {
    const load = `${(wheel.load / 1000).toFixed(1)}kN`;
    const surface = wheel.surface === null ? null : (surfaceOf?.(wheel.surface) ?? null);
    const ground = surface === null ? '' : ` ${surface.name} ×${surface.factor.toFixed(2)}`;

    return [
      // A car whose wheel placements never reached the panel still gets a stable name.
      corners[index] ?? `W${index}`,
      `${wheel.contact ? '●' : '○'} ${bar(wheel.compression)} ${load} ${wheel.slipRatio.toFixed(2)}${ground}`,
    ] as const;
  });
}

/** The tab's one row shape: label left, value right. */
function StatRows({ rows }: { rows: readonly (readonly [string, string])[] }): ReactElement {
  return (
    <>
      {rows.map(([label, value]) => (
        <div key={label} style={styles.statRow}>
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </>
  );
}
