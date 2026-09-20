/** Every channel the renderer can reach, in one place. The renderer has no Node and no filesystem. */
import { app, type BrowserWindow, dialog, ipcMain, shell } from 'electron';

import type { ConvertRequest, FolderKind } from '../shared/ipc';

import { TUTORIAL_URL } from '../shared/app-info';
import { IPC } from '../shared/ipc';
import { copyAsiInto } from './asi';
import { convert } from './convert';
import { validateCars, validateGame, validateOut } from './validate';

const PICKER_TITLE: Record<FolderKind, string> = {
  cars: 'Pick the folder of car mods',
  game: 'Pick your GTA: San Andreas folder',
  out: 'Pick an empty output folder',
};

export function registerIpc(window: BrowserWindow): void {
  ipcMain.handle(IPC.pickFolder, async (_event, kind: FolderKind): Promise<string | undefined> => {
    const result = await dialog.showOpenDialog(window, {
      buttonLabel: 'Choose',
      properties: kind === 'out' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
      title: PICKER_TITLE[kind],
    });

    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle(IPC.validateGame, (_event, gamePath: string) => validateGame(gamePath));
  ipcMain.handle(IPC.validateCars, (_event, gamePath: string, carsPath: string) => validateCars(gamePath, carsPath));
  ipcMain.handle(IPC.validateOut, (_event, gamePath: string, outPath: string) => validateOut(gamePath, outPath));

  ipcMain.handle(IPC.convert, async (_event, request: ConvertRequest) => {
    const result = await convert(request, (line) => window.webContents.send(IPC.convertLine, line));

    if (result.code === 0) {
      copyAsiInto(request.outPath);
    }

    return result;
  });

  ipcMain.handle(IPC.openFolder, (_event, path: string) => shell.openPath(path));

  ipcMain.on(IPC.openTutorial, () => void shell.openExternal(TUTORIAL_URL));

  // The app is a one-run errand: when the conversion is done there is nothing else to do here.
  ipcMain.on(IPC.quit, () => app.quit());
}
