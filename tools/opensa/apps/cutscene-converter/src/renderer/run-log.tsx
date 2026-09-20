import { useEffect, useRef } from 'react';

import type { LoggedLine } from './use-wizard';

/**
 * The tool's own lines, as it prints them. No synthetic percentage: the run is seconds long, and its
 * per-slot output is the honest progress.
 */
export function RunLog({ lines }: { readonly lines: readonly LoggedLine[] }): React.ReactElement | undefined {
  const endRef = useRef<HTMLDivElement>(null);

  // The braces are load-bearing: a concise body hands React whatever `scrollIntoView` returns, and React
  // takes an effect's return value for its CLEANUP function. That is the crash that emptied the window at
  // the end of a run — the conversion had finished and its files were on disk, and the app showed black.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines.length]);

  if (lines.length === 0) {
    return undefined;
  }

  return (
    <section className="cc-log">
      <pre className="cc-log-body">
        {lines.map((line) => (
          <span className={line.stream === 'stderr' ? 'cc-log-err' : undefined} key={line.id}>
            {line.text}
            {'\n'}
          </span>
        ))}
      </pre>
      <div ref={endRef} />
    </section>
  );
}
