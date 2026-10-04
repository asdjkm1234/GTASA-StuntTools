import { APP_NAME } from '../shared/app-info';
import { About } from './about';
import { RunLog } from './run-log';
import { Status } from './status';
import { Step } from './step';
import { useWizard } from './use-wizard';

export function App(): React.ReactElement {
  const wizard = useWizard();

  return (
    <main className="cc-shell">
      <header className="cc-header">
        <h1 className="cc-title">{APP_NAME}</h1>
        {/* The scope, stated as what the tool does — not as a warning and not as an apology (plan 001). */}
        <p className="cc-scope">
          This puts your modded cars into the game&apos;s cutscenes. Your gameplay cars stay whatever you have
          installed.
        </p>
      </header>

      <Step
        disabled={wizard.busy}
        hint="The folder with gta_sa.exe. A modded game is fine."
        number={1}
        onPick={() => void wizard.pick('game')}
        path={wizard.game.path}
        report={wizard.game.report}
        title="Pick your game"
      />

      <Step
        disabled={wizard.busy || !wizard.game.path || wizard.game.report?.level === 'error'}
        hint="One subfolder per car, each holding its .dff and .txd."
        number={2}
        onPick={() => void wizard.pick('cars')}
        path={wizard.cars.path}
        report={wizard.cars.report}
        title="Pick your cars"
      />

      <Step
        disabled={wizard.busy || !wizard.game.path || wizard.game.report?.level === 'error'}
        hint="An empty folder. Nothing is written into your game."
        number={3}
        onPick={() => void wizard.pick('out')}
        path={wizard.out.path}
        report={wizard.out.report}
        title="Pick where to put the result"
      />

      <div className="cc-actions">
        <button
          className="cc-button cc-button-go"
          disabled={!wizard.canConvert}
          onClick={() => void wizard.convert()}
          type="button"
        >
          {wizard.busy ? 'Working…' : 'Convert'}
        </button>
        {wizard.result?.code === 0 ? (
          <button className="cc-button" onClick={wizard.openOut} type="button">
            Open the output folder
          </button>
        ) : undefined}
        {wizard.result && !wizard.busy ? (
          <button className="cc-button" onClick={wizard.quit} type="button">
            Exit
          </button>
        ) : undefined}
      </div>

      <Status busy={wizard.busy} result={wizard.result} />
      <RunLog lines={wizard.lines} />
      <About />
    </main>
  );
}
