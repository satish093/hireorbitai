import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Banner } from '../src/components/ui/Screen';
import { Button } from '../src/components/ui/Button';
import { FormInput } from '../src/components/ui/Inputs';
import { RouteGuard } from '../src/components/RouteGuard';
import { useAuth } from '../src/context/AuthContext';
import { api, apiErrorMessage } from '../src/services/api';
import { isSafeHttpsUrl } from '../src/utils/safeUrl';
import { REQUIRED_PROFILE_FIELDS } from '../src/utils/profileComplete';
import type { UserProfile } from '../src/types';
import { useTheme } from '../src/theme';

/**
 * Mandatory profile completion.
 *
 * The gate is derived from the profile data itself (no flag, no backfill), so
 * existing users with blank fields are caught here on their next sign-in. The
 * field list is REQUIRED_PROFILE_FIELDS, shared with the guard — the form and
 * the gate can't disagree about what "complete" means.
 *
 * `bypassProfileCompletion` prevents the guard redirecting this screen to itself.
 */
export default function CompleteProfileScreen() {
  return (
    <RouteGuard bypassProfileCompletion bypassOnboarding>
      <CompleteProfileForm />
    </RouteGuard>
  );
}

type FormState = Partial<Record<(typeof REQUIRED_PROFILE_FIELDS)[number], string>>;

const LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  phone: 'Phone',
  address_line1: 'Address',
  city: 'City',
  state: 'State / Province',
  postal_code: 'Postal code',
  country: 'Country',
  linkedin_url: 'LinkedIn profile',
};

export function CompleteProfileForm() {
  const { profile, refreshProfile } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();

  const [form, setForm] = useState<FormState>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Seed from whatever the profile already has so the user only fills gaps.
  useEffect(() => {
    if (!profile) return;
    const seed: FormState = {};
    for (const key of REQUIRED_PROFILE_FIELDS) {
      const v = profile[key];
      if (typeof v === 'string') seed[key] = v;
    }
    setForm(seed);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const linkedinInvalid = !!form.linkedin_url?.trim() && !isSafeHttpsUrl(form.linkedin_url.trim());

  const missing = REQUIRED_PROFILE_FIELDS.filter((k) => !form[k]?.trim());
  const canSubmit = missing.length === 0 && !linkedinInvalid && !pending;

  const onSubmit = async () => {
    if (!canSubmit || !profile) return;
    setPending(true);
    setError(null);
    try {
      // PATCH /users/:id validates the same fields server-side against a strict
      // schema; only these keys are sent, never a spread of local state.
      const payload: Record<string, string> = {};
      for (const key of REQUIRED_PROFILE_FIELDS) payload[key] = (form[key] ?? '').trim();
      await api.patch<UserProfile>(`/users/${profile.id}`, payload);
      await refreshProfile();
      router.replace('/(app)/dashboard');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save your profile.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['4xl'] }}
          keyboardShouldPersistTaps="handled"
        >
          <Text
            style={{
              fontSize: fontSize.base,
              color: colors.muted,
              lineHeight: 22,
              marginBottom: spacing.xl,
            }}
          >
            We need a few details before you can use the workspace. This is a one-time step.
          </Text>

          {error ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Banner tone="danger" message={error} />
            </View>
          ) : null}

          <FormInput
            label={LABELS.first_name}
            value={form.first_name ?? ''}
            onChangeText={set('first_name')}
            autoComplete="given-name"
            required
          />
          <FormInput
            label={LABELS.last_name}
            value={form.last_name ?? ''}
            onChangeText={set('last_name')}
            autoComplete="family-name"
            required
          />
          <FormInput
            label={LABELS.phone}
            value={form.phone ?? ''}
            onChangeText={set('phone')}
            keyboardType="phone-pad"
            autoComplete="tel"
            required
          />
          <FormInput
            label={LABELS.address_line1}
            value={form.address_line1 ?? ''}
            onChangeText={set('address_line1')}
            required
          />
          <FormInput
            label={LABELS.city}
            value={form.city ?? ''}
            onChangeText={set('city')}
            required
          />
          <FormInput
            label={LABELS.state}
            value={form.state ?? ''}
            onChangeText={set('state')}
            required
          />
          <FormInput
            label={LABELS.postal_code}
            value={form.postal_code ?? ''}
            onChangeText={set('postal_code')}
            required
          />
          <FormInput
            label={LABELS.country}
            value={form.country ?? ''}
            onChangeText={set('country')}
            required
          />
          <FormInput
            label={LABELS.linkedin_url}
            value={form.linkedin_url ?? ''}
            onChangeText={set('linkedin_url')}
            placeholder="https://linkedin.com/in/…"
            autoCapitalize="none"
            keyboardType="url"
            error={linkedinInvalid ? 'Must be a full https:// address.' : null}
            required
          />

          <Button
            label="Save and continue"
            onPress={onSubmit}
            disabled={!canSubmit}
            loading={pending}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
