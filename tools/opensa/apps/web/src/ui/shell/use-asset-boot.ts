import type { LocalPakSource } from '@opensa/engine';
import type { AssetLoader, AssetLoaderKind, ProgressSnapshot } from '@opensa/loaders';
import type { AssetFileSystem } from '@opensa/renderware';

import { createAssetLoader } from '@opensa/loaders';
import { Vfs } from '@opensa/vfs';
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import type { BootState } from './boot-machine';

import { GAME_CONFIG, type GameId } from '../../game-config';
import { bootReducer, initialBootState } from './boot-machine';
import { cacheNote, rotatingStatus, TEXTURE_STATUS, toPercent } from './boot-status';

const BASE = import.meta.env.VITE_STATIC_URL;
const NO_PROGRESS: ProgressSnapshot = { loadedBytes: 0, loadedChunks: 0, totalBytes: 0, totalChunks: 0 };
const STATUS_INTERVAL_MS = 3600;

/** The shell's boot controller: drives the per-game loader/VFS by phase and exposes state + actions. */
export interface AssetBoot {
  acceptDisclaimer: () => void;
  /** What this load will NOT do, shown under the preloader; empty when there is nothing to say (200/4-06). */
  cacheNote: string;
  /** Prompt for the install folder (local loader, user gesture) — unblocks loading. */
  chooseFolder: () => void;
  /** Last error message (for the error panel). */
  detail: string;
  /** The selected game's disclaimer (popup / folder prompt); null on the menu. */
  disclaimer: null | ReactNode;
  /** The asset file system the game reads from (filled as the load completes). */
  fs: AssetFileSystem;
  /** Folder mode: the picked install's world-pak source (opensa/ inside it). null in HTTP/fetch mode, so the
   *  host loads the world over HTTP. This is what makes the loading MODE select the world. */
  pakSource: LocalPakSource | null;
  pause: () => void;
  /** Active-load progress, 0–100. */
  percent: number;
  /** Launch a game from the menu. */
  play: (game: GameId) => void;
  resume: () => void;
  retry: () => void;
  state: BootState;
  /** Rotating status line for the preloader. */
  status: string;
  worldReady: () => void;
}

/** One game's loader + VFS, created when the game is selected. */
interface Session {
  loader: AssetLoader;
  vfs: Vfs;
}

