import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { Icon, type IconName } from '../ui/Icon';
import { MoreSheet } from './MoreSheet';
import { useAuth } from '../../context/AuthContext';
import { useBadgeCounts } from '../../hooks/useBadgeCounts';
import { OPERATOR_TIER, type Role } from '../../types';
import { useTheme } from '../../theme';

/**
 * Fixed bottom navigation — a faithful port of the web's MobileBottomNav
 * (frontend/src/components/MobileBottomNav.tsx). Five tabs: Home, Inbox, Work
 * (role-aware landing, active across every work-area route), Training, More
 * (opens the slide-up sheet). Same labels, same icons, same 58px bar.
 */

/** Role → where the Work tab lands (mirrors the web workRoute). */
function workRoute(role: Role | undefined): string {
  if (!role) return '/(app)/jobs';
  if ((OPERATOR_TIER as readonly string[]).includes(role)) {
    if (role === 'RECRUITER') return '/(app)/jobs';
    return '/(app)/consultants'; // manager-tier within operator-tier
  }
  if (role === 'CONSULTANT') return '/(app)/tasks';
  if (role === 'DEVELOPER') return '/(app)/admin/features';
  return '/(app)/jobs';
}

// Every route that counts as "Work" being the active tab.
const WORK_PATHS = [
  '/(app)/jobs',
  '/(app)/consultants',
  '/(app)/recruiters',
  '/(app)/managers',
  '/(app)/applications',
  '/(app)/tasks',
  '/(app)/tasks-assigned',
  '/(app)/resumes',
  '/(app)/interviews',
  '/(app)/vendors',
  '/(app)/clients',
  '/(app)/invoices',
  '/(app)/reports',
  '/(app)/invitations',
  '/(app)/ai-usage',
  '/(app)/ai-email',
  '/(app)/admin',
  '/(app)/job',
  '/(app)/task',
];
const TRAINING_PATHS = ['/(app)/training'];

interface Tab {
  id: string;
  label: string;
  icon: IconName;
  to?: string; // absent → opens the More sheet
  badge?: 'inbox';
  activeOn?: string[];
}

export function BottomNav() {
  const { profile } = useAuth();
  const counts = useBadgeCounts();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, fontSize } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);

  const tabs: Tab[] = [
    {
      id: 'home',
      label: 'Home',
      icon: 'home',
      to: '/(app)/dashboard',
      activeOn: ['/(app)/dashboard'],
    },
    {
      id: 'inbox',
      label: 'Inbox',
      icon: 'inbox',
      to: '/(app)/messages',
      badge: 'inbox',
      activeOn: ['/(app)/messages'],
    },
    {
      id: 'work',
      label: 'Work',
      icon: 'briefcase',
      to: workRoute(profile?.role),
      activeOn: WORK_PATHS,
    },
    {
      id: 'training',
      label: 'Training',
      icon: 'graduation',
      to: '/(app)/training',
      activeOn: TRAINING_PATHS,
    },
    { id: 'more', label: 'More', icon: 'more' },
  ];

  // expo-router's usePathname() drops the `(app)` group segment, so compare on
  // the group-less form too (e.g. `/dashboard`).
  const bare = pathname.replace('/(app)', '');
  const isActive = (tab: Tab): boolean => {
    if (moreOpen) return tab.id === 'more';
    const paths = tab.activeOn ?? (tab.to ? [tab.to] : []);
    return paths.some((p) => {
      const bp = p.replace('/(app)', '');
      return bare === bp || bare.startsWith(bp + '/');
    });
  };

  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          height: 58 + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: colors.bgElev,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        {tabs.map((tab) => {
          const active = isActive(tab);
          const tint = active ? colors.accent : colors.muted;
          const badgeCount = tab.badge ? (counts[tab.badge] ?? 0) : 0;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (tab.to) {
                  setMoreOpen(false);
                  router.navigate(tab.to as never);
                } else {
                  setMoreOpen(true);
                }
              }}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                minHeight: 44,
              }}
            >
              <View>
                <Icon name={tab.icon} size={23} color={tint} strokeWidth={active ? 2.1 : 1.75} />
                {badgeCount > 0 ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -8,
                      minWidth: 15,
                      height: 15,
                      paddingHorizontal: 3,
                      borderRadius: 8,
                      backgroundColor: colors.danger,
                      borderWidth: 1.5,
                      borderColor: colors.bgElev,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={{
                  fontSize: 10.5,
                  fontWeight: active ? '700' : '500',
                  letterSpacing: 0.1,
                  color: tint,
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
