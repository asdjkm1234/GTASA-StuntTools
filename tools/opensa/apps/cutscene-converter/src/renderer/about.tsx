import { converter } from './converter';

/**
 * What a bug report has to be able to name: the app version, the commit it was built from and the exact
 * plugin binary inside it. Both are injected at build time (see vite.config.ts) — `release/` is untracked,
 * so this line is the only thing on screen that says WHICH build is running.
 */
export function About(): React.ReactElement {
  const built = __ASI_SHA1__.length > 0;

  // A button, not an <a>: the window never navigates anywhere, the main process opens the page.

  return (
    <footer className="cc-about">
      <button className="cc-about-link" onClick={() => converter.openTutorial()} type="button">
        Tutorial
      </button>
      <span className="cc-about-sep">·</span>
      <span>v{__APP_VERSION__}</span>
      <span className="cc-about-sep">·</span>
      <span>
        build <code>{__BUILD_COMMIT__}</code>
      </span>
      <span className="cc-about-sep">·</span>
      {built ? (
        <span>
          perfect-cutscene.asi {__ASI_BYTES__} B · sha1 <code>{__ASI_SHA1__}</code>
        </span>
      ) : (
        <span className="cc-about-missing">no plugin embedded — this is a dev tree, not a shippable build</span>
      )}
    </footer>
  );
}
