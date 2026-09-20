# 097/01 — SCM/CLEO decoding & opcode model

No execution — turn a `.cs` buffer into a typed instruction stream, prove it on the whole 7-script
corpus, and produce the opcode whitelist the rest of the chain implements. Written from scratch: the
recon confirmed there is **no SCM code anywhere in the repo** (the old "lift the 0x014B reader" task
referenced comments, not code). The design itself is validated — the recon disassembler decoded the
entire corpus with exactly this shape.

## Decisions

1. **Two-layer decode.** Layer A = type-byte operand reader (each data-type byte → correctly sized typed
   value) on a plain little-endian cursor. The full type-byte set observed in the corpus:
   `0x01` int32, `0x02`/`0x03` global/local var (u16), `0x04` int8, `0x05` int16, `0x06` float32,
   `0x07`/`0x08` (+`0x0C/0x0D/0x12/0x13`) array refs (u16 offset, u16 index var, u8 size, u8 flags),
   `0x09` fixed 8-char string, `0x0A/0x0B/0x10/0x11` string-var refs (u16), `0x0E` length-prefixed
   string, `0x0F` fixed 16-char string, `0x00` = variadic terminator. Layer A is pure and
   exhaustively fixture-tested.
2. **Layer B = instruction reader driven by the DB**: u16 opcode (top bit `0x8000` = negated
   conditional) + operands until the DB-declared arity — with THREE special forms the recon nailed down:
   - **variadic opcodes** (`004F`, `0AB1`, `0AB2`, `0AD3`, …): read params until the `0x00` terminator;
   - **native calls `0AA5–0AA8`**: head = address, [struct (methods only)], numParams (literal), pop;
     then `numParams` input args, then output vars (`0AA7/0AA8`: one), then a `0x00` terminator;
   - **the Sanny footer**: every Sanny-compiled `.cs` ends with `FLAG`/`SRC`/`VAR` metadata sections
     after the last instruction (van door: 24 597 B file, 102 instructions — the rest is a variable-name
     table). The decoder recognises the footer boundary (section magic after an unconditional
     jump/return) and stops there; the footer is preserved as an opaque tail, never "failed on".
3. **Opcode DB = the Sanny Builder library JSON, vendored + pinned** (`sannybuilder/library` `sa.json`,
   3 739 commands with `num_params` across default/CLEO/CLEO+/NewOpcodes/…) → a generated typed
   `OpcodeDef` table in `packages/cleo/core`. Regeneration is a script, the pin is a recorded version;
   a DB gap surfaces as a located decode error, not a runtime mystery.
4. **Decode is total and lossless.** `Instruction[]` with byte offset, opcode id, negated flag, typed
   operands; an offset→index map (jumps target byte offsets — negative offsets in a `.cs` are
   script-local). An operand the DB cannot describe → hard located error.
5. **Disassembler as the proof**: `disassemble(bytes)` in Sanny-like text. The recon listings (all 7
   scripts) become the reference; committed as fixtures.
6. **Corpus fixtures the real-fixture way** ([[real-fixtures-over-synthetic-tests]]): the seven `.cs`
   are small mod files — commit them under the package's fixtures if licensing allows, else
   manifest them from `NO_COMMIT/cleo` (one manifest line each). Real scripts falsify what synthetic
   ones confirm — the footer and the native-call encoding were BOTH invisible to a synthetic corpus.

## Subtasks

- [x] Vendor + pin `sa.json`; generator → typed `OpcodeDef` table + loader tests (`0001`, `00D6`,
      `0453`, `0AB1`, `0AA7`, `0E01` resolve with correct arity/extension).
- [x] Layer A operand reader + fixtures per data-type byte (every byte the corpus contains, incl. the
      6-byte array refs and both string forms).
- [x] Layer B + the three special forms + `decodeScript(bytes) → { instructions, offsetIndex, footer }`.
- [x] `disassemble()`; decode all 7 corpus scripts; commit listings as fixtures.
- [x] **Produce the opcode whitelist** (id → name → category: control-flow / var / math / object /
      vehicle / player / native-memory / text / file / clock — with per-script frequency). Record it
      here; it scopes plans 03–05 exactly.

## Verification

- All 7 corpus scripts decode to the footer boundary with zero unknown opcodes/operands (the recon
  already achieved this — regression, not aspiration).
