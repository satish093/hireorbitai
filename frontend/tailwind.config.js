/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#312e81',
        },
        ink: {
          900: '#0f172a',
          700: '#334155',
          500: '#64748b',
          300: '#cbd5e1',
        },
      },
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
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out both',
        'fade-in-up': 'fade-in-up 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
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
