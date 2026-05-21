// Light/dark theme helpers. Colors live as CSS variables in
// src/styles/tokens.css and flip on the `data-theme` attribute on <html>.
// The canonical runtime is the useTheme() hook (src/hooks/useTheme.ts); these
// imperative helpers exist for non-React call sites.

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ho-theme';

export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

/** Stored choice if present, otherwise light (we default to the light theme). */
export function resolveInitialTheme(): Theme {
  return getStoredTheme() ?? 'light';
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

/** Persist + apply. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore storage failures (private mode) */
  }
  applyTheme(theme);
}

export function getCurrentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
