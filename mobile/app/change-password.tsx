import { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner } from '../src/components/ui/Screen';
import { AuthCard, AuthHeading } from '../src/components/ui/AuthCard';
import { Button } from '../src/components/ui/Button';
import { PasswordInput } from '../src/components/ui/Inputs';
import { RouteGuard } from '../src/components/RouteGuard';
import { useAuth } from '../src/context/AuthContext';
import { api, apiErrorMessage } from '../src/services/api';
import { useTheme } from '../src/theme';

/**
 * Change password — also the forced first-login rotation screen.
 *
 * `bypassPasswordChange` is essential: without it the guard would redirect this
 * very screen back to itself and loop. Same trick the web uses.
 *
 * The backend rotates the session on success (it bumps users.session_version,
 * which invalidates every existing refresh token). If it returns a fresh token
 * pair we adopt it so the user stays signed in; otherwise we sign out and send
 * them back to login, because the token in hand is now dead.
 */
export default function ChangePasswordScreen() {
  return (
    <RouteGuard bypassPasswordChange bypassProfileCompletion bypassOnboarding>
      <ChangePasswordForm />
    </RouteGuard>
  );
}

const MIN_LENGTH = 12;

function ChangePasswordForm() {
  const { profile, refreshSession, signOut } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const forced = !!profile?.must_change_password;
  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const canSubmit = current.length > 0 && next.length >= MIN_LENGTH && next === confirm && !pending;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post<{
        access_token?: string;
        refresh_token?: string;
        expires_at?: number;
      }>('/auth/change-password', {
        current_password: current,
        new_password: next,
      });

      if (data?.access_token && data?.refresh_token) {
        await refreshSession(data.access_token, data.refresh_token, data.expires_at);
        router.replace('/(app)/dashboard');
      } else {
        // No new pair returned — the old refresh token is revoked, so the only
        // correct move is a clean re-authentication.
        await signOut();
        router.replace('/login');
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change your password.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCard
      aboveCard={
        forced ? (
          <Banner
            tone="warn"
            message="You're signed in with a temporary password. Set a new one to continue."
          />
        ) : undefined
      }
    >
      <AuthHeading
        title={forced ? 'Set a new password' : 'Change password'}
        subtitle={`At least ${MIN_LENGTH} characters.`}
      />

      {error ? (
        <View style={{ marginBottom: spacing.md }}>
          <Banner tone="danger" message={error} />
        </View>
      ) : null}

      <PasswordInput
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        placeholder="••••••••"
      />
      <PasswordInput
        label="New password"
        value={next}
        onChangeText={setNext}
        placeholder="••••••••"
        error={tooShort ? `Use at least ${MIN_LENGTH} characters.` : null}
        hint={`At least ${MIN_LENGTH} characters.`}
      />
      <PasswordInput
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        placeholder="••••••••"
        error={mismatch ? 'Passwords do not match.' : null}
      />

      <Button
        label="Update password"
        onPress={onSubmit}
        disabled={!canSubmit}
        loading={pending}
        size="lg"
      />

      {!forced ? (
        <View style={{ marginTop: spacing.md }}>
          <Button label="Cancel" onPress={() => router.back()} variant="secondary" />
        </View>
      ) : (
        <Text
          style={{
            marginTop: spacing.lg,
            fontSize: fontSize.sm,
            color: colors.muted,
            textAlign: 'center',
            lineHeight: 20,
          }}
        >
          Every other screen stays locked until your password is rotated.
        </Text>
      )}
    </AuthCard>
  );
}
