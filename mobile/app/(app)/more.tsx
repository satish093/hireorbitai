import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenScroll, PageHeader } from '../../src/components/ui/Screen';
import { Card, Divider } from '../../src/components/ui/Card';
import { Avatar } from '../../src/components/ui/Avatar';
import { Pill } from '../../src/components/ui/Pill';
import { Button } from '../../src/components/ui/Button';
import { ConfirmSheet } from '../../src/components/ui/Sheet';
import { useAuth } from '../../src/context/AuthContext';
import { useFeatureFlags } from '../../src/hooks/useFeatureFlags';
import { useBadgeCounts } from '../../src/hooks/useBadgeCounts';
import { filterNavSections, type NavItem } from '../../src/navigation/navModel';
import { ROLE_LABEL } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * "More" — the full navigation surface.
 *
 * Renders exactly what filterNavSections() allows for this user, which is the
 * same model the web sidebar uses. A destination that is hidden here is hidden
 * on the web too, and vice versa.
 */
export default function MoreScreen() {
  const { profile, signOut } = useAuth();
  const { flags } = useFeatureFlags();
  const badges = useBadgeCounts();
  const { colors, spacing, fontSize } = useTheme();
  const router = useRouter();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const sections = filterNavSections(profile?.role, profile, flags);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    setConfirmSignOut(false);
    router.replace('/login');
  };

  return (
    <>
      <ScreenScroll>
        <PageHeader title="More" />

        {/* Identity card */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Avatar
              id={profile?.id}
              name={profile?.full_name}
              email={profile?.email}
              uri={profile?.avatar_url}
              size={52}
            />
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}
              >
                {profile?.full_name?.trim() || profile?.email || 'Signed in'}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                {profile?.email}
              </Text>
              <View style={{ marginTop: 6 }}>
                <Pill label={profile ? ROLE_LABEL[profile.role] : '—'} tone="brand" size="sm" />
              </View>
            </View>
          </View>
          <View style={{ marginTop: spacing.lg, flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label="My profile" href="/(app)/profile" variant="secondary" size="sm" />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Settings" href="/(app)/settings" variant="secondary" size="sm" />
            </View>
          </View>
        </Card>

        {sections.map((section) => (
          <View key={section.heading}>
            <Text
              style={{
                fontSize: fontSize.xs,
                fontWeight: '700',
                color: colors.muted,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
                marginBottom: spacing.sm,
                marginLeft: spacing.xs,
              }}
            >
              {section.heading}
            </Text>
            <Card padded={false}>
              {section.items.map((item, i) => (
                <View key={item.to}>
                  {i > 0 ? <Divider inset={52} /> : null}
                  <NavRow item={item} badge={item.badgeKey ? badges[item.badgeKey] : undefined} />
                </View>
              ))}
            </Card>
          </View>
        ))}

        <View style={{ marginTop: spacing.md }}>
          <Button label="Sign out" variant="danger" onPress={() => setConfirmSignOut(true)} />
        </View>
      </ScreenScroll>

      <ConfirmSheet
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        onConfirm={handleSignOut}
        pending={signingOut}
        destructive
        title="Sign out?"
        message="Your session will be revoked on this device. You'll need to sign in again."
        confirmLabel="Sign out"
      />
    </>
  );
}

function NavRow({ item, badge }: { item: NavItem; badge?: number }) {
  const { colors, spacing, fontSize } = useTheme();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      onPress={() => router.push(item.to as never)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        // Comfortably above the 44px minimum touch target.
        minHeight: 52,
        backgroundColor: pressed ? colors.hover : 'transparent',
      })}
    >
      <Text style={{ fontSize: 18, width: 28, color: colors.muted }}>{item.icon}</Text>
      <Text style={{ flex: 1, fontSize: fontSize.md, color: colors.ink }}>{item.label}</Text>
      {badge && badge > 0 ? (
        <View style={{ marginRight: spacing.sm }}>
          <Pill label={badge > 99 ? '99+' : String(badge)} tone="accent" size="sm" />
        </View>
      ) : null}
      <Text style={{ color: colors.faint, fontSize: fontSize.md }}>›</Text>
    </Pressable>
  );
}

export const unstable_settings = { initialRouteName: 'more' };

const styles = StyleSheet.create({});