export function useAssetBoot(): AssetBoot {
  const [state, dispatch] = useReducer(bootReducer, undefined, initialBootState);
  const [snapshot, setSnapshot] = useState<ProgressSnapshot>(NO_PROGRESS);
  const [tick, setTick] = useState(0);
  const [detail, setDetail] = useState('');
  const attemptRef = useRef(''); // `${game}:${retries}` — runs the load once per attempt (retry/StrictMode-safe)

  // `?loader=http-dir&src=<url>` (plan 079): a dev/session override that reads a served perfect-map-builder
  // output instead of the per-game loader. Non-null ⇒ every game runs from that served dir (no folder pick).
  const httpDirBase = useMemo<null | string>(() => {
    const params = new URLSearchParams(window.location.search);

    return params.get('loader') === 'http-dir' ? (params.get('src') ?? '') : null;
  }, []);
  /** The effective loader kind for a game — the http-dir override wins when present. */
  const loaderKind = useCallback(
    (game: GameId): AssetLoaderKind => (httpDirBase !== null ? 'http-dir' : GAME_CONFIG[game].assetLoader),
    [httpDirBase],
  );

  // A fresh loader + VFS per selected game (null on the menu). The empty fallback VFS is only read before a
  // game is chosen (the game canvas mounts at warmup, when the session exists).
  const fallbackVfs = useMemo(() => new Vfs(), []);
  const session = useMemo<null | Session>(() => {
    if (!state.game) {
      return null;
    }
    const vfs = new Vfs();
    const loader = createAssetLoader({
      assetLoader: loaderKind(state.game),
      ...(httpDirBase !== null ? { base: httpDirBase } : {}),
      files: vfs,
      game: state.game,
      manifestUrl: `${BASE}/games/${state.game}-${__APP_VERSION__}/manifest.json`,
      sink: vfs,
      version: __APP_VERSION__,
    });

    return { loader, vfs };
  }, [state.game, httpDirBase, loaderKind]);

  const loaded = state.phase === 'warmup' || state.phase === 'playing' || state.phase === 'paused';
  const fs = useMemo<AssetFileSystem>(() => session?.vfs ?? fallbackVfs, [session, fallbackVfs]);

  // The loading MODE selects the world: any loader that can open its install's `opensa/` pak becomes the
  // world source — folder/http-dir from the install, and since 086 phase 3 the FETCH loader too (its
  // chunks deliver the pak into the VFS). Only once loaded — `openWorld` needs the content in place.
  const pakSource = useMemo<LocalPakSource | null>(() => {
    const loader = session?.loader;
    if (!loaded || !loader?.openWorld) {
      return null;
    }
    const open = loader.openWorld.bind(loader);

    return { open };
  }, [session, loaded]);

  // Stream active-load progress into state.
  useEffect(() => session?.loader.events.on('progress', setSnapshot), [session]);

  // Local loader: boot-time restore (no gesture). Re-grants the remembered folder handle so the pick below
  // does not have to prompt again — it does NOT skip the folder screen, because that screen is where the
  // disclaimer is shown and the disclaimer is shown every time.
  useEffect(() => {
    if (session?.loader.restore && state.phase === 'folder' && state.game) {
      void session.loader.restore().catch(() => undefined);
    }
  }, [session, state.phase, state.game]);

  // Run the load once per attempt: init (manifest / scan) → load every group (one screen) → verify.
  useEffect(() => {
    if (state.phase !== 'loading' || !session) {
      return;
    }
    const key = `${state.game}:${state.retries}`;
    if (attemptRef.current === key) {
      return;
    }
    attemptRef.current = key;
    setSnapshot(NO_PROGRESS); // eslint-disable-line @eslint-react/set-state-in-effect -- reset per attempt

    const run = async (): Promise<void> => {
      const manifest = await session.loader.init();
      await session.loader.load();
      const problems = session.vfs.verify(manifest);
      if (problems.length > 0) {
        throw new Error(problems.join('; '));
      }
      dispatch({ type: 'LOADED' });
    };

    void run().catch((error: unknown) => {
      setDetail(String(error));
      dispatch({ type: 'FAIL' });
    });
  }, [state.phase, state.game, state.retries, session]);

  // Rotate the preloader status text while loading.
  useEffect(() => {
    if (state.phase !== 'loading') {
      return;
    }
    const id = setInterval(() => setTick((value) => value + 1), STATUS_INTERVAL_MS);

    return (): void => clearInterval(id);
  }, [state.phase]);

  return {
    acceptDisclaimer: useCallback((): void => dispatch({ type: 'DISCLAIMER_OK' }), []),
    cacheNote: state.game ? cacheNote(loaderKind(state.game)) : '',
    // Local loader, from the folder screen: prompt for the install folder (the picker must run in this click —
    // its user gesture). On success the disclaimer counts as accepted and loading begins.
    chooseFolder: useCallback((): void => {
      const active = session;
      const game = state.game;
      if (!active || !game) {
        return;
      }
      void (async (): Promise<void> => {
        try {
          await active.loader.prepare?.();
          dispatch({ type: 'FOLDER_READY' });
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            setDetail(String(error));
          }
        }
      })();
    }, [session, state.game]),
    detail,
    disclaimer: state.game ? GAME_CONFIG[state.game].disclaimer : null,
    fs,
    pakSource,
    pause: useCallback((): void => dispatch({ type: 'PAUSE' }), []),
    percent: toPercent(snapshot),
    play: useCallback(
      (game: GameId): void => {
        dispatch({ assetLoader: loaderKind(game), game, type: 'SELECT' });
      },
      [loaderKind],
    ),
    resume: useCallback((): void => dispatch({ type: 'RESUME' }), []),
    retry: useCallback((): void => {
      setDetail('');
      dispatch({ type: 'RETRY' });
    }, []),
    state,
    status: rotatingStatus(TEXTURE_STATUS, tick),
    worldReady: useCallback((): void => dispatch({ type: 'WORLD_READY' }), []),
  };
}
