import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { Button } from './ui/Button';
import { SplashGate } from './SplashGate';
import { checkAppVersion, currentVersion, type VersionStatus } from '../services/appVersion';

/**
 * Blocks the app when the running build is below the server's hard floor.
 *
 * Why a gate at all: the web client deploys in lockstep with the backend, but
 * an app cannot. Users sit on old builds for months and store review adds
 * days, so a response-shape change would otherwise break every un-updated
 * phone with no remedy. This is the mitigation for README backend item #2.
 *
 * There is deliberately NO dismiss affordance on the blocking state. A gate a
 * user can swipe past is not a gate, and the whole point is that the build can
 * no longer talk to the API correctly.
 *
 * It re-checks on foreground, so a user who leaves to the store and returns is
 * released without having to cold-start the app.
 */
export function UpdateGate({ children }: { children: React.ReactNode }) {
  const { colors, spacing, fontSize } = useTheme();
  const [status, setStatus] = useState<VersionStatus | null>(null);
  const [checked, setChecked] = useState(false);

  const run = useCallback(async () => {
    const s = await checkAppVersion();
    setStatus(s);
    setChecked(true);
  }, []);

  useEffect(() => {
    void run();
    // Re-check when the app returns to the foreground — that is when a user
    // who just updated in the store comes back.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void run();
    });
    return () => sub.remove();
  }, [run]);

  // Hold the UI only for the FIRST check, and only briefly — checkAppVersion
  // has its own 8s timeout and fails open, so this cannot strand the boot.
  if (!checked) return <SplashGate />;

  if (!status?.updateRequired) return <>{children}</>;

  const openStore = () => {
    if (status.storeUrl) void Linking.openURL(status.storeUrl).catch(() => {});
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.lg,
      }}
    >
      <Text
        style={{
          fontSize: fontSize.xl,
          fontWeight: '700',
          color: colors.ink,
          textAlign: 'center',
        }}
      >
        Update required
      </Text>
      <Text
        style={{
          fontSize: fontSize.md,
          color: colors.muted,
          textAlign: 'center',
          lineHeight: 22,
        }}
      >
        This version of HireOrbit AI is no longer supported. Update to continue — your work is saved
        on the server and will be waiting.
      </Text>
      <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>
        You have {currentVersion() || 'an old build'}
        {status.latestVersion ? ` · latest is ${status.latestVersion}` : ''}
      </Text>
      <Button label="Update now" onPress={openStore} />
    </View>
  );
}
