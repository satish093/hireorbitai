import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { Screen, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card, SectionHeader, DetailRow, Divider } from '../../src/components/ui/Card';
import { Avatar } from '../../src/components/ui/Avatar';
import { Pill } from '../../src/components/ui/Pill';
import { Button } from '../../src/components/ui/Button';
import { FormInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useAuth } from '../../src/context/AuthContext';
import { api, apiErrorMessage } from '../../src/services/api';
import { isSafeHttpsUrl } from '../../src/utils/safeUrl';
import { ROLE_LABEL } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * My profile — PATCH /users/:id.
 *
 * Only the user's OWN editable fields are sent. Note what is deliberately
 * absent and must never be added here: `role`, `group_id`, `capabilities`,
 * `is_active`, `status`. Those are authority columns set through dedicated
 * admin routes, and including them would be a mass-assignment attempt — the
 * server's strict schema would reject it, but the client shouldn't be trying.
 */
export default function ProfileScreen() {
  return (
    <RouteGuard>
      <Profile />
    </RouteGuard>
  );
}

function Profile() {
  const { profile, refreshProfile } = useAuth();
  const { colors, spacing, fontSize } = useTheme();

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    country: '',
    linkedin_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setForm({
      first_name: profile.first_name ?? '',
      last_name: profile.last_name ?? '',
      phone: profile.phone ?? '',
      address_line1: profile.address_line1 ?? '',
      address_line2: profile.address_line2 ?? '',
      city: profile.city ?? '',
      state: profile.state ?? '',
      postal_code: profile.postal_code ?? '',
      country: profile.country ?? '',
      linkedin_url: profile.linkedin_url ?? '',
    });
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setSaved(false);
  };

  const linkedinInvalid = !!form.linkedin_url.trim() && !isSafeHttpsUrl(form.linkedin_url.trim());

  const save = async () => {
    if (!profile || linkedinInvalid) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(form)) payload[k] = v.trim() || null;
      await api.patch(`/users/${profile.id}`, payload);
      await refreshProfile();
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save your profile.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'My profile' }} />
      <Screen edges={['bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
            keyboardShouldPersistTaps="handled"
          >
            <PageHeader title="My profile" />

            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar
                  id={profile?.id}
                  name={profile?.full_name}
                  email={profile?.email}
                  uri={profile?.avatar_url}
                  size={56}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: colors.ink }}>
                    {profile?.full_name?.trim() || profile?.email}
                  </Text>
                  <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>
                    {profile?.email}
                  </Text>
                  <View style={{ marginTop: 6 }}>
                    <Pill label={profile ? ROLE_LABEL[profile.role] : '—'} tone="brand" size="sm" />
                  </View>
                </View>
              </View>

              <View style={{ marginTop: spacing.lg }}>
                <DetailRow label="Role" value={profile ? ROLE_LABEL[profile.role] : '—'} />
                <Divider />
                <DetailRow label="Account" value={profile?.is_active ? 'Active' : 'Inactive'} />
              </View>
              <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: spacing.sm }}>
                Your role and group are set by an administrator.
              </Text>
            </Card>

            {error ? <Banner tone="danger" message={error} /> : null}
            {saved ? <Banner tone="success" message="Profile saved." /> : null}

            <Card>
              <SectionHeader title="Personal details" />
              <FormInput
                label="First name"
                value={form.first_name}
                onChangeText={set('first_name')}
              />
              <FormInput label="Last name" value={form.last_name} onChangeText={set('last_name')} />
              <FormInput
                label="Phone"
                value={form.phone}
                onChangeText={set('phone')}
                keyboardType="phone-pad"
              />
              <FormInput
                label="LinkedIn"
                value={form.linkedin_url}
                onChangeText={set('linkedin_url')}
                placeholder="https://linkedin.com/in/…"
                autoCapitalize="none"
                keyboardType="url"
                error={linkedinInvalid ? 'Must be a full https:// address.' : null}
              />
            </Card>

            <Card>
              <SectionHeader title="Address" />
              <FormInput
                label="Address"
                value={form.address_line1}
                onChangeText={set('address_line1')}
              />
              <FormInput
                label="Apt / Suite"
                value={form.address_line2}
                onChangeText={set('address_line2')}
              />
              <FormInput label="City" value={form.city} onChangeText={set('city')} />
              <FormInput label="State / Province" value={form.state} onChangeText={set('state')} />
              <FormInput
                label="Postal code"
                value={form.postal_code}
                onChangeText={set('postal_code')}
              />
              <FormInput label="Country" value={form.country} onChangeText={set('country')} />
            </Card>

            <Button
              label="Save profile"
              onPress={save}
              loading={saving}
              disabled={saving || linkedinInvalid}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </>
  );
}
