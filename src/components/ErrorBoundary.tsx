import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * A last resort, so an unexpected failure shows something actionable rather
 * than a blank page. Everything happens client-side here, so there is no
 * server log to fall back on — the message on screen is all the user gets.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Sticker Maker hit an unexpected error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="app">
        <div className="app__crash" role="alert" data-testid="crash">
          <h1 className="app__title">Something went wrong</h1>
          <p>
            The editor hit an error it could not recover from. Reloading starts again from a clean
            slate; nothing was uploaded anywhere, so nothing is lost but the current edit.
          </p>
          <pre className="app__crash-detail">{error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}
