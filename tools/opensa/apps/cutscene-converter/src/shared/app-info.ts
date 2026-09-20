/** Facts both processes need. Kept out of `main/` and `renderer/` so neither imports the other. */
export const APP_NAME = 'Cutscene Converter';

/**
 * The tutorial the app links to: the page in the repo, so the link keeps working for whoever has the exe
 * regardless of where else it gets published. Held here, never passed from the renderer — the window asks
 * to open THE TUTORIAL, so a compromised renderer cannot turn the bridge into "open any URL".
 */
export const TUTORIAL_URL = 'https://github.com/AlexSergey/opensa/tree/main/docs/tutorial/cutscene-converter';

/** The env var `scripts/dev.ts` sets; its absence is what "packaged build" means to the main process. */
export const DEV_SERVER_URL_ENV = 'OPENSA_DEV_SERVER_URL';
