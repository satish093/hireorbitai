import clsx from 'clsx';

export type PresenceStatus = 'online' | 'idle' | 'offline';

/**
 * Map a heartbeat timestamp to one of three buckets:
 *   - online: seen in the last ~2 minutes (matches the heartbeat cadence + slack)
 *   - idle:   seen in the last 15 minutes
 *   - offline: older or never seen
 */
export function presenceStatusFromLastSeen(lastSeenAt: string | null | undefined): PresenceStatus {
  if (!lastSeenAt) return 'offline';
  const age = Date.now() - new Date(lastSeenAt).getTime();
  if (age < 2 * 60 * 1000) return 'online';
  if (age < 15 * 60 * 1000) return 'idle';
  return 'offline';
}

export function presenceLabel(s: PresenceStatus): string {
  return s === 'online' ? 'Online' : s === 'idle' ? 'Idle' : 'Offline';
}

const COLOR: Record<PresenceStatus, string> = {
  online: 'bg-emerald-500',
  idle: 'bg-amber-400',
  offline: 'bg-muted-foreground',
};

/**
 * Small status pip — meant to be overlaid on an Avatar via absolute positioning.
 *
 * Usage:
 *   <div className="relative">
 *     <Avatar … />
 *     <PresenceDot lastSeenAt={p.last_seen_at} className="absolute -bottom-0.5 -right-0.5" />
 *   </div>
 */
export function PresenceDot({
  lastSeenAt,
  size = 10,
  className,
  title,
}: {
  lastSeenAt: string | null | undefined;
  size?: number;
  className?: string;
  title?: string;
}) {
  const status = presenceStatusFromLastSeen(lastSeenAt);
  return (
    <span
      className={clsx(
        'relative inline-block rounded-full ring-2 ring-card',
        COLOR[status],
        className,
      )}
      style={{ width: size, height: size }}
      title={title ?? presenceLabel(status)}
      aria-label={presenceLabel(status)}
    >
      {/* Soft ping ripple — only for the "online" state to draw the eye. */}
      {status === 'online' && (
        <span
          className={clsx('absolute inset-0 rounded-full opacity-60 animate-ping', COLOR[status])}
        />
      )}
    </span>
  );
}

/** Inline pill used in headers ("● Online", "● Idle", "● Offline"). */
export function PresencePill({ lastSeenAt }: { lastSeenAt: string | null | undefined }) {
  const status = presenceStatusFromLastSeen(lastSeenAt);
  const tone =
    status === 'online'
      ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-100 dark:border-emerald-500/20'
      : status === 'idle'
        ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border-amber-100 dark:border-amber-500/20'
        : 'text-muted-foreground bg-muted border-border';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border',
        tone,
      )}
    >
      <span
        className={clsx(
          'w-1.5 h-1.5 rounded-full',
          COLOR[status],
          status === 'online' && 'animate-pulse-soft',
        )}
      />
      {presenceLabel(status)}
    </span>
  );
}
