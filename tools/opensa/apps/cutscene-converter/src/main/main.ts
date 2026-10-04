/**
 * Electron main: the window, and nothing that knows what a `.dff` is. The conversion lives in
 * `@opensa/vehicle-cutscene` and runs in a CHILD process (plan 001) — this file must stay a shell.
 */
import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';

import { APP_NAME, DEV_SERVER_URL_ENV } from '../shared/app-info';
import { registerIpc } from './ipc';

function createWindow(): void {
  const window = new BrowserWindow({
    backgroundColor: '#000000',
    height: 720,
    minHeight: 560,
    minWidth: 840,
    show: false,
    title: APP_NAME,
    webPreferences: { preload: join(__dirname, 'preload.cjs') },
    width: 1040,
  });

  registerIpc(window);

  // Painting an empty window first and then swapping in the UI reads as a stall on a cold start.
  //
  // The log line is HALF a cold start and says so: the portable exe unpacks itself into a temp folder and
  // only then starts this process, so the unpack is time no code of ours can see. The whole figure is a
  // stopwatch from the double-click.
  window.once('ready-to-show', () => {
    const startedAt = process.getCreationTime();

    if (startedAt !== null) {
      console.log(`${APP_NAME}: window shown ${Math.round(Date.now() - startedAt)} ms after this process started`);
    }

    window.show();
  });

  // A renderer that fails to load leaves a BLANK window and no message at all — the one Electron failure
  // that looks like nothing happening. Say it out loud, and keep the window so the message has somewhere
  // to be seen from.
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`${APP_NAME}: the window failed to load ${url} — ${description} (${code})`);
  });

  window.webContents.on('did-finish-load', () => console.log(`${APP_NAME}: window loaded`));

  // The OTHER way this app can go black: the renderer process dies (the conversion is memory-hungry, and a
  // machine under pressure kills what it can). A dead renderer paints nothing and cannot report itself, so
  // the message has to come from here — and then the window is reloaded, because the wizard's state is
  // cheap to redo and a black window is not something anyone can act on.
  window.webContents.on('render-process-gone', (_event, details) => {
    const reason = `${details.reason}${details.exitCode === undefined ? '' : ` (exit ${details.exitCode})`}`;
    console.error(`${APP_NAME}: the window's process died — ${reason}`);
    dialog.showErrorBox(
      APP_NAME,
      `The window's process died: ${reason}.\n\nAny conversion that had already finished is still on disk in your output folder. The window is being reloaded.`,
    );
    window.webContents.reload();
  });

  window.on('unresponsive', () => console.error(`${APP_NAME}: the window stopped responding`));

  const devServerUrl = process.env[DEV_SERVER_URL_ENV];

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.setName(APP_NAME);

// The about line says this on screen; the log says it for a run started from a terminal.
console.log(`${APP_NAME}: build ${__BUILD_COMMIT__}`);

void app.whenReady().then(() => {
  createWindow();

  // macOS keeps the process alive with no windows; clicking the dock icon must give one back.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
