import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional fallback override. Defaults to the standard "Something went wrong" card. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
  reloading: boolean;
}

/**
 * A failed dynamic import — the #1 symptom of a deploy that replaced the hashed
 * chunk a still-open tab is trying to lazy-load. These should silently reload to
 * the fresh build, NOT render a scary error card.
 */
function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  const m = `${error.name} ${error.message}`;
  return (
    /ChunkLoadError/i.test(m) ||
    /Loading (chunk|CSS chunk) [\w-]+ failed/i.test(m) ||
    /Failed to fetch dynamically imported module/i.test(m) ||
    /error loading dynamically imported module/i.test(m) ||
    /Importing a module script failed/i.test(m)
  );
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
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, reloading: false };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Stale chunk after a deploy → reload once to pick up the fresh build. The
    // time guard prevents a reload loop if the asset is genuinely unreachable.
    if (isChunkLoadError(error)) {
      const KEY = 'vite-preload-reload-at'; // shared with main.tsx's vite:preloadError handler
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        this.setState({ reloading: true });
        window.location.reload();
        return;
      }
    }
    console.error('[ErrorBoundary] caught render error:', error, info.componentStack);
    // If you wire Sentry/etc. later, report here:
    //   Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } });
  }

  reset = () => this.setState({ error: null, reloading: false });

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    // Stale-chunk / new-deploy case: friendly "updating" screen + manual reload,
    // never the scary error card (a reload is usually already in flight).
    if (reloading || isChunkLoadError(error)) {
      return (
        <div className="min-h-dvh bg-hover flex items-center justify-center p-6">
          <div className="max-w-sm w-full bg-surface border border-border rounded-2xl shadow-sm p-7 text-center animate-fade-in-up">
            <div className="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-500/15 flex items-center justify-center text-brand-700 dark:text-brand-300 text-2xl mx-auto mb-3">
              ⟳
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              Updating to the latest version
            </h1>
            <p className="text-sm text-muted mt-1">
              A new version of the app was just released. Reloading to pick it up…
            </p>
            <div className="mt-4">
              <button
                onClick={() => window.location.reload()}
                className="bg-ink hover:opacity-90 text-bg text-sm font-medium px-4 py-2 rounded-lg press"
              >
                Reload now
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-dvh bg-hover flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-surface border border-border rounded-2xl shadow-sm p-7 text-center animate-fade-in-up">
          <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-500/15 flex items-center justify-center text-red-600 dark:text-red-400 text-2xl mx-auto mb-3">
            ⚠
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Something went wrong</h1>
          <p className="text-sm text-muted mt-1">
            The app hit an unexpected error and stopped rendering this view.
          </p>
          <pre className="mt-3 text-[11px] text-left text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/15 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2 overflow-x-auto max-h-32">
            {error.message}
          </pre>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={this.reset}
              className="bg-ink hover:opacity-90 text-bg text-sm font-medium px-4 py-2 rounded-lg press"
            >
              Try again
            </button>
            <button
              onClick={() => {
                window.location.href = '/';
              }}
              className="bg-surface border border-border hover:bg-hover text-ink text-sm font-medium px-4 py-2 rounded-lg press"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
