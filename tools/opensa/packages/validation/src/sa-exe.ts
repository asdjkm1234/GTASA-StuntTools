/**
 * "Is the exe one the ASI will patch?" — the one check that is a silent trap.
 *
 * A converted fleet REQUIRES its plugin, and the plugin refuses an exe it does not recognise. A conversion
 * onto an unsupported exe "succeeds" and then loses actors behind car glass in-game, hours later. So this
 * has to be loud at the moment the game folder is chosen.
 *
 * The fingerprint is `@opensa/asi-sdk`'s canonical constant, imported and never restated — a second copy of
 * a hash is a second thing to forget when the accepted exe changes.
 */
import { SA_FINGERPRINT } from '@opensa/asi-sdk/sa-fingerprint';
import { join } from 'node:path';

import type { Verdict } from './verdict';

import { checkFile } from './checks';

export const SA_EXE = 'gta_sa.exe';

const UNSUPPORTED_EXE_FIX =
  `Use the GTA:SA 1.0 US (HOODLUM) ${SA_EXE} — ${SA_FINGERPRINT.exeSize} bytes, sha1 ${SA_FINGERPRINT.sha1}. ` +
  'The plugin patches only that build; on any other one the conversion looks fine and then loses the actors ' +
  'behind car glass in-game.';

/** Size + SHA1 of the game folder's exe against the only accepted build. */
export function checkSaExe(gamePath: string, exeName: string = SA_EXE): Verdict[] {
  const verdicts = checkFile(
    join(gamePath, exeName),
    { sha1: SA_FINGERPRINT.sha1, size: SA_FINGERPRINT.exeSize },
    exeName,
  );

  return verdicts.map((verdict) => (verdict.level === 'error' ? { ...verdict, fix: UNSUPPORTED_EXE_FIX } : verdict));
}
