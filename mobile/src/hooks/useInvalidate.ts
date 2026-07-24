/**
 * Cross-screen invalidation channel.
 *
 * Port of frontend/src/hooks/useInvalidate.ts. After a mutation, call
 * `invalidate('tasks')`; any mounted screen listening on that channel refetches.
 *
 * This matters more on mobile than on the web. React Navigation keeps previous
 * screens MOUNTED underneath the current one, so a list you edited two screens
 * back is still alive and still showing stale rows when you pop back to it.
 * The web could sometimes get away with a remount on navigation; here you
 * cannot.
 *
 * Use this instead of forcing a navigation reset to refresh a list.
 */

import { useEffect, useRef } from 'react';

export type InvalidationChannel =
  | 'tasks'
  | 'messages'
  | 'jobs'
  | 'applications'
  | 'interviews'
  | 'consultants'
  | 'recruiters'
  | 'managers'
  | 'reminders'
  | 'resumes'
  | 'vendors'
  | 'clients'
  | 'invoices'
  | 'training'
  | 'users'
  | 'user-groups'
  | 'invitations'
  | 'feature-flags'
  | 'reports'
  | 'notifications';

type Listener = () => void;

const channels = new Map<string, Set<Listener>>();

/** Fire an invalidation. Every listener on the channel refetches. */
export function invalidate(channel: InvalidationChannel): void {
  const set = channels.get(channel);
  if (!set) return;
  for (const l of [...set]) {
    try {
      l();
    } catch {
      /* one bad listener must not block the rest */
    }
  }
}

/**
 * Subscribe to a channel.
 *
 * The handler is held in a ref, so a caller may pass an inline arrow function
 * without resubscribing on every render.
 */
export function useInvalidationListener(channel: InvalidationChannel, handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const listener: Listener = () => ref.current();
    let set = channels.get(channel);
    if (!set) {
      set = new Set();
      channels.set(channel, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) channels.delete(channel);
    };
  }, [channel]);
}
