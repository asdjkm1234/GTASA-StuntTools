/**
 * cutscene-override (cleo/scripts plan 003): play the cutscene named in `cleo\cutscene-override.ini`
 * once, at session start, instead of the player sitting through the intro to reach it. The field
 * instrument for vehicle-cutscene work — one ini edit + one save load per look.
 *
 * The opcode sequence is main.scm's own (measured, plan 003 step 0): area → `02E4` → wait `06B9`
 * (REQUIRED: starting unloaded runs degraded — no camera, no widescreen) → `02E7` → poll `02E9` →
 * fade out → `02EA` → restore. Waits are condition-driven like main.scm's; the one addition is a
 * TIMERA timeout on the load wait, because a bad ini name never reaches LOADED — that path restores
 * the player and terminates instead of hanging on a black screen.
 *
 * `target: 'sa-only'` — the mirror of opensa-only: OpenSA has no cutscene system, so this artifact
 * is for the real-SA bottle alone and the whitelist holds only the real-CLEO half.
 */
import { TIMER_A } from '@opensa/cleo/vm/thread';

import { defineScript } from '../../sdk/src/dsl/script';
import { float, int, lvar, str } from '../../sdk/src/ir';

const INI = 'cleo\\cutscene-override.ini';
const PLAYER = 0;
/**
 * `$3 = GET_PLAYER_CHAR($2)` — measured in main.scm's MAIN block @ 0xdc15; a CLEO-safe global.
 * SCM global operands carry BYTE offsets, so $3 goes into the stream as 12 (field round 7: passing
 * the slot number made `00A1` read a garbage handle at offset 3 and crash the game).
 */
const PLAYER_ACTOR = 3 * 4;
const FADE_OUT = 0;
const FADE_IN = 1;
const FADE_MS = 500;
/** main.scm fades back in over a full second after a cutscene (measured at the prolog sites). */
const FADE_IN_MS = 1000;
/** A scene that never reaches LOADED (an ini typo, a broken install) stops waiting here. */
const LOAD_TIMEOUT_MS = 15_000;
/** Belt for a `02E9` that never fires: no scene runs longer than this — restore instead of hang. */
const FINISH_TIMEOUT_MS = 300_000;
/** New-game boot settle before the gate starts judging anything. */
const GRACE_MS = 5000;
/** The quiet must HOLD this long — bridges the intro's between-scenes loading gaps (rounds 3-4). */
const DEBOUNCE_MS = 10_000;
const POLL_MS = 250;

