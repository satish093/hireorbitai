import { useState } from 'react';
import { Text, View } from 'react-native';
import { ScreenScroll, PageHeader, Banner } from '../../../src/components/ui/Screen';
import { Card, SectionHeader, DetailRow, Divider } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
import { Button } from '../../../src/components/ui/Button';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { api, apiErrorMessage } from '../../../src/services/api';
import { OWNER_TIER } from '../../../src/types';
import { useTheme } from '../../../src/theme';

interface TokenStatus {
  ok?: boolean;
  provider?: string | null;
  model?: string | null;
  expires_at?: string | null;
  message?: string | null;
}

/**
 * AI settings — POST /training/ai/check-token.
 *
 * OWNER_TIER only.
 *
 * READ + HEALTH CHECK ONLY, and that is a security decision rather than a
 * shortcut. The provider credentials themselves (ANTHROPIC_API_KEY,
 * ANTHROPIC_OAUTH_TOKEN, GROQ_API_KEY, GEMINI_API_KEY) live in backend/.env on
 * the VPS and are never sent to any client. The app can ask "is the credential
 * working?" and get a yes/no; it can neither read nor set one.
 *
 * The OAuth login flow (/training/ai/claude-auth/start) is deliberately absent:
 * it is a browser redirect dance that belongs on the web console.
 */
export default function AISettingsScreen() {
  return (
    <RouteGuard allow={[...OWNER_TIER]}>
      <AISettings />
    </RouteGuard>
  );
}

function AISettings() {
  const { colors, spacing, fontSize } = useTheme();
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const { data } = await api.post<TokenStatus>('/training/ai/check-token', {});
      setStatus(data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not reach the AI provider.'));
      setStatus(null);
    } finally {
      setChecking(false);
    }
  };

  return (
    <ScreenScroll edges={[]}>
      <PageHeader title="AI settings" subtitle="Provider health" />

      <Banner
        tone="info"
        message="Provider keys live in the server environment and are never sent to the app. This screen can test a credential, not read or change one."
      />

      <Card>
        <SectionHeader title="Credential check" />
        {error ? <Banner tone="danger" message={error} /> : null}

        {status ? (
          <View style={{ marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Pill
                label={status.ok ? 'Working' : 'Failing'}
                tone={status.ok ? 'success' : 'danger'}
              />
              {status.provider ? <Pill label={status.provider} tone="brand" size="sm" /> : null}
            </View>
            {status.message ? (
              <Text
                style={{
                  fontSize: fontSize.sm,
                  color: colors.muted,
                  marginTop: spacing.sm,
                  lineHeight: 19,
                }}
              >
                {status.message}
              </Text>
            ) : null}
            <View style={{ marginTop: spacing.md }}>
              <DetailRow label="Model" value={status.model ?? '—'} />
              {status.expires_at ? (
                <>
                  <Divider />
                  <DetailRow
                    label="Token expires"
                    value={new Date(status.expires_at).toLocaleString()}
                  />
                </>
              ) : null}
            </View>
          </View>
        ) : (
          <Text
            style={{
              fontSize: fontSize.sm,
              color: colors.muted,
              marginTop: spacing.xs,
              lineHeight: 19,
            }}
          >
            Run a check to confirm the configured AI credential still works.
          </Text>
        )}

        <View style={{ marginTop: spacing.lg }}>
          <Button label="Check credential" onPress={check} loading={checking} variant="secondary" />
        </View>
      </Card>

      <Card>
        <SectionHeader title="Cost controls" />
        <Text style={{ fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 }}>
          The generation chain is free-by-default: Groq, then rule-based heuristics. Gemini and
          Anthropic are opt-in per environment (AI_ALLOW_GEMINI / AI_ALLOW_ANTHROPIC), because a
          billing-enabled key is charged per call and cannot be told apart from a free-tier one at
          runtime.
        </Text>
        <Text
          style={{
            fontSize: fontSize.sm,
            color: colors.muted,
            lineHeight: 20,
            marginTop: spacing.sm,
          }}
        >
          AI endpoints are separately rate-limited per user, well below the global ceiling.
        </Text>
      </Card>

      <Card>
        <SectionHeader title="Claude OAuth" />
        <Text style={{ fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 }}>
          Connecting a Claude.ai subscription token is a browser redirect flow — use the web console
          for that.
        </Text>
      </Card>
    </ScreenScroll>
  );
}
