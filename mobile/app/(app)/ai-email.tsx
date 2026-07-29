import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Screen, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card, SectionHeader } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { FormInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useAuth } from '../../src/context/AuthContext';
import { api, apiErrorMessage } from '../../src/services/api';
import { OPERATOR_TIER } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * AI vendor-email drafting — POST /ai/vendor-email.
 *
 * OPERATOR_TIER + the `ai_email` feature flag.
 *
 * The generated text is NOT sent from here. It is drafted, then copied or
 * shared into whatever the recruiter actually sends from. That is deliberate:
 * the only sanctioned outbound-mail path in this system is Brevo, driven
 * server-side for transactional messages, and a one-tap "send" on a phone would
 * be a second, unaudited channel.
 *
 * This endpoint spends AI budget and is rate-limited per user (30 per 5 minutes
 * across all AI routes), so the failure case surfaces plainly.
 */
export default function AIEmailScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]} feature="ai_email">
      <AIEmail />
    </RouteGuard>
  );
}

function AIEmail() {
  const { colors, spacing, fontSize } = useTheme();
  const { profile } = useAuth();

  const [consultant, setConsultant] = useState('');
  const [role, setRole] = useState('');
  const [skills, setSkills] = useState('');
  const [vendor, setVendor] = useState('');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // recruiterName is required server-side; the sender IS the signed-in
  // recruiter, so it's derived rather than asked for (mirrors the web form's
  // recruiterName field, prefilled here from the session).
  const recruiterName = profile?.full_name?.trim() || profile?.email || 'Recruiter';

  const canSubmit = consultant.trim().length > 0 && role.trim().length > 0 && !pending;

  const generate = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      // Backend contract (ai.controller vendorEmail): camelCase fields,
      // consultantName + jobTitle + recruiterName required; returns { subject, body }.
      const { data } = await api.post<{ subject?: string; body?: string }>('/ai/vendor-email', {
        consultantName: consultant.trim(),
        jobTitle: role.trim(),
        recruiterName,
        vendorName: vendor.trim() || undefined,
        consultantSkills: skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      const subject = data?.subject?.trim();
      const body = data?.body?.trim() ?? '';
      setDraft(subject ? `Subject: ${subject}\n\n${body}` : body);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not draft the email.'));
    } finally {
      setPending(false);
    }
  };

  const copy = async () => {
    await Clipboard.setStringAsync(draft);
    setCopied(true);
  };

  return (
    <Screen edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <PageHeader title="AI email" subtitle="Draft a vendor pitch" />

          {error ? <Banner tone="danger" message={error} /> : null}

          <Card>
            <SectionHeader title="What are you pitching?" />
            <FormInput
              label="Consultant"
              value={consultant}
              onChangeText={setConsultant}
              placeholder="Name of the consultant"
              required
            />
            <FormInput
              label="Target role"
              value={role}
              onChangeText={setRole}
              placeholder="e.g. Senior Java Developer"
              required
            />
            <FormInput
              label="Key skills"
              value={skills}
              onChangeText={setSkills}
              placeholder="Optional — comma separated, e.g. Java, AWS, Kafka"
            />
            <FormInput
              label="Vendor"
              value={vendor}
              onChangeText={setVendor}
              placeholder="Optional — who you're pitching to"
            />
            <Button
              label="Draft email"
              onPress={generate}
              disabled={!canSubmit}
              loading={pending}
            />
          </Card>

          {draft ? (
            <Card>
              <SectionHeader title="Draft" />
              <Text
                selectable
                style={{ fontSize: fontSize.base, color: colors.ink2, lineHeight: 22 }}
              >
                {draft}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={copied ? 'Copied' : 'Copy'}
                    onPress={copy}
                    variant="secondary"
                    size="sm"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Share"
                    onPress={() => void Share.share({ message: draft })}
                    variant="secondary"
                    size="sm"
                  />
                </View>
              </View>
              <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: spacing.md }}>
                Review before sending — AI drafts can get details wrong.
              </Text>
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
