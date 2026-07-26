import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import { Banner } from '../src/components/ui/Screen';
import { AuthCard, AuthHeading } from '../src/components/ui/AuthCard';
import { Button } from '../src/components/ui/Button';
import { PasswordInput } from '../src/components/ui/Inputs';
import { SkeletonCard } from '../src/components/ui/States';
import { Pill } from '../src/components/ui/Pill';
import { config as appConfig } from '../src/config/env';
import { apiErrorMessage } from '../src/services/api';
import { isPlausibleToken } from '../src/utils/safeUrl';
import { ROLE_LABEL, type Role } from '../src/types';
import { useTheme } from '../src/theme';

/**
 * Accept an invitation and set the first password.
 *
 * Both endpoints are PUBLIC (mounted before requireAuth in routes/index.ts) —
 * the invitation token IS the credential:
 *   GET  /invitations/preview?token=…   what the invite is for
 *   POST /invitations/setup             claim it and set a password
 *
 * The token arrives via deep link from the invitation email, so it is
 * shape-checked with isPlausibleToken before being sent anywhere. The backend
 * remains the authority on validity; this only rejects inputs that cannot
 * possibly be a token.
 */
export default function AcceptInvitationScreen() {
  const { colors, spacing, fontSize } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = isPlausibleToken(params.token) ? params.token : null;

  const [preview, setPreview] = useState<{ email?: string; role?: Role } | null>(null);
  const [loading, setLoading] = useState(!!token);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const MIN_LENGTH = 12;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = !!token && password.length >= MIN_LENGTH && password === confirm && !pending;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await axios.get(`${appConfig.apiBaseUrl}/invitations/preview`, {
          params: { token },
        });
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled)
          setPreviewError(
            apiErrorMessage(err, 'This invitation is invalid or has already been used.'),
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await axios.post(`${appConfig.apiBaseUrl}/invitations/setup`, { token, password });
      setDone(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not complete the invitation.'));
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <AuthCard wide>
        <AuthHeading title="Can't open this invitation" />
        <View style={{ gap: spacing.md }}>
          <Banner
            tone="danger"
            message="This screen needs an invitation link. Open the link from your invitation email."
          />
          <Button label="Go to sign in" href="/login" variant="secondary" />
        </View>
      </AuthCard>
    );
  }

  return (
    <AuthCard wide>
      {done ? (
        <>
          <AuthHeading title="You're all set" subtitle="Your account is ready." />
          <Button label="Sign in" onPress={() => router.replace('/login')} size="lg" />
        </>
      ) : loading ? (
        <SkeletonCard />
      ) : previewError ? (
        <>
          <AuthHeading title="Can't open this invitation" />
          <View style={{ gap: spacing.md }}>
            <Banner tone="danger" message={previewError} />
            <Button label="Go to sign in" href="/login" variant="secondary" />
          </View>
        </>
      ) : (
        <>
          <AuthHeading title="Create your account" />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: spacing.sm,
              marginBottom: spacing.lg,
            }}
          >
            <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>Joining as</Text>
            <Pill label={preview?.role ? ROLE_LABEL[preview.role] : 'Team member'} tone="brand" />
            {preview?.email ? (
              <Text style={{ fontSize: fontSize.sm, color: colors.ink }}>· {preview.email}</Text>
            ) : null}
          </View>

          {error ? (
            <View style={{ marginBottom: spacing.md }}>
              <Banner tone="danger" message={error} />
            </View>
          ) : null}

          <PasswordInput
            label="Create a password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            hint={`At least ${MIN_LENGTH} characters.`}
          />
          <PasswordInput
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="••••••••"
            error={mismatch ? 'Passwords do not match.' : null}
          />
          <Button
            label="Create my account"
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
