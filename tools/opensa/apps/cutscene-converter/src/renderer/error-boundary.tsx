import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A class, and the one place in this app that may be: React has no hook form of an error boundary, and
 * without one a thrown render leaves an EMPTY page — the black window that reads as a crashed app and says
 * nothing about what broke. Everything below it stays functional.
 */
export class ErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly message?: string }> {
  public override state: { readonly message?: string } = {};

  public static getDerivedStateFromError(error: unknown): { readonly message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  public override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- leaving a trace in devtools IS this method's job
    console.error('cutscene-converter: the window failed', error, info.componentStack);
  }

  public override render(): ReactNode {
    if (this.state.message === undefined) {
      return this.props.children;
    }

    return (
      <main className="cc-shell">
        <h1 className="cc-title">Cutscene Converter</h1>
        <p className="cc-status cc-status-failed">The window failed: {this.state.message}</p>
        <p className="cc-scope">
          Any conversion that had already finished is still on disk in your output folder. Restart the app, and send
          this message with the build shown below.
        </p>
      </main>
    );
  }
}
