/**
 * The child process the app forks. It IS the tool's CLI — importing it runs it against `process.argv`, so
 * the app cannot drift from what a command line does, and the lines the user watches are the tool's own.
 *
 * Bundled to `dist/main/convert-child.cjs`; forked with Electron's own binary in Node mode, because a
 * packaged app has no `node` to call.
 */
import '@opensa/vehicle-cutscene/cli';
