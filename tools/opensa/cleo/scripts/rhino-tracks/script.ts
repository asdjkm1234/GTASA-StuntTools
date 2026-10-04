/**
 * Our replacement for the GTA 5 Rhino's `rhino tracks.cs` (plan cleo/scripts 001) — the tread
 * flipbook and the road wheels, on both runtimes.
 *
 * The original's math is recovered in the plan ledger; this is not a port of its SHAPE. Four
 * differences, each one a fix rather than a preference:
 *
 *  - **Parts are addressed BY NAME**, never through the `RwFrame+0x9C` sibling chain. The chain's
 *    anchor is `misc_e`, a dummy frame the vehicle builder does not emit as a part, so the original
 *    does literally nothing on our runtime (step-2 ledger: 0 effects per frame).
 *  - **No model id.** The script animates whatever carries `track_1..track_12` — the mod may sit on
 *    any slot, and any other tracked model built to the same names gets the same treatment.
 *  - **The tread bucket wraps.** The original's windows are half-open on the LEFT, leaving
 *    `angle = 270` (a parked tank's exact resting angle) matched by no window and every link
 *    banished. Ours is half-open on the right, so every angle lands on exactly one link.
 *  - **`SetRotateXOnly` instead of `SetRotate(x,y,z)`.** One axis, one argument, no ambiguity — and
 *    per gta-reversed only `SetRotate(x,y,z)` zeroes `m_pos`, so the original's 3-read/3-write
 *    position restore around all 22 parts is not needed at all. Track links keep the x/y the author
 *    modelled instead of being forced to the frame origin.
 */
import type { Operand } from '@opensa/cleo';

import { defineScript } from '../../sdk/src/dsl/script';
import { float, int, str } from '../../sdk/src/ir';

/** SA 1.0 US addresses (the atlas' verified rows). */
const GET_FRAME_FROM_NAME = 0x4c5400;
const SET_ROTATE_X_ONLY = 0x59afa0;

const VEHICLE_RW_OBJECT = 0x18;
const FRAME_MATRIX = 0x10;
/** Within the modelling CMatrix: +0x10 m_forward, +0x30 m_pos. */
const FRAME_FORWARD_Y = FRAME_MATRIX + 0x10 + 4;
const FRAME_POS_Z = FRAME_MATRIX + 0x30 + 8;

/** SA's player globals — the original's own liveness guard. */
const PLAYER_CHAR = 12;
const PLAYER_INDEX = 8;

const TRACK_LINKS = 12;
/** One flipbook frame per 1.5 deg of wheel roll; the tread pattern repeats every 18 deg. */
const LINK_ARC_DEG = 1.5;
const TREAD_PERIOD_DEG = TRACK_LINKS * LINK_ARC_DEG;
/** The road wheels are half the drive sprockets' diameter, so they turn twice as fast. */
const SMALL_WHEEL_RATIO = 2;
const SMALL_WHEELS = 8;
const DEG_TO_RAD = Math.PI / 180;

/** Where a link goes while it is not the visible one. See `docs/hacks/cleo-track-link-hide.md`. */
const HIDDEN_Z = -1000;
/** Only tanks near the player need their tread animated. */
const SEARCH_RADIUS_M = 150;

/** Reduce a heading in [0, 360) to [0, 18) with five conditional subtractions, not a 20-step loop. */
const TREAD_REDUCTION_STEPS = [16, 8, 4, 2, 1].map((multiple) => multiple * TREAD_PERIOD_DEG);

