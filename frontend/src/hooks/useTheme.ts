import { useEffect, useState } from 'react';

// Light/dark theme runtime. Colors live as CSS variables in
// src/styles/tokens.css and flip on the `data-theme` attribute set here. The
// pre-paint inline script in index.html sets the attribute before React mounts
// (no flash-of-wrong-theme); this hook keeps it in sync at runtime.

export type Theme = 'light' | 'dark';
const KEY = 'ho-theme';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    return (
      (localStorage.getItem(KEY) as Theme | null) ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    );
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore storage failures (private mode) */
    }
  }, [theme]);

  return { theme, setTheme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}
