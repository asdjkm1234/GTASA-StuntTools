/// <reference types="vite/client" />

/** The commit this bundle was built from, injected by vite `define` (see scripts/app-build.ts). `unknown`
 *  where there is no git; a trailing `+` means the tree was dirty. */
declare const __APP_BUILD__: string;

/** Build version, injected from package.json by vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string;

/** True only in the deploy build (`build:prod`) — hides the dev-only debugger sections. */
declare const __DEBUGGER_HIDE__: boolean;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ImportMetaEnv {
  /** Google Analytics measurement ID (e.g. `G-XXXXXXX`). Unset in dev → analytics is skipped. */
  readonly VITE_GA_ID?: string;
  /** Where the built game archives + viewer fixtures are served from (see `npm run serve:static`). */
  readonly VITE_STATIC_URL: string;
}

interface Window {
  dataLayer?: unknown[];
}
