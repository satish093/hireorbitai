/**
 * Design tokens — the "calm enterprise" system, ported from
 * frontend/src/styles/tokens.css.
 *
 * The web tokens are authored in oklch. React Native's style engine only
 * understands sRGB, so every oklch value below has been converted to its hex
 * equivalent. The hex values the web file had already pinned (--ink, --muted,
 * --brand-soft, --success, …) are carried over verbatim — those were chosen for
 * measured WCAG contrast ratios and must not drift.
 *
 * Keep this file in sync with tokens.css. If a colour changes on the web, it
 * changes here too; there is no build-time link between them.
 */

export interface Palette {
  bg: string;
  bgElev: string;
  bgSunken: string;
  surface: string;
  surface2: string;
  hover: string;
  border: string;
  borderStrong: string;
  ink: string;
  ink2: string;
  muted: string;
  faint: string;
  accent: string;
  accent2: string;
  accentSoft: string;
  accentFg: string;
  brandFrom: string;
  brandTo: string;
  brandSoft: string;
  brandOnSoft: string;
  brandSoftBorder: string;
  success: string;
  successSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  /** Focus/selection ring. RN has no `oklch(... / .35)`, so this is rgba. */
  ring: string;
  /** Scrim behind modals and drawers. */
  scrim: string;
}

export const lightPalette: Palette = {
  bg: '#fafbfc',
  bgElev: '#ffffff',
  bgSunken: '#f4f5f7',
  surface: '#ffffff',
  surface2: '#fafbfc',
  hover: '#f1f2f5',
  border: '#e5e7ec',
  borderStrong: '#d1d4dc',
  ink: '#13161c',
  ink2: '#4f535b',
  muted: '#5d6066',
  faint: '#9ca0aa',
  accent: '#5b3df5',
  accent2: '#4b21de',
  accentSoft: '#eeeafe',
  accentFg: '#ffffff',
  brandFrom: '#2563eb',
  brandTo: '#7c3aed',
  brandSoft: '#eef2ff',
  brandOnSoft: '#4338ca',
  brandSoftBorder: '#e0e7ff',
  success: '#2e7a42',
  successSoft: '#dcf7e1',
  warn: '#b7791f',
  warnSoft: '#fdf1d9',
  danger: '#c92a2a',
  dangerSoft: '#fde8e6',
  ring: 'rgba(91, 61, 245, 0.35)',
  scrim: 'rgba(15, 23, 42, 0.45)',
};

export const darkPalette: Palette = {
  bg: '#0b0e14',
  bgElev: '#131720',
  bgSunken: '#080a0f',
  surface: '#131720',
  surface2: '#181d28',
  hover: '#1e2430',
  border: '#252b38',
  borderStrong: '#343c4c',
  ink: '#f2f4f8',
  ink2: '#c2c7d0',
  muted: '#9aa1ad',
  faint: '#6c7382',
  accent: '#8b73ff',
  accent2: '#a691ff',
  accentSoft: '#211c3d',
  accentFg: '#0b0e14',
  brandFrom: '#60a5fa',
  brandTo: '#a78bfa',
  brandSoft: '#1c1f3a',
  brandOnSoft: '#a5b4fc',
  brandSoftBorder: '#2a2f52',
  success: '#5fd07f',
  successSoft: '#12261a',
  warn: '#e0a545',
  warnSoft: '#2a1f0d',
  danger: '#f47171',
  dangerSoft: '#2c1416',
  ring: 'rgba(139, 115, 255, 0.4)',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

/** 4px base scale — matches Tailwind's spacing rhythm used on the web. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

/** Matches the web's rounded-lg / rounded-xl / rounded-2xl usage. */
export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  '2xl': 18,
  pill: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 22,
  '2xl': 28,
  '3xl': 34,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Shared control height.
 *
 * The web pins Button (md), FormInput and SelectInput to `h-9` (36px) so a
 * toolbar row is pixel-aligned. 36px is below the 44px minimum touch target
 * that .claude/rules/frontend-responsive.md requires on mobile, so the phone
 * equivalent is 48 — visually the same family, correctly sized for a thumb.
 */
export const controlHeight = 48;

/** Minimum tappable size. Never ship an interactive element smaller. */
export const minTouchTarget = 44;
