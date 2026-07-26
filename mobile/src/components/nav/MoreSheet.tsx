import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Avatar } from '../ui/Avatar';
import { Icon, type IconName } from '../ui/Icon';
import { useAuth } from '../../context/AuthContext';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { filterNavSections } from '../../navigation/navModel';
import { ROLE_LABEL } from '../../types';
import { useTheme } from '../../theme';

/**
 * MoreSheet — the slide-up secondary-navigation sheet, a faithful port of the
 * web's MobileMoreSheet (frontend/src/components/MobileMoreSheet.tsx):
 * MENU header → profile card → role-gated nav groups (rounded cards with
 * icon+label+chevron) → Dark-mode toggle → Sign out.
 *
 * Destinations come from the SAME filterNavSections model the bottom bar and the
 * web sidebar use — minus the two that are already primary bottom-nav tabs
 * (Dashboard, Inbox) — so nothing is duplicated and nothing drifts.
 */

// Already primary bottom-nav tabs — omit from the sheet.
const BOTTOM_NAV_PATHS = new Set(['/(app)/dashboard', '/(app)/messages']);

export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, signOut } = useAuth();
  const { flags } = useFeatureFlags();
  const { colors, spacing, radius, fontSize, scheme, setMode } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const router = useRouter();

  const groups = filterNavSections(profile?.role, profile, flags)
    .map((s) => ({
      heading: s.heading,
      items: s.items.filter((i) => !BOTTOM_NAV_PATHS.has(i.to)),
    }))
    .filter((g) => g.items.length > 0);

  const displayName = profile?.full_name || profile?.email || '';
  const roleLabel = profile?.role ? ROLE_LABEL[profile.role] : '';

  const go = (to: string) => {
    onClose();
    router.push(to as never);
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable onPress={onClose} style={[styles.scrim, { backgroundColor: colors.scrim }]} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: height * 0.92,
          backgroundColor: colors.bgElev,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          paddingBottom: insets.bottom || spacing.lg,
        }}
      >
        {/* Drag handle */}
        <View style={{ alignItems: 'center', paddingTop: spacing.sm }}>
          <View
            style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }}
          />
        </View>

        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
            paddingBottom: spacing.sm,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 1.2,
              color: colors.muted,
            }}
          >
            MENU
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: colors.hover,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="x" size={16} color={colors.ink2} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xl,
            gap: spacing.xl,
          }}
        >
          {/* Profile card */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              padding: 14,
              borderRadius: radius['2xl'],
              backgroundColor: colors.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
            }}
          >
            <Avatar id={profile?.id} name={displayName} email={profile?.email} size={46} />
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}
              >
                {displayName || profile?.email}
              </Text>
              <Text
                style={{
                  fontSize: fontSize.xs,
                  color: colors.muted,
                  letterSpacing: 0.6,
                  marginTop: 2,
                  textTransform: 'uppercase',
                }}
              >
                {roleLabel}
              </Text>
            </View>
          </View>

          {/* Nav groups */}
          {groups.map((group) => (
            <View key={group.heading}>
              <Text
                style={{
                  fontSize: fontSize.xs,
                  fontWeight: '700',
                  color: colors.muted,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase',
                  marginBottom: spacing.sm,
                  marginLeft: spacing.xs,
                }}
              >
                {group.heading}
              </Text>
              <View
                style={{
                  borderRadius: radius['2xl'],
                  overflow: 'hidden',
                  backgroundColor: colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                }}
              >
                {group.items.map((item, i) => (
                  <Pressable
                    key={item.to}
                    onPress={() => go(item.to)}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                      paddingHorizontal: 14,
                      paddingVertical: 14,
                      minHeight: 52,
                      borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0,
                      borderColor: colors.border,
                      backgroundColor: pressed ? colors.hover : 'transparent',
                    })}
                  >
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: radius.md,
                        backgroundColor: colors.hover,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name={item.icon as IconName} size={17} color={colors.ink2} />
                    </View>
                    <Text
                      style={{
                        flex: 1,
                        fontSize: fontSize.sm,
                        fontWeight: '500',
                        color: colors.ink,
                      }}
                    >
                      {item.label}
                    </Text>
                    <Icon name="chevronRight" size={16} color={colors.faint} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          {/* Appearance */}
          <View>
            <Text
              style={{
                fontSize: fontSize.xs,
                fontWeight: '700',
                color: colors.muted,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginBottom: spacing.sm,
                marginLeft: spacing.xs,
              }}
            >
              Appearance
            </Text>
            <View
              style={{
                borderRadius: radius['2xl'],
                backgroundColor: colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingHorizontal: 14,
                paddingVertical: 14,
                minHeight: 52,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: radius.md,
                  backgroundColor: colors.hover,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={scheme === 'dark' ? 'sun' : 'moon'} size={17} color={colors.ink2} />
              </View>
              <Text
                style={{ flex: 1, fontSize: fontSize.sm, fontWeight: '500', color: colors.ink }}
              >
                Dark mode
              </Text>
              <Switch
                value={scheme === 'dark'}
                onValueChange={(v) => setMode(v ? 'dark' : 'light')}
                trackColor={{ true: colors.accent, false: colors.borderStrong }}
              />
            </View>
          </View>

          {/* Sign out */}
          <Pressable
            onPress={() => {
              onClose();
              void signOut();
              router.replace('/login');
            }}
            accessibilityRole="button"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
              paddingVertical: 14,
              borderRadius: radius['2xl'],
              backgroundColor: colors.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
            }}
          >
            <Icon name="logout" size={17} color={colors.danger} />
            <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color: colors.danger }}>
              Sign out
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({ scrim: StyleSheet.absoluteFill });
