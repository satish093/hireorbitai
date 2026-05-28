/**
 * Full-viewport loading gate used by Suspense fallbacks + the auth / feature-
 * flag bootstrap. This is the FIRST UI a user can see while the app is mounting,
 * which means it sometimes paints BEFORE Vite has injected the Tailwind CSS
 * bundle. If we relied on Tailwind alone, the "Loading…" text would fall back
 * to default block layout (top-left of the viewport) on that first paint.
 *
 * Defenses:
 *   1. Inline styles for the centering + sizing — they apply even when no
 *      stylesheet is mounted yet.
 *   2. A scoped @keyframes injected via a `<style>` tag so the spinner animates
 *      without any external CSS dependency.
 *   3. Tailwind classes are kept too — they make the colours match the rest of
 *      the app once the stylesheet finishes loading.
 *
 * Keep this component dependency-free. It must work the moment React mounts.
 */

const SPIN_KEYFRAME = `@keyframes ho-loading-spin { to { transform: rotate(360deg); } }`;

export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="min-h-dvh flex items-center justify-center text-muted text-sm bg-bg"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      <style>{SPIN_KEYFRAME}</style>
      <div
        className="flex flex-col items-center gap-3"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <div
          aria-hidden="true"
          className="rounded-full"
          style={{
            height: '2rem',
            width: '2rem',
            borderRadius: '9999px',
            // Soft ring, brand-coloured top → reads as a spinner. Hex fallbacks
            // match the brand-600 / border tokens so the visual is consistent
            // whether or not Tailwind has loaded.
            border: '2px solid rgba(99, 102, 241, 0.18)',
            borderTopColor: '#4f46e5',
            animation: 'ho-loading-spin 0.8s linear infinite',
          }}
        />
        <span
          style={{
            fontSize: '0.875rem',
            color: '#64748b',
            fontFamily:
              'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
