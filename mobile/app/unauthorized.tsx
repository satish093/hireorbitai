import { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../src/components/ui/Screen';
import { Button } from '../src/components/ui/Button';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/theme';

/**
 * Dead end for a user the app cannot place.
 *
 * Two very different situations land here, and the copy has to cover both
 * without leaking which one it is:
 *   • the role gate refused this screen (they're signed in, just not allowed)
 *   • /auth/me AND /auth/sync both failed, so there is a token but no profile
 *     (deactivated account, missing public.users row, or a network blip)
 *
 * Either way the only useful actions are "try again" and "sign out", so those
 * are the only two offered.
 */
export default function UnauthorizedScreen() {
  const { profile, refreshProfile, signOut } = useAuth();
  const { colors, spacing, fontSize, radius } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    await refreshProfile();
    setBusy(false);
    if (profile) router.replace('/(app)/dashboard');
  };

  const out = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    router.replace('/login');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: colors.dangerSoft,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.lg,
          }}
        >
          <Text style={{ fontSize: 26, color: colors.danger }}>⊘</Text>
        </View>

        <Text
          style={{
            fontSize: fontSize.xl,
            fontWeight: '700',
            color: colors.ink,
            textAlign: 'center',
          }}
        >
          You don&apos;t have access
        </Text>
        <Text
          style={{
            fontSize: fontSize.base,
            color: colors.muted,
            textAlign: 'center',
            marginTop: spacing.sm,
            lineHeight: 22,
            maxWidth: 340,
          }}
        >
          {profile
            ? 'Your role doesn’t include this area. If you think that’s wrong, ask a workspace admin.'
            : 'We couldn’t load your profile. Your account may have been deactivated, or the connection dropped mid-sign-in.'}
        </Text>

        <View
          style={{
            marginTop: spacing['2xl'],
            width: '100%',
            maxWidth: 320,
            gap: spacing.sm,
            borderRadius: radius.lg,
          }}
        >
          <Button label="Try again" onPress={retry} loading={busy} />
          <Button label="Sign out" onPress={out} variant="secondary" disabled={busy} />
        </View>
      </View>
    </Screen>
  );
}
