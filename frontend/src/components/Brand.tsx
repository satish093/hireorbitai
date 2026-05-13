import clsx from 'clsx';

/**
 * HireOrbit AI brand mark — kept as the existing "TB"-style monogram for now.
 * Swap the SVG paths when the new logo is ready.
 *
 * Used in the sidebar, login/reset/accept-invitation pages.
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
          <stop offset="0%"  stopColor="#1e3a8a" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#brand-mark-grad)" />
      {/* Stylized TB monogram */}
      <g fill="#ffffff">
        <rect x="13" y="14" width="22" height="6" rx="1.5" />
        <rect x="21" y="14" width="6" height="36" rx="1.5" />
        <rect x="29" y="14" width="6" height="36" rx="1.5" />
        <path d="M35 14 h3 a9 9 0 0 1 0 18 h-3 z" />
        <path d="M35 30 h4 a9 9 0 0 1 0 18 h-4 z" />
      </g>
      {/* Bridge cable */}
      <path d="M14 42 Q32 33 50 42" stroke="#ffffff" strokeWidth="1.6" fill="none" opacity="0.85" />
      {/* AI spark */}
      <g fill="#ffffff" opacity="0.95">
        <path d="M46 18 l0.8 2 2 0.8 -2 0.8 -0.8 2 -0.8 -2 -2 -0.8 2 -0.8z" />
      </g>
    </svg>
  );
}

/**
 * Mark + wordmark + caption. Drop-in for the existing "TB + TalentBridge"
 * blocks in Sidebar / Login / ResetPassword / AcceptInvitation.
 */
export function Brand({
  size = 'md',
  caption = 'AI · OPS PORTAL',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  caption?: string | null;
  className?: string;
}) {
  const dim = size === 'sm' ? 32 : size === 'lg' ? 44 : 36;
  const titleClass =
    size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-lg' : 'text-[15px]';
  return (
    <div className={clsx('inline-flex items-center gap-2.5', className)}>
      <BrandMark size={dim} />
      <div className="leading-tight">
        <div className={clsx('font-semibold tracking-tight', titleClass)}>
          <span className="text-slate-900">Hire</span>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-violet-600">Orbit</span>
          <span className="ml-1 text-[10px] align-middle font-semibold text-white px-1 py-[1px] rounded bg-gradient-to-br from-blue-600 to-violet-600">AI</span>
        </div>
        {caption && (
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">{caption}</div>
        )}
      </div>
    </div>
  );
}
