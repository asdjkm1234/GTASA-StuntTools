import type { ConvertResult } from '../shared/ipc';

/**
 * What the app is doing, said in one line. Without it a run is invisible: the tool's own output is the only
 * thing on screen, and a run that has printed nothing yet leaves a black window that reads as a crash —
 * which is how the first Windows run of 0.4.0 read, with the converted files already on disk.
 */
export function Status({
  busy,
  result,
}: {
  readonly busy: boolean;
  readonly result: ConvertResult | undefined;
}): React.ReactElement | undefined {
  if (busy) {
    return (
      <p className="cc-status cc-status-busy">
        <span className="cc-status-pulse" />
        Converting… this takes a few seconds. The lines below are the tool&apos;s own progress.
      </p>
    );
  }

  if (!result) {
    return undefined;
  }

  return result.code === 0 ? (
    <p className="cc-status cc-status-done">
      Conversion finished in {seconds(result.ms)}. The output folder holds models/cutscene.img, data/txdcut.ide,
      anim/cuts.img and perfect-cutscene.asi — copy them into your game.
    </p>
  ) : (
    <p className="cc-status cc-status-failed">
      The converter stopped with code {result.code} after {seconds(result.ms)}. The lines below say where.
    </p>
  );
}

/** Seconds with one decimal — a run is seconds long, so minutes would be a unit nobody reads. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
