import clsx from 'clsx';

/**
 * HireOrbit AI brand mark — a planet ringed by an orbit + AI spark.
 *
 * Used in the sidebar, login / reset / accept-invitation pages, and any other
 * "splash" surface that needs the company mark. The design is intentionally
 * abstract (no monogram) so we don't need to redraw it if the wordmark
 * changes.
 */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={clsx('shrink-0 rounded-md', className)}
      aria-label="HireOrbit AI"
      role="img"
    >
      <defs>
        <linearGradient id="brand-mark-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#brand-mark-grad)" />
      {/* Orbit ring — slight diagonal so the planet looks like it's moving */}
      <ellipse
        cx="32"
        cy="34"
        rx="22"
        ry="10"
        transform="rotate(-22 32 34)"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        opacity="0.85"
      />
      {/* Planet body */}
      <circle cx="32" cy="34" r="9" fill="#ffffff" />
      <circle cx="32" cy="34" r="9" fill="url(#brand-mark-grad)" opacity="0.35" />
      {/* AI spark */}
      <g fill="#ffffff" opacity="0.95">
        <path d="M48 16 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2z" />
        <circle cx="53" cy="11" r="1.1" />
      </g>
    </svg>
  );
}

/**
 * Mark + wordmark + optional caption. Drop-in for the "HireOrbit AI" blocks
 * in Sidebar / Login / ResetPassword / AcceptInvitation. Pass `caption={null}`
 * to render just the mark + wordmark with no subtitle.
 */
export function Brand({
  size = 'md',
  caption,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  caption?: string | null;
  className?: string;
}) {
  const dim = size === 'sm' ? 32 : size === 'lg' ? 44 : 36;
  const titleClass = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-lg' : 'text-[15px]';
  return (
    <div className={clsx('inline-flex items-center gap-2.5', className)}>
      <BrandMark size={dim} />
      <div className="leading-tight">
        <div className={clsx('font-semibold tracking-tight', titleClass)}>
          <span className="text-ink">Hire</span>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-violet-600">
            Orbit
          </span>
          <span className="ml-1 text-[10px] align-middle font-semibold text-white px-1 py-[1px] rounded bg-gradient-to-br from-blue-600 to-violet-600">
            AI
          </span>
        </div>
        {caption && (
          <div className="text-[10px] text-muted uppercase tracking-widest">{caption}</div>
        )}
      </div>
    </div>
  );
}
