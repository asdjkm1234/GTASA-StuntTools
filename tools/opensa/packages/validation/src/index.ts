/**
 * `@opensa/validation` — the SHAPE of "can I proceed, and what do I tell the user?", plus generic
 * file/path checks. It holds no domain knowledge: a question about SA data is asked of the tool that owns
 * that data, and only the ANSWER is typed here. See the README for where the line is and why.
 */
export { checkDirectory, checkEntries, checkFile, checkWritable, type FileExpectation } from './checks';
export { checkCoverage, type CoverageItem, type CoverageReport } from './coverage';
export { checkGameFolder, GAME_FILES } from './game-folder';
export { checkSaExe, SA_EXE } from './sa-exe';
export {
  collect,
  type ErrorVerdict,
  isBlocked,
  type OkVerdict,
  runChecks,
  type Verdict,
  type VerdictLevel,
  type VerdictReport,
  type WarningVerdict,
  worstLevel,
} from './verdict';
