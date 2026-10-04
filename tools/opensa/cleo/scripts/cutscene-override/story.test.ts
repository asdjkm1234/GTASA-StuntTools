/**
 * The story is STRUCTURAL, not executed: `sa-only` means the OpenSA VM does not serve the cutscene
 * opcodes, so there is nothing headless to run them on — the review surface is the emitted
 * sequence (main.scm's own, plan 003 step 0) and the disasm listing; the behaviour verdict is the
 * bottle's (step 4).
 */
import { decodeScript } from '@opensa/cleo';
import { describe, expect, it } from 'vitest';

import { compileScript } from '../../sdk/src/build';
import { buildScript } from '../../sdk/src/dsl/script';
import { checkWhitelist, WhitelistError } from '../../sdk/src/whitelist/gate';
import { script as definition } from './script';

const OP = {
  CLEAR_CUTSCENE: 0x02ea,
  GOTO_IF_FALSE: 0x004d,
  HAS_CUTSCENE_FINISHED: 0x02e9,
  HAS_CUTSCENE_LOADED: 0x06b9,
  LOAD_CUTSCENE: 0x02e4,
  READ_STRING_FROM_INI_FILE: 0x0af4,
  SET_AREA_VISIBLE: 0x04bb,
  START_CUTSCENE: 0x02e7,
  TERMINATE: 0x0a93,
  WAIT: 0x0001,
} as const;

function opcodes(): number[] {
  return decodeScript(compileScript(definition).bytes).instructions.map((ins) => ins.opcode);
}

