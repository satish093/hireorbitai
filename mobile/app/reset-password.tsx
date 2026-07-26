import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import { Banner } from '../src/components/ui/Screen';
import { AuthCard, AuthHeading } from '../src/components/ui/AuthCard';
import { Button } from '../src/components/ui/Button';
import { PasswordInput } from '../src/components/ui/Inputs';
import { config as appConfig } from '../src/config/env';
import { apiErrorMessage } from '../src/services/api';
import { useTheme } from '../src/theme';

/**
 * Complete a password reset.
 *
 * Reached by deep link from the reset email. The token arrives as a query
 * param — app.json registers `applinks:hireorbitai.com` (iOS) and an
 * autoVerify intent filter (Android) so the emailed https:// link opens here
 * instead of the browser.
 *
 * Reset tokens are hashed server-side and live 15 minutes
 * (RESET_TOKEN_EXPIRY_MINUTES), so an expired link is the common failure and
 * the copy points straight back at requesting a new one.
 */
export default function ResetPasswordScreen() {
  const { colors, spacing, fontSize } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token : '';

  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const MIN_LENGTH = 12;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !!token && next.length >= MIN_LENGTH && next === confirm && !pending;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await axios.post(`${appConfig.apiBaseUrl}/auth/reset-password`, {
        token,
        password: next,
      });
      setDone(true);
    } catch (err) {
      setError(
        apiErrorMessage(err, 'That reset link is invalid or has expired. Request a new one.'),
      );
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <AuthCard>
        <AuthHeading title="Invalid reset link" />
        <View style={{ gap: spacing.md }}>
          <Banner
            tone="danger"
            message="This screen needs a reset link. Open the link from your password-reset email."
          />
          <Button label="Request a new link" href="/forgot-password" variant="secondary" />
        </View>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      {done ? (
        <>
          <AuthHeading title="Password updated" />
          <View style={{ gap: spacing.md }}>
            <Banner tone="success" message="Your password has been updated." />
            <Text style={{ fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 }}>
              Every other device signed in with the old password has been signed out.
            </Text>
            <Button label="Sign in" onPress={() => router.replace('/login')} size="lg" />
          </View>
        </>
      ) : (
        <>
          <AuthHeading
            title="Choose a new password"
            subtitle={`At least ${MIN_LENGTH} characters.`}
          />

          {error ? (
            <View style={{ marginBottom: spacing.md }}>
              <Banner tone="danger" message={error} />
            </View>
          ) : null}

          <PasswordInput
            label="New password"
            value={next}
            onChangeText={setNext}
            placeholder="••••••••"
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
            label="Set new password"
            onPress={onSubmit}
            disabled={!canSubmit}
            loading={pending}
            size="lg"
          />
        </>
      )}
    </AuthCard>
  );
}
