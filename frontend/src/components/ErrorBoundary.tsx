import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional fallback override. Defaults to the standard "Something went wrong" card. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches synchronous render errors and effects that
 * throw during the commit phase. Async errors (promises in useEffect, fetch
 * rejections) still need their own try/catch — they don't bubble through
 * React's error boundary by design.
 *
 * Place this in main.tsx, wrapping `<App />`, so a single bad render doesn't
 * blank the entire page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] caught render error:', error, info.componentStack);
    // If you wire Sentry/etc. later, report here:
    //   Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-7 text-center animate-fade-in-up">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-600 text-2xl mx-auto mb-3">
            ⚠
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">
            Something went wrong
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            The app hit an unexpected error and stopped rendering this view.
          </p>
          <pre className="mt-3 text-[11px] text-left text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 overflow-x-auto max-h-32">
            {error.message}
          </pre>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={this.reset}
              className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg press"
            >
              Try again
            </button>
            <button
              onClick={() => {
                window.location.href = '/';
              }}
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg press"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
