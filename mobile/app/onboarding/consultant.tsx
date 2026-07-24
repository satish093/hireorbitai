import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Banner } from '../../src/components/ui/Screen';
import { Button } from '../../src/components/ui/Button';
import { FormInput, SelectInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useAuth } from '../../src/context/AuthContext';
import { api, apiErrorMessage } from '../../src/services/api';
import { isSafeHttpsUrl } from '../../src/utils/safeUrl';
import { useTheme } from '../../src/theme';

/**
 * Consultant self-onboarding — creates the public.consultants row.
 *
 * POST /consultants/onboard is gated to the CONSULTANT role alone: without that
 * gate any authenticated user could mint a stray consultants row pointing at
 * their own user_id.
 *
 * The payload mirrors the backend's `.strict()` onboardingSchema exactly. Note
 * what is NOT here and must never be added: `recruiter_id`, `user_id`,
 * `marketing_status`. `user_id` is set server-side from req.user; the other two
 * are assignment decisions that belong to a manager. Adding any of them to this
 * form would be a mass-assignment bug even though the server would reject it.
 */
export default function ConsultantOnboardingScreen() {
  return (
    <RouteGuard allow={['CONSULTANT']} bypassOnboarding>
      <ConsultantOnboardingForm />
    </RouteGuard>
  );
}

const VISA_OPTIONS = [
  { value: 'H1B', label: 'H-1B' },
  { value: 'H4_EAD', label: 'H-4 EAD' },
  { value: 'F1_OPT', label: 'F-1 OPT' },
  { value: 'F1_STEM_OPT', label: 'F-1 STEM OPT' },
  { value: 'GC', label: 'Green Card' },
  { value: 'GC_EAD', label: 'Green Card EAD' },
  { value: 'USC', label: 'US Citizen' },
  { value: 'TN', label: 'TN' },
  { value: 'L2_EAD', label: 'L-2 EAD' },
  { value: 'OTHER', label: 'Other' },
];

function ConsultantOnboardingForm() {
  const { refreshProfile } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();

  const [visaStatus, setVisaStatus] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState('');
  const [primarySkill, setPrimarySkill] = useState('');
  const [experience, setExperience] = useState('');
  const [skills, setSkills] = useState('');
  const [desiredPositions, setDesiredPositions] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [relocation, setRelocation] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [notes, setNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const linkedinInvalid = !!linkedin.trim() && !isSafeHttpsUrl(linkedin.trim());
  const experienceNum = experience.trim() ? Number(experience) : undefined;
  const experienceInvalid =
    experience.trim().length > 0 && (Number.isNaN(experienceNum) || (experienceNum ?? 0) < 0);

  const canSubmit =
    !!visaStatus && !!primarySkill.trim() && !linkedinInvalid && !experienceInvalid && !pending;

  const csv = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  const onSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      // Only keys the strict server schema accepts. Undefined values are
      // dropped rather than sent as null.
      const payload: Record<string, unknown> = {
        visa_status: visaStatus,
        primary_skill: primarySkill.trim(),
        relocation,
        remote_only: remoteOnly,
      };
      if (currentLocation.trim()) payload.current_location = currentLocation.trim();
      if (experienceNum !== undefined) payload.total_experience_years = experienceNum;
      if (skills.trim()) payload.skills = csv(skills);
      if (desiredPositions.trim()) payload.desired_positions = csv(desiredPositions);
      if (linkedin.trim()) payload.linkedin_url = linkedin.trim();
      if (notes.trim()) payload.notes = notes.trim();

      await api.post('/consultants/onboard', payload);
      // The guard keys off profile.consultant_id, so the profile must be
      // reloaded before navigating or we bounce straight back here.
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
            Tell us what you&apos;re looking for. Your recruiter uses this to match you to roles.
          </Text>

          {error ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Banner tone="danger" message={error} />
            </View>
          ) : null}

          <SelectInput
            label="Work authorization"
            value={visaStatus}
            options={VISA_OPTIONS}
            onChange={setVisaStatus}
            placeholder="Select your status"
            required
          />
          <FormInput
            label="Primary skill"
            value={primarySkill}
            onChangeText={setPrimarySkill}
            placeholder="e.g. Java, React, Data Engineering"
            required
          />
          <FormInput
            label="Years of experience"
            value={experience}
            onChangeText={setExperience}
            keyboardType="numeric"
            placeholder="5"
            error={experienceInvalid ? 'Enter a number.' : null}
          />
          <FormInput
            label="Current location"
            value={currentLocation}
            onChangeText={setCurrentLocation}
            placeholder="City, State"
          />
          <FormInput
            label="Skills"
            value={skills}
            onChangeText={setSkills}
            placeholder="React, TypeScript, AWS"
            hint="Separate with commas."
          />
          <FormInput
            label="Roles you want"
            value={desiredPositions}
            onChangeText={setDesiredPositions}
            placeholder="Senior Frontend Engineer, Full Stack Developer"
            hint="Separate with commas."
          />
          <FormInput
            label="LinkedIn"
            value={linkedin}
            onChangeText={setLinkedin}
            placeholder="https://linkedin.com/in/…"
            autoCapitalize="none"
            keyboardType="url"
            error={linkedinInvalid ? 'Must be a full https:// address.' : null}
          />

          <ToggleRow label="Open to relocation" value={relocation} onChange={setRelocation} />
          <ToggleRow label="Remote roles only" value={remoteOnly} onChange={setRemoteOnly} />

          <FormInput
            label="Anything else"
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Optional"
          />

          <Button label="Finish setup" onPress={onSubmit} disabled={!canSubmit} loading={pending} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { colors, spacing, fontSize } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 48,
        marginBottom: spacing.lg,
      }}
    >
      <Text style={{ fontSize: fontSize.md, color: colors.ink, flex: 1 }}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.borderStrong }}
      />
    </View>
  );
}
