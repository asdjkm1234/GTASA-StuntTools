import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * The SHAREABLE build of the dispatch console: ONE HTML file that streams a real world (201/2-02).
 *
 * The artifact this produces is a link somebody opens on a phone — no `assets/`, no server layout to get
 * right, nothing to serve beside it. It existed before this config did, made by hand, and that is exactly
 * why it broke: an artifact nobody can rebuild is one nobody can fix. `npm run build:share:dispatch`.
 *
 * Two things make single-file possible here, and both are narrow on purpose:
 *
 * - **The entry is `src/share.tsx`, not `src/main.tsx`** — swapped in the HTML before Vite scans it, so the
 *   boot shell in `dispatch.html` (201/4-03) is the same markup this repo serves rather than a copy that
 *   drifts. The only difference in that entry is an INLINED pak worker.
 * - **Everything else is inlined here**, and the plugin REFUSES to emit an artifact that still points at a
 *   file beside it. That refusal is the point: the gap this step closes was silent for months because the
 *   only mode a shared link ever opened (`?demo=1`) is the one mode that needs no worker.
 */

/**
 * Take the beside-the-entry worker path out of the artifact entirely.
 *
 * Not an optimisation: the module-relative `new Worker(new URL(…))` is emitted as a chunk whether or not
 * anything calls it, so its filename would sit in this bundle as dead code — indistinguishable from a live
 * fetch, which is exactly what makes the guard below able to say something exact instead of guessing.
 *
 * A `resolveId` hook rather than an alias, because the import inside the engine is RELATIVE
 * (`./default-pak-worker`) and an alias matches the specifier as written.
 */
function noBesideWorker(): Plugin {
  const stub = resolve(__dirname, 'src/share-inline-worker-only.ts');

  return {
    enforce: 'pre',
    name: 'dispatch-share-no-beside-worker',
    resolveId(source, importer) {
      return source.endsWith('/default-pak-worker') && importer?.includes('/stream/') ? stub : null;
    },
  };
}

/** Inline every chunk and asset into the HTML, then prove nothing external is left. */
function singleFile(): Plugin {
  return {
    enforce: 'post',
    generateBundle(_options, bundle): void {
      const htmlName = Object.keys(bundle).find((name) => name.endsWith('.html'));
      if (!htmlName) {
        throw new Error('share build: no HTML output to inline into');
      }
      const html = bundle[htmlName];
      if (html.type !== 'asset' || typeof html.source !== 'string') {
        throw new Error('share build: the HTML output is not text');
      }
      let source = html.source;
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') {
          // `</script>` inside the code would close the tag it is being carried in — the one escape an
          // inline bundle needs, and a silent one (the page loads, truncated, and dies on a syntax error).
          const code = output.code.replace(/<\/script/g, '<\\/script');
          // A replacer FUNCTION, never a replacement string: `$&`, `` $` `` and `$'` are substitution
          // patterns there, and minified React really does contain `.replace(k, "$&/")` — which put the
          // script tag it had just removed back inside the code it inlined, silently and only sometimes.
          source = source.replace(tagFor('script', name), () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (name.endsWith('.css') && typeof output.source === 'string') {
          const css = output.source;
          source = source.replace(tagFor('link', name), () => `<style>${css}</style>`);
          delete bundle[name];
        }
      }
      // A preload of a file that no longer exists is a 404 on every open — harmless, and exactly the kind of
      // detail that makes a field report about "the shared link" impossible to read.
      source = source.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');
      // Read the markup with the inlined code taken back out: a bundle is full of strings that look like
      // tags, and a guard that trips on React's own source text is a guard nobody keeps.
      const markup = source.replace(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g, '<script></script>');
      const leftover = /(?:src|href)="(?!data:|https?:|#)[^"]+"/.exec(markup);
      if (leftover) {
        throw new Error(
          `share build is not self-contained: the HTML still points at ${leftover[0]}. ` +
            `A single-file artifact has no directory beside it — inline it or drop it.`,
        );
      }
      html.source = source;
      // The markup is clean; the CODE is the other half, and the one that actually broke. A worker is not
      // loaded by a tag — it is `new Worker(new URL('assets/pak-worker-*.js', import.meta.url))` inside the
      // bundle — so an artifact can pass every check above and still fetch a file that is not there. That is
      // precisely the bug 201/2-02 exists to close, and it was invisible for months.
      for (const name of Object.keys(bundle)) {
        if (name === htmlName) {
          continue;
        }
        if (source.includes(name.split('/').pop() ?? name)) {
          throw new Error(
            `share build would FETCH '${name}' at runtime, and a single-file artifact has nowhere to load ` +
              `it from. Inline it at its import (Vite's \`?worker&inline\`) — src/share.tsx is where this ` +
              `build does exactly that for the pak worker.`,
          );
        }
        // Emitted and never fetched: shipping it would make "one file" mean two, and somebody will ship one.
        delete bundle[name];
      }
    },
    name: 'dispatch-share-single-file',
    transformIndexHtml: {
      handler: (html) => html.replace('/apps/dispatch/src/main.tsx', '/apps/dispatch/src/share.tsx'),
      order: 'pre',
    },
  };
}

/** The tag that loads `file`, whichever attribute carries it. */
function tagFor(tag: 'link' | 'script', file: string): RegExp {
  const quoted = file.replace(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

  return tag === 'script'
    ? new RegExp(`<script[^>]*src="[^"]*${quoted}"[^>]*></script>`)
    : new RegExp(`<link[^>]*href="[^"]*${quoted}"[^>]*>`);
}

const root = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  build: {
    // Fonts, icons and any other asset become data URIs rather than files beside an artifact that has no
    // beside. The guard above turns a miss into a build failure rather than a 404 in somebody's hand.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    emptyOutDir: true,
    outDir: resolve(root, 'dist-share'),
    rollupOptions: {
      input: resolve(root, 'dispatch.html'),
      output: { inlineDynamicImports: true },
    },
    target: 'esnext',
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEBUGGER_HIDE__: JSON.stringify(true),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [react(), noBesideWorker(), singleFile()],
  root,
});
