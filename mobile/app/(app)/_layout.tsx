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
 * Home · Inbox · Work · Training · More bar, with More opening a slide-up
 * sheet. We render that as a custom `tabBar` over expo-router's Tabs navigator,
 * so switching tabs still gets native per-tab state while the bar and sheet are
 * fully our own. Every screen in this group is a route in the navigator; the
 * bar simply decides which to show.
 */
export default function AppLayout() {
  return (
    <RouteGuard>
      <Tabs tabBar={() => <BottomNav />} screenOptions={{ headerShown: false }} />
    </RouteGuard>
  );
}
