import { Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useAuth } from '../../src/context/AuthContext';
import { useFeatureFlags } from '../../src/hooks/useFeatureFlags';
import { useBadgeCounts } from '../../src/hooks/useBadgeCounts';
import { primaryTabsFor } from '../../src/navigation/navModel';
import { useTheme } from '../../src/theme';

/**
 * Signed-in shell.
 *
 * <RouteGuard> wraps the whole group, so every screen underneath inherits the
 * same fail-closed chain (no session → login, no profile → unauthorized, temp
 * password → rotate, incomplete profile → complete, onboarding → onboard).
 * Individual screens add only their own role/feature requirements on top.
 *
 * The tab bar carries four high-frequency destinations, resolved per-role by
 * primaryTabsFor(); the remaining ~30 live behind "More", which renders the
 * full gated nav model. A phone tab bar cannot hold 35 items, and burying
 * everything in a hamburger would hide the screens people use hourly.
 */

/**
 * Every route file/folder that EXISTS directly under app/(app)/. Anything not
 * currently a tab is registered with `href: null` so expo-router keeps it
 * reachable by navigation without auto-adding a tab for it.
 *
 * Two rules when adding a screen:
 *   • add its name here, or it appears as a stray tab
 *   • only list names whose file actually exists — declaring a screen with no
 *     matching file makes expo-router throw at mount
 *
 * `navModel.ts` may reference destinations that are not in this list yet; those
 * rows render in "More" and 404 until their file lands. That is deliberate — the
 * nav model is the parity target, this list is what has shipped.
 */
const GROUP_SCREENS = [
  'dashboard',
  'jobs',
  'tasks',
  'messages',
  'my-resume',
  'applications',
  'training',
  // Detail stacks — pushed from a list row, never a tab of their own.
  'job',
  'task',
  'chat',
] as const;

export default function AppLayout() {
  const { profile } = useAuth();
  const { flags } = useFeatureFlags();
  const { colors, fontSize } = useTheme();
  const badges = useBadgeCounts();

  const tabs = primaryTabsFor(profile?.role, profile, flags);

  // A tab targets a TOP-LEVEL screen in this group. '/(app)/training/my' is a
  // nested route, so its tab is the 'training' stack (which opens on 'my').
  const screenNameFor = (href: string) => href.replace('/(app)/', '').split('/')[0] ?? '';

  const tabScreens = tabs
    .map((tab) => ({ ...tab, name: screenNameFor(tab.to) }))
    // De-dupe: two preferred hrefs could collapse onto the same stack.
    .filter((tab, i, arr) => arr.findIndex((t) => t.name === tab.name) === i);

  const tabNames = new Set(tabScreens.map((t) => t.name));

  return (
    <RouteGuard>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: { backgroundColor: colors.bgElev, borderTopColor: colors.border },
          tabBarLabelStyle: { fontSize: fontSize.xs, fontWeight: '600' },
        }}
      >
        {tabScreens.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.label,
              tabBarIcon: ({ color }) => <TabIcon glyph={tab.icon} color={color} />,
              tabBarBadge: tab.badgeKey ? badgeValue(badges[tab.badgeKey]) : undefined,
            }}
          />
        ))}

        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            tabBarIcon: ({ color }) => <TabIcon glyph="≡" color={color} />,
          }}
        />

        {GROUP_SCREENS.filter((name) => !tabNames.has(name)).map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null }} />
        ))}
      </Tabs>
    </RouteGuard>
  );
}

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

/** Badges cap at 99+ so the pill never stretches the bar. */
function badgeValue(n: number | undefined): string | undefined {
  if (!n || n <= 0) return undefined;
  return n > 99 ? '99+' : String(n);
}
