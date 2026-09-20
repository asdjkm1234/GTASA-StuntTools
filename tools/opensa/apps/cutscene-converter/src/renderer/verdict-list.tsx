import type { Verdict, VerdictReport } from '@opensa/validation';

export function VerdictList({ report }: { report: undefined | VerdictReport }): React.ReactElement | undefined {
  if (!report || report.verdicts.length === 0) {
    return undefined;
  }

  return (
    <ul className="cc-verdicts">
      {/* A code repeats (seven missing files are seven `path.entry-missing`), the detail is what tells
          them apart. */}
      {report.verdicts.map((verdict) => (
        <VerdictRow key={`${verdict.code}:${verdict.detail ?? ''}`} verdict={verdict} />
      ))}
    </ul>
  );
}

/**
 * A verdict is shown as its message plus its fix — the fix is the reason the verdict type exists, so it is
 * never the thing that gets dropped for space. `detail` is the long form and stays collapsed.
 */
function VerdictRow({ verdict }: { verdict: Verdict }): React.ReactElement {
  const fix = verdict.level === 'ok' ? undefined : verdict.fix;

  return (
    <li className={`cc-verdict cc-verdict-${verdict.level}`}>
      <span className="cc-verdict-message">{verdict.message}</span>
      {fix ? <span className="cc-verdict-fix">{fix}</span> : undefined}
      {verdict.detail ? <pre className="cc-verdict-detail">{verdict.detail}</pre> : undefined}
    </li>
  );
}
