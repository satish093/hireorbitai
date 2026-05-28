/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // ── New "calm enterprise" design tokens ──────────────────────────────
        // Values live as CSS vars in src/styles/tokens.css and flip on the
        // [data-theme="dark"] attribute. Prefer these in new code.
        bg: 'var(--bg)',
        'bg-elev': 'var(--bg-elev)',
        'bg-sunken': 'var(--bg-sunken)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        hover: 'var(--hover)',
        faint: 'var(--faint)',
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
        warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },

        // ── Tokens shared between new + legacy semantics ─────────────────────
        // `ink` is now the primary text token (DEFAULT) + a secondary (ink-2).
        // The old numeric ink scale (ink-900 etc.) had zero usages.
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)' },
        // `muted` keeps `.foreground` for the ~520 legacy text-muted-foreground
        // usages; `text-muted` (DEFAULT) is the new muted-text token.
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
        // `accent` gains the new purple family (2/soft/fg) while keeping
        // `.foreground` so legacy text-accent-foreground still resolves.
        accent: {
          DEFAULT: 'var(--accent)',
          2: 'var(--accent-2)',
          soft: 'var(--accent-soft)',
          fg: 'var(--accent-fg)',
          foreground: 'var(--accent-foreground)',
        },
        border: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
        ring: 'var(--ring)',

        // ── Legacy "Twitter theme" semantic tokens (aliased in tokens.css) ───
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        input: 'var(--input)',
        card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
        popover: { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
        primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
        secondary: { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
        destructive: { DEFAULT: 'var(--destructive)', foreground: 'var(--destructive-foreground)' },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
        },
        brand: {
          // brand-50 + brand-700 are theme-aware: the chip background and its
          // paired foreground swap on `[data-theme="dark"]` via tokens.css.
          // The other shades (100/200/500/600/900) stay literal — they're
          // used for borders/accents/dots that already read OK in dark mode.
          50: 'var(--brand-soft)',
          100: '#e0e7ff',
          200: '#c7d2fe',
          500: '#6366f1',
          600: '#4f46e5',
          700: 'var(--brand-on-soft)',
          900: '#312e81',
          from: 'var(--brand-from)',
          to: 'var(--brand-to)',
        },
      },
      backgroundImage: {
        'brand-grad': 'linear-gradient(135deg, var(--brand-from), var(--brand-to))',
      },
      boxShadow: {
        btn: 'inset 0 1px 0 rgb(255 255 255 / 0.08), inset 0 -1px 0 rgb(0 0 0 / 0.12), 0 1px 2px rgb(0 0 0 / 0.18), 0 0 0 0.5px rgb(0 0 0 / 0.10)',
        'btn-hover':
          'inset 0 1px 0 rgb(255 255 255 / 0.10), 0 2px 4px rgb(0 0 0 / 0.18), 0 0 0 0.5px rgb(0 0 0 / 0.15)',
        'btn-soft': '0 1px 0 rgb(0 0 0 / 0.02)',
      },
      ringColor: { DEFAULT: 'var(--ring)' },
      // Custom keyframes powering the motion system. Pair each with an entry
      // in `animation` below so it can be used as `animate-fade-in` etc.
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-down': {
          '0%': { opacity: '0', transform: 'translateY(-6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        // Off-screen-to-anchored slide for full side panels (jobright-style).
        // The 8px slide-in-right above is for subtle inline content; this is
        // for panels that need a real "drawer opens from the edge" motion.
        'slide-in-panel': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        pop: {
          '0%': { transform: 'scale(0.94)' },
          '60%': { transform: 'scale(1.04)' },
          '100%': { transform: 'scale(1)' },
        },
        // Skeleton shimmer — translates a gradient highlight across the element.
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        // Slow ambient pulse used on "live" / "online" indicators.
        'pulse-soft': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
        // Subtle sheen for primary CTAs.
        'gradient-pan': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        // Fast page-level entrance — used on <main key={pathname}> so every
        // route change plays a snappy fade+rise instead of the slower fade-in-up.
        'page-enter': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out both',
        'fade-in-up': 'fade-in-up 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'page-enter': 'page-enter 140ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in-down': 'fade-in-down 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-left': 'slide-in-left 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-panel': 'slide-in-panel 280ms cubic-bezier(0.22, 1, 0.36, 1) both',
        pop: 'pop 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        shimmer: 'shimmer 1.4s linear infinite',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
        'gradient-pan': 'gradient-pan 6s ease infinite',
      },
      transitionTimingFunction: {
        // Smooth-out, ideal for state changes — same curve framer-motion's "easeOut" uses.
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
