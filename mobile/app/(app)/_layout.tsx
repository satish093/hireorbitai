import { Tabs } from 'expo-router';
import { RouteGuard } from '../../src/components/RouteGuard';
import { BottomNav } from '../../src/components/nav/BottomNav';

/**
 * Signed-in shell.
 *
 * <RouteGuard> wraps the whole group, so every screen inherits the same
 * fail-closed chain (no session → login, no profile → unauthorized, temp
 * password → rotate, incomplete profile → complete, onboarding → onboard).
 *
 * Navigation matches the WEBSITE's mobile layout exactly
 * (frontend/src/components/MobileBottomNav + MobileMoreSheet): a fixed
 * Home · Inbox · Work · Training · More bar, with More opening a slide-up sheet.
 * We render that as a custom `tabBar` over expo-router's Tabs navigator, so each
 * destination keeps native per-tab state while the bar/sheet are fully our own.
 *
 * IMPORTANT — every direct child of app/(app)/ MUST be registered below with
 * `href: null`. `<Tabs>` otherwise auto-adds a tab for each file/folder; the
 * detail folders (job, task, chat) contain ONLY a dynamic `[id]` route, so an
 * auto-tab for them has no valid default route and navigating into a detail
 * screen crashes. Registering them with `href: null` keeps them reachable by
 * `router.push` while adding no tab button. Only list names whose file/folder
 * actually exists — a Tabs.Screen with no matching route throws at mount.
 */
const GROUP_SCREENS = [
  'dashboard',
  'jobs',
  'tasks',
  'tasks-assigned',
  'messages',
  'my-resume',
  'resume-view',
  'applications',
  'consultants',
  'recruiters',
  'managers',
  'interviews',
  'reminders',
  'calendar',
  'vendors',
  'clients',
  'invoices',
  'resumes',
  'reports',
  'invitations',
  'ai-usage',
  'ai-email',
  'settings',
  'profile',
  // Folders with their own nested layout/stack.
  'admin',
  'training',
  // Dynamic-only detail folders — pushed from a row, never a tab.
  'job',
  'task',
  'chat',
  // Kept only as a redirect so a stray /more lands somewhere sane.
  'more',
] as const;

export default function AppLayout() {
  return (
    <RouteGuard>
      <Tabs tabBar={() => <BottomNav />} screenOptions={{ headerShown: false }}>
        {GROUP_SCREENS.map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null }} />
        ))}
      </Tabs>
    </RouteGuard>
  );
}