export const script = defineScript({
  /** ONE tracked vehicle in range, plus a few cars of traffic. Cost is linear and measured:
   *  ~11 instructions with the world empty, ~12 per car that is not tracked, ~230 per tank. */
  budgetPerTick: 300,
  build(s) {
    const car = s.local('car');
    const clump = s.local('clump');
    const frame = s.local('frame');
    const findNext = s.local('findNext');
    const px = s.local('px');
    const py = s.local('py');
    const pz = s.local('pz');
    const heading = s.local('heading');
    const phase = s.local('phase');
    const spin = s.local('spin');
    const linkZ = s.local('linkZ');

    /** Resolve `name` on the current clump into `frame`; run `then` only when the model carries it
     *  (a null frame dereferenced by `SetRotate*` is an access violation under real CLEO). */
    const withPart = (name: string, then: () => void): void => {
      s.op('CALL_FUNCTION_RETURN', int(GET_FRAME_FROM_NAME), int(2), int(2), str(name), clump, frame);
      s.if(() => s.not('IS_INT_LVAR_EQUAL_TO_NUMBER', frame, int(0)), { then });
    };

    const rollWheel = (name: string, angle: Operand): void =>
      withPart(name, () => {
        s.op('ADD_VAL_TO_INT_LVAR', frame, int(FRAME_MATRIX));
        s.op('CALL_METHOD', int(SET_ROTATE_X_ONLY), frame, int(1), int(0), angle);
      });

    /** Link `index` (1-based) is the visible one while `phase` is inside its own arc. */
    const placeLink = (index: number): void =>
      withPart(`track_${index}`, () => {
        const low = (index - 1) * LINK_ARC_DEG;
        const high = index * LINK_ARC_DEG;
        s.op('SET_LVAR_FLOAT', linkZ, float(HIDDEN_Z));
        s.if(
          () => {
            s.not('IS_NUMBER_GREATER_THAN_FLOAT_LVAR', float(low), phase);
            s.op('IS_NUMBER_GREATER_THAN_FLOAT_LVAR', float(high), phase);
          },
          { then: () => s.op('SET_LVAR_FLOAT', linkZ, float(0)) },
        );
        s.op('ADD_VAL_TO_INT_LVAR', frame, int(FRAME_POS_Z));
        s.op('WRITE_MEMORY', frame, int(4), linkZ, int(0));
      });

    const animate = (): void => {
      s.op('GET_VEHICLE_POINTER', car, clump);
      s.op('ADD_VAL_TO_INT_LVAR', clump, int(VEHICLE_RW_OBJECT));
      s.op('READ_MEMORY', clump, int(4), int(0), clump);
      // The rear-right road wheel is the reference: its frame m_forward stays in the YZ plane, so
      // the heading of (forward.y, forward.z) IS the wheel's roll angle. Only a model carrying the
      // track links is touched at all — that name is the capability test.
      withPart('track_1', () => {
        withPart('wheel_rb_dummy', () => {
          s.op('ADD_VAL_TO_INT_LVAR', frame, int(FRAME_FORWARD_Y));
          s.op('READ_MEMORY', frame, int(4), int(0), phase);
          s.op('ADD_VAL_TO_INT_LVAR', frame, int(4));
          s.op('READ_MEMORY', frame, int(4), int(0), spin);
          s.op('GET_HEADING_FROM_VECTOR_2D', phase, spin, heading);

          s.op('SET_LVAR_FLOAT_TO_LVAR_FLOAT', phase, heading);
          for (const step of TREAD_REDUCTION_STEPS) {
            s.if(() => s.not('IS_NUMBER_GREATER_THAN_FLOAT_LVAR', float(step), phase), {
              then: () => s.op('SUB_VAL_FROM_FLOAT_LVAR', phase, float(step)),
            });
          }

          s.op('SET_LVAR_FLOAT_TO_LVAR_FLOAT', spin, heading);
          s.op('MULT_FLOAT_LVAR_BY_VAL', spin, float(DEG_TO_RAD));
          rollWheel('wheel_big_0', spin);
          rollWheel('wheel_big_1', spin);
          s.op('MULT_FLOAT_LVAR_BY_VAL', spin, float(SMALL_WHEEL_RATIO));
          for (let wheel = 1; wheel <= SMALL_WHEELS; wheel += 1) {
            rollWheel(`wheel_small_${wheel}`, spin);
          }
          for (let link = 1; link <= TRACK_LINKS; link += 1) {
            placeLink(link);
          }
        });
      });
    };

    s.loop(() => {
      s.wait(0);
      s.if(
        () => {
          s.op('DOES_CHAR_EXIST', s.global(PLAYER_CHAR));
          s.op('IS_PLAYER_PLAYING', s.global(PLAYER_INDEX));
        },
        {
          then: () => {
            s.op('GET_CHAR_COORDINATES', s.global(PLAYER_CHAR), px, py, pz);
            s.op('SET_LVAR_INT', findNext, int(0));
            s.while(
              () =>
                s.op(
                  'GET_RANDOM_CAR_IN_SPHERE_NO_SAVE_RECURSIVE',
                  px,
                  py,
                  pz,
                  float(SEARCH_RADIUS_M),
                  findNext,
                  int(0),
                  car,
                ),
              () => {
                s.op('SET_LVAR_INT', findNext, int(1));
                animate();
              },
              { noWaitWarning: true },
            );
          },
        },
      );
    });
  },
  name: 'rhino-tracks',
  scmName: 'rhtrack',
});

/** Re-exported so the story test can name the same constants the script is built from. */
export const SPEC = {
  HIDDEN_Z,
  LINK_ARC_DEG,
  TRACK_LINKS,
  TREAD_PERIOD_DEG,
} as const;
