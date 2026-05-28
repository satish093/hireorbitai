/**
 * Inline opt-in for Discord-style inbox notifications.
 *
 * Renders a small icon button that cycles permission + sound state:
 *
 *   1. Default (permission='default')  → bell-outline icon, click prompts
 *      the browser for permission. After grant, sound also flips ON
 *      (matches Discord's first-run behaviour).
 *   2. Granted, sound ON              → solid bell icon. Click mutes sound.
 *   3. Granted, sound OFF             → bell-off icon. Click unmutes.
 *   4. Denied                         → bell-off (muted) icon with a
 *      title-tooltip explaining how to re-enable from the browser
 *      settings (we can't programmatically re-prompt once denied).
 *   5. Unsupported                    → nothing rendered.
 *
 * No persistent UI noise — the button is one 28×28 chip. The actual
 * notification + sound delivery lives in useInboxNotifications.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  getNotificationPermission,
  getNotifySoundPref,
  requestNotificationPermission,
  setNotifySoundPref,
} from '../hooks/useInboxNotifications';

type State =
  | { kind: 'unsupported' }
  | { kind: 'default' }
  | { kind: 'denied' }
  | { kind: 'granted'; soundOn: boolean };

function readState(): State {
  const perm = getNotificationPermission();
  if (perm === 'unsupported') return { kind: 'unsupported' };
  if (perm === 'default') return { kind: 'default' };
  if (perm === 'denied') return { kind: 'denied' };
  return { kind: 'granted', soundOn: getNotifySoundPref() };
}

export function NotificationToggle() {
  const [state, setState] = useState<State>(() => readState());

  // Re-read on mount in case the user changed browser permission while we
  // were unmounted (e.g. from the site-info popover).
  useEffect(() => {
    setState(readState());
  }, []);

  if (state.kind === 'unsupported') return null;

  const onClick = async () => {
    if (state.kind === 'default') {
      const next = await requestNotificationPermission();
      if (next === 'granted') {
        setNotifySoundPref(true);
        setState({ kind: 'granted', soundOn: true });
        toast.success('Desktop notifications on');
      } else if (next === 'denied') {
        setState({ kind: 'denied' });
        toast.error('Notifications blocked — re-enable in your browser settings.');
      }
      return;
    }
    if (state.kind === 'granted') {
      const nextSound = !state.soundOn;
      setNotifySoundPref(nextSound);
      setState({ kind: 'granted', soundOn: nextSound });
      toast(nextSound ? 'Notification sound on' : 'Notification sound off', { icon: '🔔' });
      return;
    }
    if (state.kind === 'denied') {
      toast(
        'Notifications are blocked. Open this site’s permissions in your browser to re-enable.',
        { icon: '🚫', duration: 6000 },
      );
    }
  };

  const { label, title, on } = labelFor(state);

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md text-muted hover:text-ink hover:bg-hover transition-colors ${
        on ? 'text-brand-500 hover:text-brand-500' : ''
      }`}
    >
      <BellIcon variant={label} />
    </button>
  );
}

function labelFor(s: State): { label: 'on' | 'off' | 'ask'; title: string; on: boolean } {
  switch (s.kind) {
    case 'default':
      return { label: 'ask', title: 'Enable desktop notifications', on: false };
    case 'denied':
      return {
        label: 'off',
        title: 'Notifications blocked — re-enable in browser settings',
        on: false,
      };
    case 'granted':
      return s.soundOn
        ? { label: 'on', title: 'Notification sound on — click to mute', on: true }
        : { label: 'off', title: 'Notification sound off — click to unmute', on: false };
    case 'unsupported':
      return { label: 'off', title: '', on: false };
  }
}

function BellIcon({ variant }: { variant: 'on' | 'off' | 'ask' }) {
  // Inline SVG keeps this component dependency-free and matches the existing
  // Icons module's stroke + size conventions (16px, currentColor).
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (variant === 'off') {
    return (
      <svg {...common}>
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
        <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
        <path d="M18 8a6 6 0 0 0-9.33-5" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
