/**
 * The SHAREABLE console: one file that streams a real world (201/2-02).
 *
 * `main.tsx` is the app as this repo serves it — a bundle plus `assets/`, which is what every ordinary deploy
 * wants. This entry exists for the artifact that is a single HTML file: a link somebody opens on a phone.
 * The two differ in exactly one thing, and it is the one that used to break.
 *
 * **The pak worker.** The engine builds it from a module-relative URL, which Vite emits as
 * `assets/pak-worker-*.js` beside the entry. A single-file artifact has no `assets/`, so a real `?src=`
 * fetched the manifest and then 404'd on the worker — and because that happens after the world looks like it
 * is loading, it reads as a hang rather than as a missing file. It stayed invisible for months because
 * `?demo=1` never constructs a worker at all, and `?demo=1` is what a shared link opened.
 *
 * So this entry inlines the worker into itself and hands the constructor to the boot
 * ([`StreamingHost.createWorker`](../../../packages/engine/src/stream/setup.ts)). It is still a worker — pak
 * bytes still never touch the main thread — it is just carried rather than fetched. The cost is ~31 kB of
 * base64 in THIS artifact and nothing at all in the ordinary build, which is why it is an entry rather than
 * a flag.
 */
import PakWorker from '@opensa/engine/stream/pak-worker?worker&inline';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root missing from dispatch.html');
}

createRoot(root).render(
  <StrictMode>
    <App createPakWorker={() => new PakWorker()} />
  </StrictMode>,
);