describe('cutscene-override', () => {
  describe('negative cases', () => {
    it('is refused by both VM-holding targets — the reason sa-only exists', () => {
      const built = buildScript(definition);
      for (const target of ['dual', 'opensa-only'] as const) {
        expect(() => checkWhitelist(built.instructions, target)).toThrow(WhitelistError);
      }
    });
  });

  describe('positive cases', () => {
    it('gates on the ini read: a failed read jumps straight to TERMINATE, no cutscene opcode touched', () => {
      const ops = opcodes();
      expect(ops[2]).toBe(OP.READ_STRING_FROM_INI_FILE);
      expect(ops[3]).toBe(OP.GOTO_IF_FALSE);
      // The inert path is the ini read and termination only — everything else sits inside the gate.
      expect(ops.filter((op) => op === OP.TERMINATE)).toHaveLength(1);
      expect(ops[ops.length - 1]).toBe(OP.TERMINATE);
    });

    it("emits main.scm's own sequence: area → load → LOADED wait → start → FINISHED poll → clear", () => {
      const ops = opcodes();
      const load = ops.indexOf(OP.LOAD_CUTSCENE);
      const start = ops.indexOf(OP.START_CUTSCENE);
      const clear = ops.indexOf(OP.CLEAR_CUTSCENE);
      expect(ops.indexOf(OP.SET_AREA_VISIBLE)).toBeLessThan(load);
      const loadedWait = ops.indexOf(OP.HAS_CUTSCENE_LOADED, load);
      expect(loadedWait).toBeGreaterThan(load);
      expect(loadedWait).toBeLessThan(start);
      expect(ops.indexOf(OP.HAS_CUTSCENE_FINISHED)).toBeGreaterThan(start);
      expect(clear).toBeGreaterThan(ops.indexOf(OP.HAS_CUTSCENE_FINISHED));
      // The timeout path exists: after LOAD a wait plus a started-guard check, CLEAR outside it
      // (the gate's manager-free checks BEFORE the load are extra occurrences by design).
      expect(ops.filter((op, at) => op === OP.HAS_CUTSCENE_LOADED && at > load)).toHaveLength(2);
      expect(ops.filter((op) => op === OP.CLEAR_CUTSCENE)).toHaveLength(1);
    });

    it('never runs a WAIT-free stretch beyond its declared budget (every loop is warning-free)', () => {
      const compiled = compileScript(definition);
      expect(compiled.warnings).toEqual([]);
      const ops = opcodes();
      let gap = 0;
      let worst = 0;
      for (const op of ops) {
        gap = op === OP.WAIT ? 0 : gap + 1;
        worst = Math.max(worst, gap);
      }
      // Linear over-approximation (counts both if-branches) — still must fit the budget.
      expect(worst).toBeLessThanOrEqual(definition.budgetPerTick);
    });

    it('builds deterministically and emits the committed listing (the review surface)', () => {
      const first = compileScript(definition);
      expect(first.artifact).toBe('cutscene-override.sa-only.cs');
      expect(first.bytes).toEqual(compileScript(definition).bytes);
      expect(first.listing).toMatchInlineSnapshot(`
        "000000: 03A4 SCRIPT_NAME 'csovrd'
        000011: 00D6 IF 0
        000015: 0AF4 READ_STRING_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'cutscene' 'scene' 0@s
        000065: 004D GOTO_IF_FALSE -778
        000072: 0006 SET_LVAR_INT 2@ 0
        000079: 00D6 IF 0
        000083: 0AF0 NOT READ_INT_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'areas' 0@s 2@
        000126: 004D GOTO_IF_FALSE -140
        000133: 0006 SET_LVAR_INT 2@ 0
        000140: 0001 WAIT 5000
        000145: 0006 SET_LVAR_INT 3@ 0
        000152: 00D6 IF 0
        000156: 0039 IS_INT_LVAR_EQUAL_TO_NUMBER 3@ 0
        000163: 004D GOTO_IF_FALSE -279
        000170: 00D6 IF 22
        000174: 0256 NOT IS_PLAYER_PLAYING 0
        000178: 016B GET_FADING_STATUS
        000180: 06B9 HAS_CUTSCENE_LOADED
        000182: 004D GOTO_IF_FALSE -201
        000189: 0001 WAIT 250
        000194: 0002 GOTO -170
        000201: 0006 SET_LVAR_INT 33@ 0
        000208: 00D6 IF 3
        000212: 0256 IS_PLAYER_PLAYING 0
        000216: 016B NOT GET_FADING_STATUS
        000218: 06B9 NOT HAS_CUTSCENE_LOADED
        000220: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 33@ 10000
        000228: 004D GOTO_IF_FALSE -246
        000235: 0001 WAIT 100
        000239: 0002 GOTO -208
        000246: 00D6 IF 2
        000250: 0256 IS_PLAYER_PLAYING 0
        000254: 016B NOT GET_FADING_STATUS
        000256: 06B9 NOT HAS_CUTSCENE_LOADED
        000258: 004D GOTO_IF_FALSE -272
        000265: 0006 SET_LVAR_INT 3@ 1
        000272: 0002 GOTO -152
        000279: 0006 SET_LVAR_INT 4@ 0
        000286: 00D6 IF 2
        000290: 0AF2 READ_FLOAT_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'sitex' 0@s 5@
        000333: 0AF2 READ_FLOAT_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'sitey' 0@s 6@
        000376: 0AF2 READ_FLOAT_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'sitez' 0@s 7@
        000419: 004D GOTO_IF_FALSE -462
        000426: 0006 SET_LVAR_INT 4@ 1
        000433: 0ACD PRINT_STRING_NOW 'CSOVRD: SITE OK' 3000
        000455: 0002 GOTO -488
        000462: 0ACD PRINT_STRING_NOW 'CSOVRD: NO SITE ROW' 3000
        000488: 0001 WAIT 500
        000493: 016A DO_FADE 500 0
        000500: 00D6 IF 0
        000504: 016B GET_FADING_STATUS
        000506: 004D GOTO_IF_FALSE -524
        000513: 0001 WAIT 50
        000517: 0002 GOTO -500
        000524: 01B4 SET_PLAYER_CONTROL 0 0
        000530: 01EB SET_CAR_DENSITY_MULTIPLIER 0.0
        000537: 03DE SET_PED_DENSITY_MULTIPLIER 0.0
        000544: 00D6 IF 0
        000548: 0039 IS_INT_LVAR_EQUAL_TO_NUMBER 4@ 1
        000555: 004D GOTO_IF_FALSE -623
        000562: 000B ADD_VAL_TO_FLOAT_LVAR 7@ 1.0
        000572: 00A1 SET_CHAR_COORDINATES $12 5@ 6@ 7@
        000586: 04E4 REQUEST_COLLISION 5@ 6@
        000594: 03CB LOAD_SCENE 5@ 6@ 7@
        000605: 0395 CLEAR_AREA 5@ 6@ 7@ 300.0 1
        000623: 04BB SET_AREA_VISIBLE 2@
        000628: 02E4 LOAD_CUTSCENE 0@s
        000633: 0006 SET_LVAR_INT 32@ 0
        000640: 00D6 IF 1
        000644: 06B9 NOT HAS_CUTSCENE_LOADED
        000646: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 32@ 15000
        000654: 004D GOTO_IF_FALSE -672
        000661: 0001 WAIT 100
        000665: 0002 GOTO -640
        000672: 00D6 IF 0
        000676: 06B9 HAS_CUTSCENE_LOADED
        000678: 004D GOTO_IF_FALSE -735
        000685: 02E7 START_CUTSCENE
        000687: 016A DO_FADE 1000 1
        000694: 0006 SET_LVAR_INT 32@ 0
        000701: 00D6 IF 1
        000705: 02E9 NOT HAS_CUTSCENE_FINISHED
        000707: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 32@ 300000
        000717: 004D GOTO_IF_FALSE -735
        000724: 0001 WAIT 0
        000728: 0002 GOTO -701
        000735: 016A DO_FADE 0 0
        000741: 02EA CLEAR_CUTSCENE
        000743: 02EB RESTORE_CAMERA_JUMPCUT
        000745: 0373 SET_CAMERA_BEHIND_PLAYER
        000747: 04BB SET_AREA_VISIBLE 0
        000751: 01EB SET_CAR_DENSITY_MULTIPLIER 1.0
        000758: 03DE SET_PED_DENSITY_MULTIPLIER 1.0
        000765: 01B4 SET_PLAYER_CONTROL 0 1
        000771: 016A DO_FADE 1000 1
        000778: 0A93 TERMINATE_THIS_CUSTOM_SCRIPT
        ; footer: 12 bytes at 780
        "
      `);
    });
  });
});
