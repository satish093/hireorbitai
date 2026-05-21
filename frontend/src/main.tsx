import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { FeatureFlagsProvider } from './hooks/useFeatureFlags';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScrollToTop } from './components/ScrollToTop';
// Validate env vars at module load — throws synchronously if anything is
// missing/malformed so we surface a clean error before React even mounts.
import './config/env';
import './styles/tokens.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ScrollToTop />
        <AuthProvider>
          <FeatureFlagsProvider>
            <App />
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
