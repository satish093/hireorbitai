import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../src/components/ui/Screen';
import { Button } from '../src/components/ui/Button';
import { FormInput, PasswordInput } from '../src/components/ui/Inputs';
import { Banner } from '../src/components/ui/Screen';
import { GuestOnly } from '../src/components/RouteGuard';
import { useAuth } from '../src/context/AuthContext';
import { apiErrorMessage } from '../src/services/api';
import { useTheme } from '../src/theme';

/**
 * Sign in.
 *
 * Authenticates against OUR backend (POST /auth/login), which owns lockout,
 * temp-password and audit policy. The response tells us whether the user is on
 * a temporary password; if so we route straight to the rotation screen, exactly
 * as the web does.
 *
 * The `?locked=1` param is set by the root layout when the api client sees a
 * 423 — that is the backend saying the account is locked after too many failed
 * attempts, and the user deserves to be told which of the two it was.
 */
export default function LoginScreen() {
  return (
    <GuestOnly>
      <LoginForm />
    </GuestOnly>
  );
}

function LoginForm() {
  const { signIn } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const params = useLocalSearchParams<{ locked?: string }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !pending;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      // Email is normalised server-side too (the DB has a lower(email) unique
      // index), but trimming here avoids a pointless round-trip on a stray space.
      const result = await signIn(email.trim(), password);
      if (result.must_change_password) {
        router.replace('/change-password');
      } else {
        router.replace('/(app)/dashboard');
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Sign-in failed. Check your email and password.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ marginBottom: spacing['3xl'] }}>
            <Text style={{ fontSize: fontSize['2xl'], fontWeight: '700', color: colors.ink }}>
              HireOrbit AI
            </Text>
            <Text style={{ fontSize: fontSize.base, color: colors.muted, marginTop: spacing.xs }}>
              Sign in to your workspace
            </Text>
          </View>

          {params.locked === '1' ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Banner
                tone="danger"
                message="This account is locked after too many failed sign-in attempts. Try again later, or reset your password."
              />
            </View>
          ) : null}

          {error ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Banner tone="danger" message={error} />
            </View>
          ) : null}

          <FormInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
          />

          <PasswordInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />

          <Button label="Sign in" onPress={onSubmit} disabled={!canSubmit} loading={pending} />

          <View style={{ marginTop: spacing.lg, alignItems: 'center' }}>
            <Button
              label="Forgot your password?"
              href="/forgot-password"
              variant="ghost"
              size="sm"
              block={false}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
