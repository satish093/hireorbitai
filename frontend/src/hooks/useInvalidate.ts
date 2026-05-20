import { useEffect, useRef } from 'react';

/**
 * Tiny in-memory pub/sub for cross-page cache invalidation.
 *
 * The admin surface has three views that read overlapping account data —
 * AdminUsers, AdminUserDetail, DeactivatedAccounts. When one of them
 * mutates a user (status change, password reset, etc.) the others should
 * refetch so the screens don't drift apart.
 *
 * We don't use react-query, so this is the lightest possible substitute:
 * a typed event channel keyed by domain ("users", "tasks", …). Each page
 * subscribes via useInvalidationListener and returns a refetch function;
 * the mutator calls invalidate('users') and every subscriber fires.
 *
 * Channels are decoupled — adding a new one is just a string literal.
 *
 * Bumping the version on every notify means listeners can pass a value
 * straight to a useEffect dependency, instead of writing their own
 * "have I handled this event?" flag.
 */

type Channel = 'users' | 'tasks' | 'jobs' | 'applications' | 'invitations' | 'feature-flags';

interface ChannelState {
  // Monotonic counter; incremented on every notify(). Subscribers read
  // .current to know "I last saw this many invalidations".
  version: number;
  listeners: Set<(version: number) => void>;
}

const channels: Map<Channel, ChannelState> = new Map();

function ensureChannel(name: Channel): ChannelState {
  let c = channels.get(name);
  if (!c) {
    c = { version: 0, listeners: new Set() };
    channels.set(name, c);
  }
  return c;
}

/**
 * Fire from any mutation site. Every page that subscribed to this channel
 * runs its onInvalidate callback synchronously.
 */
export function invalidate(channel: Channel): void {
  const c = ensureChannel(channel);
  c.version += 1;
  // Clone so a listener that synchronously re-subscribes (rare but
  // possible during rerenders) doesn't mutate the iteration target.
  for (const fn of Array.from(c.listeners)) {
    try {
      fn(c.version);
    } catch {
      /* listener errors don't block siblings */
    }
  }
}

/**
 * Subscribe a callback to a channel. The callback fires once per invalidate()
 * call. Cleanup unsubscribes automatically on unmount.
 *
 * Note: the callback is captured at mount time. If you need to read fresh
 * state from inside it, use a ref or pull the data via the function args.
 */
export function useInvalidationListener(channel: Channel, onInvalidate: () => void): void {
  // Latest-callback ref so consumers don't need to memoize, but the
  // subscription itself only needs to mount/unmount once.
  const fnRef = useRef(onInvalidate);
  useEffect(() => {
    fnRef.current = onInvalidate;
  });

  useEffect(() => {
    const c = ensureChannel(channel);
    const handler = () => fnRef.current();
    c.listeners.add(handler);
    return () => {
      c.listeners.delete(handler);
    };
  }, [channel]);
}
