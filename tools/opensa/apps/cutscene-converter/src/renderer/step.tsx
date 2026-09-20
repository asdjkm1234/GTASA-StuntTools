import type { VerdictReport } from '@opensa/validation';

import { VerdictList } from './verdict-list';

interface StepProps {
  readonly disabled: boolean;
  readonly hint: string;
  readonly number: number;
  readonly onPick: () => void;
  readonly path?: string;
  readonly report?: VerdictReport;
  readonly title: string;
}

export function Step({ disabled, hint, number, onPick, path, report, title }: StepProps): React.ReactElement {
  return (
    <section className={`cc-step${disabled ? ' cc-step-disabled' : ''}`}>
      <header className="cc-step-head">
        <span className="cc-step-number">{number}</span>
        <div className="cc-step-text">
          <h2 className="cc-step-title">{title}</h2>
          <p className="cc-step-hint">{hint}</p>
        </div>
        <button className="cc-button" disabled={disabled} onClick={onPick} type="button">
          {path ? 'Change…' : 'Choose…'}
        </button>
      </header>
      {path ? <p className="cc-step-path">{path}</p> : undefined}
      <VerdictList report={report} />
    </section>
  );
}
