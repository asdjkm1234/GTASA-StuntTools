/// <reference types="vite/client" />

/** The app's version, injected from package.json by vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string;

/** Byte size of the embedded `perfect-cutscene.asi`; `0` on a dev tree where it has not been built. */
declare const __ASI_BYTES__: number;

/** SHA1 of the embedded `perfect-cutscene.asi` — shown in the about screen so a bug report names it.
 *  Empty on a dev tree where it has not been built; a BUILD without it fails instead. */
declare const __ASI_SHA1__: string;
