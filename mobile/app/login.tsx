import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Banner } from '../src/components/ui/Screen';
import { Button } from '../src/components/ui/Button';
import { Brand } from '../src/components/ui/Brand';
import { FormInput, PasswordInput } from '../src/components/ui/Inputs';
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
  const { colors, spacing, fontSize, radius } = useTheme();
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
    // bg-hover full-screen backdrop, matching the web login (hireorbitai.com/login).
    <Screen edges={['top', 'bottom']} style={{ backgroundColor: colors.hover }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* max-w-sm centred column, brand mark on top, white card below. */}
          <View style={{ width: '100%', maxWidth: 384 }}>
            <View style={{ alignItems: 'center', marginBottom: spacing['2xl'] }}>
              <Brand size="lg" />
            </View>

            {params.locked === '1' ? (
              <View style={{ marginBottom: spacing.md }}>
                <Banner
                  tone="danger"
                  message="This account is locked after too many failed sign-in attempts. Try again later, or reset your password."
                />
              </View>
            ) : null}

            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: radius['2xl'],
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
                padding: spacing['2xl'],
                // shadow-sm — subtle lift on both platforms.
                shadowColor: '#000',
                shadowOpacity: 0.06,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 2,
              }}
            >
              <View style={{ marginBottom: spacing.lg }}>
                <Text
                  style={{
                    fontSize: fontSize.xl,
                    fontWeight: '600',
                    letterSpacing: -0.3,
                    color: colors.ink,
                  }}
                >
                  Sign in
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 4 }}>
                  Use your work email and password.
                </Text>
              </View>

              {error ? (
                <View style={{ marginBottom: spacing.md }}>
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

              <Button
                label="Sign in"
                onPress={onSubmit}
                disabled={!canSubmit}
                loading={pending}
                size="lg"
              />

              {/* Forgot password? · Need an account? Ask an admin. — matches web. */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: spacing.lg,
                }}
              >
                <Text
                  onPress={() => router.push('/forgot-password')}
                  style={{ fontSize: fontSize.xs, color: colors.brandOnSoft, fontWeight: '600' }}
                >
                  Forgot password?
                </Text>
                <Text style={{ fontSize: fontSize.xs, color: colors.muted }}>
                  Need an account? Ask an admin.
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
