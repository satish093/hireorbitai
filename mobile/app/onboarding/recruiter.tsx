import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Banner } from '../../src/components/ui/Screen';
import { Button } from '../../src/components/ui/Button';
import { FormInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useAuth } from '../../src/context/AuthContext';
import { api, apiErrorMessage } from '../../src/services/api';
import { useTheme } from '../../src/theme';

/**
 * Recruiter self-onboarding — creates the public.recruiters row.
 *
 * The payload mirrors the backend's `.strict()` onboardingSchema:
 * full_name, phone, team, target_submissions_per_week, notes. That is the
 * complete accepted set.
 *
 * ⚠️ `manager_id` MUST NOT appear here. An earlier version of the server schema
 * was non-strict and accepted it, which let a recruiter forge their own place in
 * the v_user_relationships permission graph — assigning themselves a manager in
 * one request and gaining messaging reach they were never granted. That is now
 * pinned by a test (`recruiters.onboard onboardingSchema is .strict() and
 * excludes authority columns` in backend/src/security/patterns.test.ts).
 * Manager assignment happens through POST /recruiters/:id/managers, which is
 * MANAGER_TIER-gated.
 */
export default function RecruiterOnboardingScreen() {
  return (
    <RouteGuard allow={['RECRUITER']} bypassOnboarding>
      <RecruiterOnboardingForm />
    </RouteGuard>
  );
}

function RecruiterOnboardingForm() {
  const { profile, refreshProfile } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [team, setTeam] = useState('');
  const [target, setTarget] = useState('');
  const [notes, setNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const targetNum = target.trim() ? Number(target) : undefined;
  const targetInvalid =
    target.trim().length > 0 &&
    (Number.isNaN(targetNum) || !Number.isInteger(targetNum) || (targetNum ?? 0) < 0);

  const canSubmit = !!fullName.trim() && !targetInvalid && !pending;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { full_name: fullName.trim() };
      if (phone.trim()) payload.phone = phone.trim();
      if (team.trim()) payload.team = team.trim();
      if (targetNum !== undefined) payload.target_submissions_per_week = targetNum;
      if (notes.trim()) payload.notes = notes.trim();

      await api.post('/recruiters/onboard', payload);
      // The guard keys off profile.recruiter_id — reload before navigating.
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
            A few details and your recruiter workspace is ready.
          </Text>

          {error ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Banner tone="danger" message={error} />
            </View>
          ) : null}

          <FormInput
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            autoComplete="name"
            required
          />
          <FormInput
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <FormInput
            label="Team"
            value={team}
            onChangeText={setTeam}
            placeholder="e.g. Cloud Practice"
          />
          <FormInput
            label="Weekly submission target"
            value={target}
            onChangeText={setTarget}
            keyboardType="number-pad"
            placeholder="10"
            error={targetInvalid ? 'Enter a whole number.' : null}
          />
          <FormInput
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Optional"
          />

          <Banner
            tone="info"
            message="Your manager and group are assigned by a team lead — they'll show up automatically once set."
          />

          <View style={{ marginTop: spacing.lg }}>
            <Button
              label="Finish setup"
              onPress={onSubmit}
              disabled={!canSubmit}
              loading={pending}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
