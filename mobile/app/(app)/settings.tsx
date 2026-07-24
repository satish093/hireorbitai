import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { ScreenScroll, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card, SectionHeader, Divider } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { SelectInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useAuth } from '../../src/context/AuthContext';
import { useAppLock } from '../../src/security/AppLock';
import { api, apiErrorMessage } from '../../src/services/api';
import { config as appConfig } from '../../src/config/env';
import { useTheme, type ThemeMode } from '../../src/theme';

/**
 * Settings — appearance, security, notifications.
 *
 * The security section is the reason this screen exists on mobile and has no
 * web equivalent: a phone is lost, lent and stolen in ways a laptop session
 * isn't, so the device-level protections are surfaced here rather than buried.
 */
export default function SettingsScreen() {
  return (
    <RouteGuard>
      <Settings />
    </RouteGuard>
  );
}

function Settings() {
  const { profile, refreshProfile } = useAuth();
  const { colors, spacing, fontSize, mode, setMode } = useTheme();
  const appLock = useAppLock();

  const [jobAlerts, setJobAlerts] = useState<boolean>(profile?.job_alerts !== false);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleJobAlerts = async (next: boolean) => {
    setJobAlerts(next);
    setSavingAlerts(true);
    setError(null);
    try {
      await api.post('/auth/job-alerts', { job_alerts: next });
      await refreshProfile();
    } catch (err) {
      setJobAlerts(!next); // revert
      setError(apiErrorMessage(err, 'Could not save that preference.'));
    } finally {
      setSavingAlerts(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Settings' }} />
      <ScreenScroll edges={[]}>
        <PageHeader title="Settings" />

        {error ? <Banner tone="danger" message={error} /> : null}

        <Card>
          <SectionHeader title="Appearance" />
          <SelectInput<ThemeMode>
            label="Theme"
            value={mode}
            options={[
              { value: 'system', label: 'Match device', description: 'Follow your phone setting' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={setMode}
          />
        </Card>

        <Card>
          <SectionHeader
            title="Security"
            subtitle="These protect this device. Your account is protected by the server regardless."
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 48,
              gap: spacing.md,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: fontSize.md, color: colors.ink }}>Require unlock</Text>
              <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                {appLock.available
                  ? 'Ask for Face ID, fingerprint or your passcode after a minute in the background.'
                  : 'Unavailable — no biometrics or passcode set up on this device.'}
              </Text>
            </View>
            <Switch
              value={appLock.enabled}
              disabled={!appLock.available}
              onValueChange={(v) => void appLock.setEnabled(v)}
              trackColor={{ true: colors.accent, false: colors.borderStrong }}
            />
          </View>

          <Divider />

          <View style={{ paddingTop: spacing.md }}>
            <Text style={{ fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 }}>
              Your sign-in token is stored in the device keychain, never in plain files. Screens
              showing personal documents and billing block screenshots.
            </Text>
          </View>
        </Card>

        <Card>
          <SectionHeader title="Notifications" />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 48,
              gap: spacing.md,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: fontSize.md, color: colors.ink }}>Daily job alerts</Text>
              <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                Email digest of jobs matching your profile.
              </Text>
            </View>
            <Switch
              value={jobAlerts}
              disabled={savingAlerts}
              onValueChange={(v) => void toggleJobAlerts(v)}
              trackColor={{ true: colors.accent, false: colors.borderStrong }}
            />
          </View>

          <View style={{ marginTop: spacing.md }}>
            <Banner
              tone="info"
              message="Push notifications aren't available yet. While the app is closed you won't be alerted about new messages — open the app to catch up."
            />
          </View>
        </Card>

        <Card>
          <SectionHeader title="Account" />
          <Button label="Change password" href="/change-password" variant="secondary" />
        </Card>

        <Card>
          <SectionHeader title="About" />
          <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>
            Connected to {appConfig.apiBaseUrl}
          </Text>
          <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 4 }}>
            Signed in as {profile?.email ?? '—'}
          </Text>
        </Card>
      </ScreenScroll>
    </>
  );
}