- Every jump/gosub/CLEO_CALL target in the corpus resolves through the offset map.
- Operand fixtures cover every data-type byte present in the corpus.
- Instruction counts match the recon census (91 / 239 / ~44 / ~102 / ~2 085 / ~64 / ~64).

## Ledger

_(filled 2026-08-04 — the chain's first code change; package `packages/cleo`)_

- **DB pin**: `sannybuilder/library` commit `867d1b9fa6947c991259ae3369b689eb6faf793a` (2026-07-19,
  library version 1.62), vendored at `packages/cleo/vendor/sa.json` (SHA-1
  `383b75e95f0891e539c617cdd1f5e3a3ac416b7c`). Generator `npm run cleo:opcodes` emits 3 696 rows
  (43 duplicate ids dropped by extension priority; the one real arity conflict is `0B21`, where
  SAMPFUNCS reassigns the CLEO+ clipboard id — SAMPFUNCS ranks last). Emitted arity = declared reads
  BEFORE a variadic tail, so the native calls 0AA5-0AA8 fall out of the uniform variadic rule
  (0AA5/0AA7 head 3, 0AA6/0AA8 head 4; args + output vars ride the terminator-driven tail).
- **Footer boundary is AUTHORITATIVE, not heuristic**: a Sanny-compiled `.cs` ends with the trailer
  `[u32 codeEnd]["__SBFTR\0"]`, and `codeEnd` is the exact byte where the VAR/FLAG/SRC metadata
  begins. Measured on the corpus: vandoor 24 597 B / code 1 010, rhino 34 114 B / code 16 572,
  firela 3 175 B / code 471, cardoor 3 522 B / code 492; ferris and windfarm carry no trailer (code
  to EOF). The recon's ASCII-opcode trap is prevented by construction — the decoder never walks into
  the footer at all.
- **Decode results** (all 7 fixture scripts, `npm run test:fixtures` manifest lines from
  `NO_COMMIT/cleo`): instruction counts 91 / 239 / 44 / 102 / 2 085 / 64 / 64 — the recon census
  exactly. Every script-local jump/gosub/CLEO_CALL target resolves through the offset map (asserted
  in `decode.test.ts` with a >100 checked-targets floor). Decode of all 7 = 0.22 ms mean (100 runs,
  tsx/node on the dev machine) — decoding is boot-noise, not a budget item.
- **Data-type bytes actually present in the corpus**: `0x01 0x02 0x03 0x04 0x05 0x06 0x08 0x09 0x0E
  0x11` (the full plan set 0x00-0x13 is unit-fixtured regardless; the corpus never uses global
  arrays, fixed-16 strings or most string-var forms).
- **Reference listings committed** at `fixtures/custom/cleo-listings/*.txt` (2 694 lines) — the disasm
  format is a contract; `disasm.test.ts` reproduces them byte for byte.
- **DB gaps found: none** — every corpus opcode resolved (the whole point of vendoring the library
  instead of hand-listing).

### The opcode whitelist (115 unique ids; scopes plans 03-05)

Category counts: var 36 - control-flow 13 - native-memory 13 - vehicle 12 - player 9 - object 9 -
model 8 - math 5 - text 5 - world 3 - clock 1 - file 1. Frequency columns are
ferris/windfarm/firela/vandoor/rhino/cardoor-coach/cardoor-bus (the two cardoor scripts are the same
bytes shipped by two mods). `model`/`world` were not in the plan's category list but earn their own
rows: model request/poll is 04's request-model facet, `world` is camera-distance + area-visible +
corona.

| id | name | ext | category | ferris/wind/firela/van/rhino/coach/bus |
| --- | --- | --- | --- | --- |
| 0000 | NOP | default | control-flow | 0/0/1/0/0/1/1 |
| 0001 | WAIT | default | control-flow | 3/5/1/1/1/1/1 |
| 0002 | GOTO | default | control-flow | 3/11/2/4/15/3/3 |
| 0006 | SET_LVAR_INT | default | var | 3/7/1/0/1/7/7 |
| 0007 | SET_LVAR_FLOAT | default | var | 6/2/0/0/74/0/0 |
| 000A | ADD_VAL_TO_INT_LVAR | default | var | 3/4/3/0/76/3/3 |
| 000B | ADD_VAL_TO_FLOAT_LVAR | default | var | 0/4/0/0/468/0/0 |
| 000E | SUB_VAL_FROM_INT_LVAR | default | var | 0/1/0/0/2/0/0 |
| 000F | SUB_VAL_FROM_FLOAT_LVAR | default | var | 0/2/0/0/0/0/0 |
| 0012 | MULT_INT_LVAR_BY_VAL | default | var | 0/1/0/0/0/0/0 |
| 0013 | MULT_FLOAT_LVAR_BY_VAL | default | var | 3/1/0/3/11/0/0 |
| 0017 | DIV_FLOAT_LVAR_BY_VAL | default | var | 1/0/0/0/3/0/0 |
| 0019 | IS_INT_LVAR_GREATER_THAN_NUMBER | default | var | 0/1/0/7/1/3/3 |
| 001B | IS_NUMBER_GREATER_THAN_INT_LVAR | default | var | 0/0/0/0/1/0/0 |
| 001D | IS_INT_LVAR_GREATER_THAN_INT_LVAR | default | var | 0/4/0/0/0/0/0 |
| 0021 | IS_FLOAT_LVAR_GREATER_THAN_NUMBER | default | var | 0/1/0/2/0/0/0 |
| 0023 | IS_NUMBER_GREATER_THAN_FLOAT_LVAR | default | var | 0/1/0/0/0/0/0 |
| 0025 | IS_FLOAT_LVAR_GREATER_THAN_FLOAT_LVAR | default | var | 0/0/0/0/240/0/0 |
| 0029 | IS_INT_LVAR_GREATER_OR_EQUAL_TO_NUMBER | default | var | 3/1/0/0/1/0/0 |
| 002B | IS_NUMBER_GREATER_OR_EQUAL_TO_INT_LVAR | default | var | 0/1/0/0/0/0/0 |
| 0034 | IS_FLOAT_VAR_GREATER_OR_EQUAL_TO_FLOAT_VAR | default | var | 0/0/0/0/240/0/0 |
| 0038 | IS_INT_VAR_EQUAL_TO_NUMBER | default | var | 0/0/1/0/0/0/0 |
| 0039 | IS_INT_LVAR_EQUAL_TO_NUMBER | default | var | 0/5/3/0/24/4/4 |
| 003B | IS_INT_LVAR_EQUAL_TO_INT_LVAR | default | var | 0/0/0/0/0/3/3 |
| 0043 | IS_FLOAT_LVAR_EQUAL_TO_NUMBER | default | var | 0/0/0/3/0/0/0 |
| 004D | GOTO_IF_FALSE | default | control-flow | 7/21/7/17/269/10/10 |
| 0050 | GOSUB | default | control-flow | 4/7/0/0/35/0/0 |
| 0051 | RETURN | default | control-flow | 3/5/0/0/6/0/0 |
| 005A | ADD_INT_LVAR_TO_INT_LVAR | default | var | 0/0/0/0/1/0/0 |
| 005B | ADD_FLOAT_LVAR_TO_FLOAT_LVAR | default | var | 3/1/0/0/0/0/0 |
| 0063 | SUB_FLOAT_LVAR_FROM_FLOAT_LVAR | default | var | 0/1/0/0/0/0/0 |
| 006B | MULT_FLOAT_LVAR_BY_FLOAT_LVAR | default | var | 0/2/0/0/0/0/0 |
| 0079 | ADD_TIMED_VAL_TO_FLOAT_LVAR | default | var | 1/0/0/0/0/0/0 |
| 007F | SUB_TIMED_VAL_FROM_FLOAT_LVAR | default | var | 0/1/0/0/0/0/0 |
| 0085 | SET_LVAR_INT_TO_LVAR_INT | default | var | 0/1/0/0/22/0/0 |
| 0087 | SET_LVAR_FLOAT_TO_LVAR_FLOAT | default | var | 1/1/0/0/250/0/0 |
| 0097 | ABS_LVAR_FLOAT | default | var | 0/1/0/0/0/0/0 |
| 00A0 | GET_CHAR_COORDINATES | default | player | 0/0/0/1/0/0/0 |
| 00D6 | IF | default | control-flow | 4/6/6/16/268/7/7 |
| 00DB | IS_CHAR_IN_CAR | default | vehicle | 0/0/0/0/1/0/0 |
| 00DF | IS_CHAR_IN_ANY_CAR | default | vehicle | 0/0/0/0/0/1/1 |
| 0108 | DELETE_OBJECT | default | object | 6/1/0/0/0/0/0 |
| 0137 | IS_CAR_MODEL | default | model | 0/0/1/0/1/0/0 |
| 0177 | SET_OBJECT_HEADING | default | object | 0/2/0/0/0/0/0 |
| 01BB | GET_OBJECT_COORDINATES | default | object | 0/1/0/0/0/0/0 |
| 01BC | SET_OBJECT_COORDINATES | default | object | 1/0/0/0/0/0/0 |
| 01F5 | GET_PLAYER_CHAR | default | player | 1/0/0/0/0/0/0 |
| 0208 | GENERATE_RANDOM_FLOAT_IN_RANGE | default | math | 0/1/0/0/0/0/0 |
| 0247 | REQUEST_MODEL | default | model | 4/4/0/0/0/0/0 |
| 0248 | HAS_MODEL_LOADED | default | model | 4/4/0/0/0/0/0 |
| 0249 | MARK_MODEL_AS_NO_LONGER_NEEDED | default | model | 4/0/0/0/0/0/0 |
| 024F | DRAW_CORONA | default | world | 0/1/0/0/0/0/0 |
| 0256 | IS_PLAYER_PLAYING | default | player | 0/0/1/1/1/1/1 |
| 02F6 | SIN | default | math | 1/0/0/0/0/0/0 |
| 02F7 | COS | default | math | 1/0/0/0/0/0/0 |
| 0343 | SET_TEXT_WRAPX | default | text | 0/0/0/0/1/0/0 |
| 03A4 | SCRIPT_NAME | default | control-flow | 0/0/1/0/1/1/1 |
| 03C0 | STORE_CAR_CHAR_IS_IN_NO_SAVE | default | vehicle | 0/0/0/0/0/1/1 |
| 03CA | DOES_OBJECT_EXIST | default | object | 0/2/0/0/0/0/0 |
| 03F0 | USE_TEXT_COMMANDS | default | text | 0/0/0/0/1/0/0 |
| 0400 | GET_OFFSET_FROM_OBJECT_IN_WORLD_COORDS | default | object | 0/1/0/0/0/0/0 |
| 0430 | WARP_CHAR_INTO_CAR_AS_PASSENGER | default | vehicle | 0/0/0/0/0/1/1 |
| 0441 | GET_CAR_MODEL | default | model | 0/0/0/1/0/1/1 |
| 0453 | SET_OBJECT_ROTATION | default | object | 9/2/0/0/0/0/0 |
| 046C | GET_DRIVER_OF_CAR | default | vehicle | 0/0/0/0/0/1/1 |
| 0485 | IS_PC_VERSION | default | control-flow | 1/1/0/0/0/0/0 |
| 056D | DOES_CHAR_EXIST | default | player | 0/0/0/0/1/0/0 |
| 05CA | TASK_ENTER_CAR_AS_PASSENGER | default | vehicle | 0/0/0/0/0/1/1 |
| 0604 | GET_HEADING_FROM_VECTOR_2D | default | math | 0/0/0/0/1/0/0 |
| 0615 | OPEN_SEQUENCE_TASK | default | player | 0/0/0/0/0/1/1 |
| 0616 | CLOSE_SEQUENCE_TASK | default | player | 0/0/0/0/0/1/1 |
| 0618 | PERFORM_SEQUENCE_TASK | default | player | 0/0/0/0/0/1/1 |
| 061B | CLEAR_SEQUENCE_TASK | default | player | 0/0/0/0/0/1/1 |
| 0633 | TASK_LEAVE_ANY_CAR | default | vehicle | 0/0/0/0/0/1/1 |
| 0676 | TASK_SHUFFLE_TO_NEXT_CAR_SEAT | default | vehicle | 0/0/0/0/0/1/1 |
| 0687 | CLEAR_CHAR_TASKS | default | player | 0/0/0/0/0/1/1 |
| 077E | GET_AREA_VISIBLE | default | world | 0/2/0/0/0/0/0 |
| 07FC | DISPLAY_TEXT_WITH_FLOAT | default | text | 0/0/0/0/1/0/0 |
| 0827 | CONNECT_LODS | default | object | 2/1/0/0/0/0/0 |
| 095F | GET_DOOR_ANGLE_RATIO | default | vehicle | 0/0/0/7/0/0/0 |
| 0A01 | IS_THIS_MODEL_A_CAR | default | model | 0/0/0/1/0/0/0 |
| 0A8C | WRITE_MEMORY | CLEO | native-memory | 0/0/0/11/3/0/0 |
| 0A8D | READ_MEMORY | CLEO | native-memory | 0/2/1/1/61/0/0 |
| 0A8E | INT_ADD | CLEO | native-memory | 0/0/1/11/0/0/0 |
| 0A93 | TERMINATE_THIS_CUSTOM_SCRIPT | CLEO | control-flow | 1/3/0/1/0/0/0 |
| 0A97 | GET_VEHICLE_POINTER | CLEO | native-memory | 0/0/1/1/2/0/0 |
| 0AA6 | CALL_METHOD | CLEO | native-memory | 0/0/9/2/1/0/0 |
| 0AA7 | CALL_FUNCTION_RETURN | CLEO | native-memory | 0/0/3/7/0/0/0 |
| 0AA9 | IS_GAME_VERSION_ORIGINAL | CLEO | control-flow | 0/0/0/1/0/0/0 |
| 0AB1 | CLEO_CALL | CLEO | control-flow | 0/72/0/0/0/0/0 |
| 0AB2 | CLEO_RETURN | CLEO | control-flow | 0/3/0/0/0/0/0 |
| 0AC8 | ALLOCATE_MEMORY | CLEO | native-memory | 0/1/0/0/0/0/0 |
| 0AC9 | FREE_MEMORY | CLEO | native-memory | 0/1/0/0/0/0/0 |
| 0ACD | PRINT_STRING_NOW | CLEO | text | 0/1/0/1/0/0/0 |
| 0AD3 | STRING_FORMAT | CLEO | text | 0/0/0/0/0/1/1 |
| 0AE2 | GET_RANDOM_CAR_IN_SPHERE_NO_SAVE_RECURSIVE | CLEO | vehicle | 0/0/0/2/0/0/0 |
| 0AEB | GET_VEHICLE_REF | CLEO | native-memory | 0/0/0/0/0/1/1 |
| 0AF0 | READ_INT_FROM_INI_FILE | ini | file | 0/0/0/0/0/1/1 |
| 0D37 | WRITE_STRUCT_PARAM | CLEO+ | native-memory | 0/2/0/0/0/0/0 |
| 0D38 | READ_STRUCT_PARAM | CLEO+ | native-memory | 0/1/0/0/0/0/0 |
| 0D4E | READ_STRUCT_OFFSET | CLEO+ | native-memory | 0/1/0/0/0/2/2 |
| 0E01 | CREATE_OBJECT_NO_SAVE | CLEO+ | object | 6/2/0/0/0/0/0 |
| 0E40 | GET_CURRENT_HOUR | CLEO+ | clock | 0/1/0/0/0/0/0 |
| 0E43 | GET_CHAR_TASK_POINTER_BY_ID | CLEO+ | native-memory | 0/0/0/0/0/1/1 |
| 0E4A | IS_CHAR_EXITING_ANY_CAR | CLEO+ | vehicle | 0/0/0/0/0/1/1 |
| 0E72 | CREATE_LIST | CLEO+ | var | 0/4/0/0/0/0/0 |
| 0E74 | LIST_ADD | CLEO+ | var | 0/2/0/0/0/0/0 |
| 0E77 | GET_LIST_SIZE | CLEO+ | var | 0/5/0/0/0/0/0 |
| 0E78 | GET_LIST_VALUE_BY_INDEX | CLEO+ | var | 0/5/0/0/0/0/0 |
| 0E79 | RESET_LIST | CLEO+ | var | 0/1/0/0/0/0/0 |
| 0E9C | GET_MODEL_BY_NAME | CLEO+ | model | 0/4/0/0/0/0/0 |
| 0EA8 | GET_ANY_CAR_NO_SAVE_RECURSIVE | CLEO+ | vehicle | 0/0/1/0/0/0/0 |
| 0EBE | LOCATE_CAMERA_DISTANCE_TO_COORDINATES | CLEO+ | world | 2/4/0/0/0/0/0 |
| 0EF1 | PERLIN_NOISE_FRACTAL_2D | CLEO+ | math | 0/1/0/0/0/0/0 |
| 0EF8 | GET_MODEL_INFO | CLEO+ | model | 0/1/0/0/0/0/0 |

category counts: var 36 · control-flow 13 · native-memory 13 · vehicle 12 · player 9 · object 9 · model 8 · math 5 · text 5 · world 3 · clock 1 · file 1
