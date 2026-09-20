/**
 * A pass-through service worker.
 *
 * It exists so Android offers "install" and the panel gets a home-screen icon — that is the whole job. It
 * caches NOTHING on purpose: this page reports the live state of a build machine, and a cached shell that
 * shows yesterday's preflight is worse than no icon at all.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => event.respondWith(fetch(event.request)));
