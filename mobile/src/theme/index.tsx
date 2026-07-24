/**
 * Theme provider — light / dark / follow-system, persisted across launches.
 *
 * Mirrors frontend/src/hooks/useTheme.ts: three modes, with 'system' as the
 * default so the app matches the OS appearance out of the box.
 *
 * The preference lives in AsyncStorage, not SecureStore — it isn't a secret,
 * and SecureStore reads are comparatively slow (they hit the Keychain).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  darkPalette,
  lightPalette,
  type Palette,
  radius,
  spacing,
  fontSize,
  fontWeight,
  controlHeight,
  minTouchTarget,
} from './tokens';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'hireorbitai.theme';

export interface Theme {
  colors: Palette;
  /** Resolved appearance — 'system' is already collapsed to light or dark. */
  scheme: 'light' | 'dark';
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: typeof fontSize;
  fontWeight: typeof fontWeight;
  controlHeight: typeof controlHeight;
  minTouchTarget: typeof minTouchTarget;
}

const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && (saved === 'light' || saved === 'dark' || saved === 'system')) {
          setModeState(saved);
        }
      } catch {
        /* keep the default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: 'light' | 'dark' =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<Theme>(
    () => ({
      colors: scheme === 'dark' ? darkPalette : lightPalette,
      scheme,
      mode,
      setMode,
      spacing,
      radius,
      fontSize,
      fontWeight,
      controlHeight,
      minTouchTarget,
    }),
    [scheme, mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be inside <ThemeProvider>');
  return ctx;
}

export * from './tokens';
