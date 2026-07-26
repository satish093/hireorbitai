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

// Values match frontend/src/styles/tokens.css EXACTLY. Hex tokens are copied
// verbatim; the web's oklch() tokens are converted to their precise sRGB hex
// via OKLCH→OKLab→linear-sRGB→gamma (not eyeballed). Keep these in lockstep
// with the website — the whole point is that the app looks identical.
export const lightPalette: Palette = {
  bg: '#fafbfc', // --bg
  bgElev: '#ffffff', // --bg-elev
  bgSunken: '#f3f5f8', // --bg-sunken  oklch(0.97 0.004 250)
  surface: '#ffffff', // --surface
  surface2: '#f8fafd', // --surface-2  oklch(0.985 0.004 250)
  hover: '#eff2f5', // --hover       oklch(0.96 0.005 250)
  border: '#e2e5e8', // --border      oklch(0.92 0.006 250)
  borderStrong: '#cdd1d6', // --border-strong oklch(0.86 0.008 250)
  ink: '#13161c', // --ink
  ink2: '#4f535b', // --ink-2
  muted: '#5d6066', // --muted
  faint: '#9b9fa5', // --faint       oklch(0.7 0.01 260)
  accent: '#5053e9', // --accent      oklch(0.535 0.22 275)
  accent2: '#4d34d5', // --accent-2    oklch(0.47 0.23 280)
  accentSoft: '#eaf1ff', // --accent-soft oklch(0.96 0.035 275)
  accentFg: '#ffffff', // --accent-fg
  brandFrom: '#2563eb', // --brand-from
  brandTo: '#7c3aed', // --brand-to
  brandSoft: '#eef2ff', // --brand-soft
  brandOnSoft: '#4338ca', // --brand-on-soft
  brandSoftBorder: '#e0e7ff', // --brand-soft-border
  success: '#2e7a42', // --success
  successSoft: '#dcf7e1', // --success-soft oklch(0.95 0.04 150)
  warn: '#d49838', // --warn        oklch(0.72 0.13 75)
  warnSoft: '#ffefcd', // --warn-soft   oklch(0.96 0.05 80)
  danger: '#c9222b', // --danger      oklch(0.54 0.2 25)
  dangerSoft: '#ffe8e4', // --danger-soft oklch(0.96 0.04 25)
  ring: 'rgba(80, 83, 233, 0.35)', // --ring oklch(0.535 0.22 275 / 0.35)
  scrim: 'rgba(15, 23, 42, 0.45)', // modal backdrop (RN has no CSS backdrop-filter)
};

// Matches [data-theme='dark'] in tokens.css. These are the values the website
// actually renders in dark mode — the previous mobile dark palette was
// hand-guessed and noticeably lighter/bluer than the site.
export const darkPalette: Palette = {
  bg: '#080b10', // --bg
  bgElev: '#0e1217', // --bg-elev
  bgSunken: '#04060a', // --bg-sunken
  surface: '#12151a', // --surface
  surface2: '#171b20', // --surface-2
  hover: '#1f2329', // --hover
  border: '#272c32', // --border
  borderStrong: '#383d46', // --border-strong
  ink: '#bbbec3', // --ink
  ink2: '#8b8f97', // --ink-2
  muted: '#8c9098', // --muted
  faint: '#84878d', // --faint
  accent: '#7887ff', // --accent
  accent2: '#9698ff', // --accent-2
  accentSoft: '#1c1c62', // --accent-soft
  accentFg: '#ffffff', // --accent-fg
  brandFrom: '#3b82f6', // --brand-from
  brandTo: '#8b5cf6', // --brand-to
  brandSoft: 'rgba(99, 102, 241, 0.15)', // --brand-soft  rgb(99 102 241 / .15)
  brandOnSoft: '#a5b4fc', // --brand-on-soft
  brandSoftBorder: 'rgba(99, 102, 241, 0.3)', // --brand-soft-border
  success: '#4aa865', // --success
  successSoft: '#012d10', // --success-soft
  warn: '#d49838', // --warn
  warnSoft: '#3f2100', // --warn-soft
  danger: '#f06861', // --danger
  dangerSoft: '#4c1010', // --danger-soft
  ring: 'rgba(120, 135, 255, 0.5)', // --ring
  scrim: 'rgba(0, 0, 0, 0.6)', // modal backdrop
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
