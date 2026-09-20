export { Cursor } from './core/cursor';
export { CleoDecodeError, type DecodedScript, decodeScript, type Instruction, NEGATED_BIT } from './core/decode';
export { disassemble, formatInstruction } from './core/disasm';
export { type OpcodeDef, opcodeDef, opcodeTable } from './core/opcode-table';
export { type Operand, readOperand, TYPE_END, type VarScope } from './core/operands';
export { CORPUS_TRACE_RUNS, corpusTrace, type CorpusTraceRun } from './vm/corpus-traces';
export type {
  CleoHost,
  CleoModelFacet,
  CleoObjectFacet,
  CleoPlayerFacet,
  CleoTextFacet,
  CleoVehicleFacet,
  CleoWorldFacet,
} from './vm/host.interface';
export { AtlasMemory, type AtlasMiss, type NativeArg, type NativeValue, type NativeWorld, SA } from './vm/native-atlas';
export { isNativeToken, tokenEntry, tokenOffset, TokenTable, type TokenTarget } from './vm/native-tokens';
export { createRecordingHost, type RecordingHost, type RecordingHostOptions } from './vm/recording-host';
export { type HandlerContext, HandlerRegistry, type OpcodeHandler, type OpcodeResult } from './vm/registry';
export { ScriptRunner, type ScriptRunnerOptions, type ThreadFaultRecord, type UnimplementedHit } from './vm/runner';
export {
  type Quat,
  quatAxes,
  quatFromSaEuler,
  quatMultiply,
  quatRotateX,
  quatRotateY,
  quatRotateZ,
} from './vm/sa-matrix';
export { resolveScriptFilePath } from './vm/script-path';
export { CleoThread, ThreadFault } from './vm/thread';
export {
  atlasMissKey,
  atlasTierOf,
  DECLARED_ATLAS_TIERS,
  DECLARED_TIERS,
  tierOf,
  type TierResolution,
  type UnimplementedTier,
} from './vm/tiers';
export { type TraceEntry, TraceRing } from './vm/trace';
export { VarSpace } from './vm/var-space';
