import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { FeatureFlagsProvider } from './hooks/useFeatureFlags';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScrollToTop } from './components/ScrollToTop';
import { ViewTransition } from './components/ViewTransition';
import { config } from './config/env';
// Validate env vars at module load — throws synchronously if anything is
// missing/malformed so we surface a clean error before React even mounts.
import './config/env';
import './styles/tokens.css';
import './index.css';

// Recover from stale chunk loads after a deploy. When a lazily-imported route
// chunk 404s — its content-hash was replaced by a newer build and the old file
// removed by `rsync --delete` — Vite dispatches `vite:preloadError`. Reload once
// to fetch the fresh index.html + correct chunk hashes. The time guard prevents
// an infinite reload loop if the asset is genuinely unreachable, while still
// allowing recovery across multiple deploys in one long-lived session.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const KEY = 'vite-preload-reload-at';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem(KEY, String(Date.now()));
  window.location.reload();
});

// DEV-ONLY toolbar. The `VITE_DEV_TOOLS === 'true'` guard is statically
// evaluated by Vite — in a production build the flag is unset, so the condition
// is a constant `false`, the dynamic import lands in a dead branch, and the
// entire dev chunk (DevToolbar + devSession + DevPanel) is dropped from the
// bundle. The dev deploy (Render) builds with VITE_DEV_TOOLS=true, so it's kept.
const DevToolbar =
  import.meta.env.VITE_DEV_TOOLS === 'true'
    ? lazy(() => import('./dev/DevToolbar').then((m) => ({ default: m.DevToolbar })))
    : () => null;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ViewTransition />
        <ScrollToTop />
        <AuthProvider>
          <FeatureFlagsProvider>
            <App />
            {config.isDevTools && (
              <Suspense fallback={null}>
                <DevToolbar />
              </Suspense>
            )}
            <Toaster
              position="top-right"
              gutter={10}
              toastOptions={{
                duration: 4000,
                // Match the rest of the app's design language: rounded-xl,
                // ring-1 elevation, slate text. react-hot-toast handles the
                // enter/exit motion itself with a default slide+fade.
                style: {
                  borderRadius: '12px',
                  background: 'var(--popover)',
                  color: 'var(--popover-foreground)',
                  boxShadow:
                    '0 1px 0 rgba(15, 23, 42, 0.04), 0 8px 24px -8px rgba(15, 23, 42, 0.18)',
                  border: '1px solid var(--border)',
                  padding: '10px 14px',
                  fontSize: '13.5px',
                  fontWeight: 500,
                  maxWidth: '420px',
                },
                success: { iconTheme: { primary: '#059669', secondary: '#ecfdf5' } },
                error: { iconTheme: { primary: '#dc2626', secondary: '#fef2f2' } },
              }}
            />
          </FeatureFlagsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