export const script = defineScript({
  budgetPerTick: 24,
  build(s) {
    const scene = s.localString('scene');
    const area = s.local('area');
    const gateDone = s.local('gateDone');
    const siteOk = s.local('siteOk');
    const siteX = s.local('siteX');
    const siteY = s.local('siteY');
    const siteZ = s.local('siteZ');
    const timer = lvar(TIMER_A);
    const debounce = lvar(TIMER_A + 1);

    // The inert gate: no ini / no key → not a viewer session, vanish without touching anything.
    s.if(() => s.op('READ_STRING_FROM_INI_FILE', str(INI), str('cutscene'), str('scene'), scene), {
      then: () => {
        // The scene's interior area (generated [areas] section). A FAILED CLEO ini read does not
        // leave the var alone — it writes a failure marker into it, and `04BB` with that garbage
        // hides the whole exterior world (field rounds 6-9: every scene played against bare sky).
        // The guard resets 0 on failure, and the generator now emits a row for EVERY scene.
        s.op('SET_LVAR_INT', area, int(0));
        s.if(() => s.not('READ_INT_FROM_INI_FILE', str(INI), str('areas'), scene, area), {
          then: () => s.op('SET_LVAR_INT', area, int(0)),
        });

        // Field rounds 3-5: the gate keys on the CUTSCENE MANAGER, nothing else. ONMISSION is
        // useless here twice over — SA's new-game intro is NOT a mission (it stays 0 through the
        // airport scene, round 4), and the bike-home phase IS one (waiting for 0 means finishing
        // it, round 5 — and the user's call is that the trigger is NEW GAME, not mission-passed).
        // HAS_CUTSCENE_LOADED is true through every intro scene, so the gate is "the manager is
        // free, no fade, player playing — held CONTINUOUSLY for the debounce"; the debounce
        // bridges the between-scenes gaps where the next intro scene is still loading. Deliberate
        // consequence: on a mid-mission save the scene fires during the mission — fine for a
        // debug instrument.
        s.wait(GRACE_MS);
        s.op('SET_LVAR_INT', gateDone, int(0));
        s.while(
          () => s.op('IS_INT_LVAR_EQUAL_TO_NUMBER', gateDone, int(0)),
          () => {
            s.while(
              () => {
                s.not('IS_PLAYER_PLAYING', int(PLAYER));
                s.op('GET_FADING_STATUS');
                s.op('HAS_CUTSCENE_LOADED');
              },
              () => s.wait(POLL_MS),
              { any: true },
            );
            s.op('SET_LVAR_INT', debounce, int(0));
            s.while(
              () => {
                s.op('IS_PLAYER_PLAYING', int(PLAYER));
                s.not('GET_FADING_STATUS');
                s.not('HAS_CUTSCENE_LOADED');
                s.not('IS_INT_LVAR_GREATER_THAN_NUMBER', debounce, int(DEBOUNCE_MS));
              },
              () => s.wait(100),
            );
            s.if(
              () => {
                s.op('IS_PLAYER_PLAYING', int(PLAYER));
                s.not('GET_FADING_STATUS');
                s.not('HAS_CUTSCENE_LOADED');
              },
              { then: () => s.op('SET_LVAR_INT', gateDone, int(1)) },
            );
          },
        );
        // Read the scene's world site ([sitex]/[sitey]/[sitez], key = the scene name — the same
        // var-key read shape as [areas]) and SAY which path was taken: the reads are silent
        // encodings under real CLEO, and field round 8 could not tell a failed read from a
        // failed warp. The print doubles as the "override is about to fire" warning.
        s.op('SET_LVAR_INT', siteOk, int(0));
        s.if(
          () => {
            s.op('READ_FLOAT_FROM_INI_FILE', str(INI), str('sitex'), scene, siteX);
            s.op('READ_FLOAT_FROM_INI_FILE', str(INI), str('sitey'), scene, siteY);
            s.op('READ_FLOAT_FROM_INI_FILE', str(INI), str('sitez'), scene, siteZ);
          },
          {
            else: () => s.op('PRINT_STRING_NOW', str('CSOVRD: NO SITE ROW'), int(3000)),
            then: () => {
              s.op('SET_LVAR_INT', siteOk, int(1));
              s.op('PRINT_STRING_NOW', str('CSOVRD: SITE OK'), int(3000));
            },
          },
        );
        s.wait(FADE_MS);

        // main.scm's start sequence: fade to black, freeze, area, load, wait for LOADED.
        s.op('DO_FADE', int(FADE_MS), int(FADE_OUT));
        s.while(
          () => s.op('GET_FADING_STATUS'),
          () => s.wait(50),
        );
        s.op('SET_PLAYER_CONTROL', int(PLAYER), int(0));
        // Field round 11: the world keeps LIVING around the frozen player — fresh traffic spawned
        // and drove through the collisionless cutscene cars. Missions suppress it; so do we.
        s.op('SET_CAR_DENSITY_MULTIPLIER', float(0));
        s.op('SET_PED_DENSITY_MULTIPLIER', float(0));

        // Field round 6: the scene plays at ITS world site (the .cut's own offset), and the world
        // only streams around the PLAYER — a scene 300 m from where CJ stands renders in a void.
        // main.scm's answer is preloading at the site; ours is the same plus the warp: put the
        // frozen player AT the site (he is the streaming center), then load the world there. A
        // scene with no site rows in the ini plays wherever the player already is.
        s.if(() => s.op('IS_INT_LVAR_EQUAL_TO_NUMBER', siteOk, int(1)), {
          then: () => {
            s.op('ADD_VAL_TO_FLOAT_LVAR', siteZ, float(1));
            s.op('SET_CHAR_COORDINATES', s.global(PLAYER_ACTOR), siteX, siteY, siteZ);
            s.op('REQUEST_COLLISION', siteX, siteY);
            s.op('LOAD_SCENE', siteX, siteY, siteZ);
            s.op('CLEAR_AREA', siteX, siteY, siteZ, float(300), int(1));
          },
        });

        s.op('SET_AREA_VISIBLE', area);
        s.op('LOAD_CUTSCENE', scene);
        s.op('SET_LVAR_INT', timer, int(0));
        s.while(
          () => {
            s.not('HAS_CUTSCENE_LOADED');
            s.not('IS_INT_LVAR_GREATER_THAN_NUMBER', timer, int(LOAD_TIMEOUT_MS));
          },
          () => s.wait(100),
        );

        // Loaded → play to the end (the manager sets widescreen and fades in itself).
        s.if(() => s.op('HAS_CUTSCENE_LOADED'), {
          then: () => {
            s.op('START_CUTSCENE');
            s.op('DO_FADE', int(FADE_IN_MS), int(FADE_IN));
            s.op('SET_LVAR_INT', timer, int(0));
            s.while(
              () => {
                s.not('HAS_CUTSCENE_FINISHED');
                s.not('IS_INT_LVAR_GREATER_THAN_NUMBER', timer, int(FINISH_TIMEOUT_MS));
              },
              () => s.wait(0),
            );
          },
        });

        // Common restore, timeout path included. Field round 1 (white screen, thread never
        // terminated): anything between FINISHED and CLEAR is a window for the manager's own
        // end-fade to hold `016B` true forever — so the fade-out is INSTANT (main.scm's `016A 0 0`)
        // and CLEAR follows in the same tick; the slow fade only comes back AFTER the clear.
        s.op('DO_FADE', int(0), int(FADE_OUT));
        s.op('CLEAR_CUTSCENE');
        s.op('RESTORE_CAMERA_JUMPCUT');
        s.op('SET_CAMERA_BEHIND_PLAYER');
        s.op('SET_AREA_VISIBLE', int(0));
        s.op('SET_CAR_DENSITY_MULTIPLIER', float(1));
        s.op('SET_PED_DENSITY_MULTIPLIER', float(1));
        s.op('SET_PLAYER_CONTROL', int(PLAYER), int(1));
        s.op('DO_FADE', int(FADE_IN_MS), int(FADE_IN));
      },
    });
    s.op('TERMINATE_THIS_CUSTOM_SCRIPT');
  },
  name: 'cutscene-override',
  scmName: 'csovrd',
  target: 'sa-only',
});
