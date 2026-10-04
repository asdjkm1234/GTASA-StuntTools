import type { CSSProperties, ReactElement } from 'react';

interface PreloaderProps {
  /** A standing truth about THIS load, shown under the rotating line; empty when there is nothing to say.
   *  Today that is "this download will not be kept" (plan 200/4-06) — a phone on a LAN IP has no secure
   *  context, so the whole game re-downloads on every visit and nothing else would ever tell anyone. */
  note?: string;
  /** 0–100. */
  percent: number;
  /** Rotating status line. */
  status: string;
}

export function Preloader({ note = '', percent, status }: PreloaderProps): ReactElement {
  const barStyle: CSSProperties = { width: `${percent}%` };

  return (
    <div className="sa-preloader">
      <div aria-hidden className="sa-progress">
        <div className="sa-progress__bar" style={barStyle} />
      </div>
      <span className="sa-status">{status}</span>
      {note ? <span className="sa-status sa-status--note">{note}</span> : null}
    </div>
  );
}
