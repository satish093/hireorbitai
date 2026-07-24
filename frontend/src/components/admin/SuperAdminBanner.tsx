import { IconShield } from '../Icons';

/**
 * SuperAdminBanner — shown at the top of admin-management pages when the
 * current viewer is SUPER_ADMIN. Quiet, not loud: a slim dark bar that reads
 * "full access" without calling attention to itself on every page.
 *
 * Intentionally avoids neon colors or urgent styling — the goal is context
 * ("you see everything here") not alarm. Non-SUPER_ADMIN admins never see it.
 */
export function SuperAdminBanner() {
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl mb-4 text-[12.5px] font-semibold"
      style={{
        background: 'linear-gradient(120deg, #1e293b, #0f172a)',
        border: '1px solid rgba(255,255,255,0.07)',
        color: 'rgba(255,255,255,0.8)',
      }}
    >
      <IconShield
        size={14}
        strokeWidth={2}
        style={{ color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}
      />
      <span>Full access — you can view and edit every account, including other admins.</span>
      {/* Status dot */}
      <span
        className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full"
        style={{
          background: '#34d399',
          boxShadow: '0 0 0 3px rgba(52,211,153,0.2)',
        }}
      />
    </div>
  );
}
