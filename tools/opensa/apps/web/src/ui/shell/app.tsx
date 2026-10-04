import { lazy, type ReactElement, Suspense, useEffect, useState } from 'react';

import type { BootPhase } from './boot-machine';

import { initAnalytics } from './analytics';
import { Disclaimer } from './disclaimer';
import { ErrorPanel } from './error-panel';
import { FolderPrompt } from './folder-prompt';
import { GameHint } from './game-hint';
import { Logo } from './logo';
import { Menu } from './menu';
import { Preloader } from './preloader';
import { useAssetBoot } from './use-asset-boot';
import { useFullscreen } from './use-fullscreen';
import { probeWebGpu, webGpuGateMessage, type WebGpuProbe } from './webgpu-gate';
import './shell.css';

// The heavy game surface is code-split — fetched only past the menu.
// WebGPU-first (plan 074/10, user decision 2026-07-17): the own engine IS the game; browsers without
// WebGPU get the sorry screen, not a fallback renderer. The `?engine=three` comparison override and the
// three host it loaded were deleted with the rest of the old stack (074/13 phase 5, C2).
const GameCanvas = lazy(() => import('../engine-canvas-host').then((module) => ({ default: module.EngineCanvasHost })));

const SUBTITLED = 'sa-logo--small sa-logo--titled sa-logo--described';

export function App(): ReactElement {
  const boot = useAssetBoot();
  const fullscreen = useFullscreen();
  const { phase } = boot.state;
  const { pause, resume } = boot;
  // null = probe in flight (resolves in ms, well before the folder pick).
  const [webGpu, setWebGpu] = useState<null | WebGpuProbe>(null);
  /** The photo (fly) camera takes the screen — the shell's own chrome steps out of the shot. */
  const [photoMode, setPhotoMode] = useState(false);

  // Count the visit (no-op unless VITE_GA_ID is set).
  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void probeWebGpu().then((probe) => {
      if (!cancelled) {
        setWebGpu(probe);
      }
    });

    return (): void => {
      cancelled = true;
    };
  }, []);

  // Esc toggles pause ↔ play.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return;
      }
      if (phase === 'playing') {
        pause();
      } else if (phase === 'paused') {
        resume();
      }
    }
    window.addEventListener('keydown', onKeyDown);

    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, [phase, pause, resume]);

  const showGame = phase === 'warmup' || phase === 'playing' || phase === 'paused';
  const showLoadingScreen = phase === 'loading' || phase === 'warmup';

  if (webGpu !== null && webGpu !== 'ok') {
    return (
      <div className="sa-shell">
        <div className="sa-stage sa-stage--col">
          <Logo className={SUBTITLED} />
          <p className="sa-tagline">{webGpuGateMessage(webGpu)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sa-shell">
      {showGame && boot.state.game ? (
        <Suspense fallback={null}>
          <div className={phase === 'warmup' ? 'sa-game sa-hidden' : 'sa-game sa-fade-in'}>
            <GameCanvas
              fs={boot.fs}
              gameId={boot.state.game}
              onPhotoMode={setPhotoMode}
              onWorldReady={boot.worldReady}
              pakSource={boot.pakSource}
              paused={phase === 'paused'}
            />
          </div>
        </Suspense>
      ) : null}

      {showLoadingScreen ? (
        <div className="sa-stage">
          <Logo className={logoClass(phase)} />
        </div>
      ) : null}

      {phase === 'menu' ? (
        <div className="sa-stage sa-stage--col">
          <Logo className={SUBTITLED} />
          <p className="sa-tagline">
            Free and open source — a from-scratch game engine, built compatible with RenderWare (the tech behind GTA San
            Andreas).
          </p>
          <Menu onPlay={boot.play} />
        </div>
      ) : null}

      {phase === 'folder' ? (
        <div className="sa-stage sa-stage--col">
          <Logo className={SUBTITLED} />
          <FolderPrompt detail={boot.detail} disclaimer={boot.disclaimer} onChoose={boot.chooseFolder} />
        </div>
      ) : null}

      {phase === 'loading' ? <Preloader note={boot.cacheNote} percent={boot.percent} status={boot.status} /> : null}
      {phase === 'disclaimer' ? <Disclaimer onAccept={boot.acceptDisclaimer}>{boot.disclaimer}</Disclaimer> : null}
      {phase === 'error' ? <ErrorPanel detail={boot.detail} onRetry={boot.retry} /> : null}
      {phase === 'paused' ? (
        <div className="sa-overlay">
          <nav className="sa-menu">
            <button className="sa-menu__item" onClick={resume} type="button">
              Continue
            </button>
          </nav>
        </div>
      ) : null}

      {phase === 'playing' || phase === 'paused' ? <GameHint /> : null}

      {fullscreen.isFullscreen || photoMode ? null : (
        <button className="sa-fullscreen-btn" onClick={fullscreen.toggle} type="button">
          ⛶ Fullscreen
        </button>
      )}
    </div>
  );
}

/** Logo state per phase: a centered pulse while loading, the small subtitled mark otherwise. */
function logoClass(phase: BootPhase): string {
  return phase === 'loading' || phase === 'warmup' ? 'sa-logo--pulse' : SUBTITLED;
}
