/**
 * "Is this a GTA:SA install we can read?" — composed from the generic checks, expressed as DATA so a
 * consumer can report WHICH file is missing rather than "wrong folder".
 *
 * A MODIFIED game is not an error. What matters is whether we can read what we need and patch what we
 * patch; a game that differs from stock but supplies all of this proceeds, because the audience for these
 * consumers is people with modded games.
 */
import type { Verdict } from './verdict';

import { checkDirectory, checkEntries } from './checks';

/**
 * The files the cutscene conversion actually opens — the list is the checked contract, not a sample of a
 * "real" install. Add one only when a consumer opens it.
 */
export const GAME_FILES: readonly string[] = [
  'anim/cuts.img',
  'data/carcols.dat',
  'data/txdcut.ide',
  'data/vehicles.ide',
  'models/cutscene.img',
  'models/generic/vehicle.txd',
  'models/gta3.img',
];

/** The folder exists and carries every file we read. Stops at the folder itself when there is no folder. */
export function checkGameFolder(gamePath: string, files: readonly string[] = GAME_FILES): Verdict[] {
  const folder = checkDirectory(gamePath, 'game folder');

  if (folder[0].level === 'error') {
    return folder;
  }

  return [...folder, ...checkEntries(gamePath, files, 'game folder')];
}
