import { useState } from 'react';
import { Text, View } from 'react-native';
import axios from 'axios';
import { Banner } from '../src/components/ui/Screen';
import { AuthCard, AuthHeading } from '../src/components/ui/AuthCard';
import { Button } from '../src/components/ui/Button';
import { FormInput } from '../src/components/ui/Inputs';
import { config as appConfig } from '../src/config/env';
import { apiErrorMessage } from '../src/services/api';
import { useTheme } from '../src/theme';

/**
 * Request a password-reset email.
 *
 * The backend responds identically whether or not the address exists — that is
 * deliberate (an account-enumeration guard), so the UI must not imply anything
 * about whether a match was found. The success copy says "if an account
 * exists", matching the web wording.
 *
 * Bare axios rather than the `api` client: there is no session to attach, and
 * the request interceptor's refresh check would be pointless work.
 */
export default function ForgotPasswordScreen() {
  const { colors, spacing, fontSize } = useTheme();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await axios.post(`${appConfig.apiBaseUrl}/auth/forgot-password`, {
        email: email.trim().toLowerCase(),
      });
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send the reset email. Try again shortly.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCard>
      {sent ? (
        <>
          <AuthHeading title="Check your inbox" />
          <View style={{ gap: spacing.md }}>
            <Banner
              tone="success"
              message="If an account exists for that address, a reset link is on its way. The link expires in 15 minutes."
            />
            <Text style={{ fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 }}>
              Open the link on this device and it will bring you straight back into the app.
            </Text>
            <Button label="Back to sign in" href="/login" variant="secondary" />
          </View>
        </>
      ) : (
        <>
          <AuthHeading
            title="Forgot password?"
            subtitle="Enter the email you sign in with and we'll send you a reset link."
          />

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
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />

          <Button
            label="Send reset link"
            onPress={onSubmit}
            loading={pending}
            disabled={!email.trim() || pending}
            size="lg"
          />

          <View style={{ marginTop: spacing.lg, alignItems: 'center' }}>
            <Button label="Back to sign in" href="/login" variant="ghost" size="sm" block={false} />
          </View>
        </>
      )}
    </AuthCard>
  );
}
