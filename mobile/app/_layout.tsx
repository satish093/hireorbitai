import { useCallback, useEffect, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/context/AuthContext';
import { FeatureFlagsProvider } from '../src/hooks/useFeatureFlags';
import { ThemeProvider, useTheme } from '../src/theme';
import { hydrateSession } from '../src/services/session';
import { onAuthFailure, startResumeRefresh } from '../src/services/api';
import * as Notifications from 'expo-notifications';
import { configureNotificationHandler } from '../src/services/push';
import { AppLockProvider } from '../src/security/AppLock';
import { PrivacyCover } from '../src/security/PrivacyScreen';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { UpdateGate } from '../src/components/UpdateGate';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { applyInterFont } from '../src/theme/fonts';

// Hold the native splash until the encrypted session read finishes. Without
// this the app flashes the login screen for a frame before restoring a valid
// session — which reads as "it logged me out" every cold start.
void SplashScreen.preventAutoHideAsync().catch(() => {});

// Show push banners even in the foreground, and route on tap (below).
configureNotificationHandler();

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  // Load Inter (the website's typeface) so the whole app matches it. Applied
  // globally via applyInterFont() once the files are in memory.
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  if (fontsLoaded) applyInterFont();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // SecureStore is async where the web's localStorage was synchronous, so
      // this has to complete before any consumer calls getSession().
      await hydrateSession();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onLayout = useCallback(() => {
    if (ready && fontsLoaded) void SplashScreen.hideAsync().catch(() => {});
  }, [ready, fontsLoaded]);

  // Keep the native splash up until the session AND the fonts are ready, so the
  // first frame is already Inter rather than a flash of the system font.
  if (!ready || !fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayout}>
      <SafeAreaProvider>
        <ThemeProvider>
          {/* PrivacyCover is OUTSIDE the providers on purpose: it must paint
              over everything, including a lock screen or an error boundary,
              the instant the OS starts snapshotting for the app switcher. */}
          <PrivacyCover>
            {/* UpdateGate wraps AuthProvider, not the reverse: a build below
                the floor must never reach the auth handshake, since the API
                shape it expects may no longer exist. */}
            <UpdateGate>
              <AuthProvider>
                <AppLockProvider>
                  <FeatureFlagsProvider>
                    <ErrorBoundary>
                      <AppShell />
                    </ErrorBoundary>
                  </FeatureFlagsProvider>
                </AppLockProvider>
              </AuthProvider>
            </UpdateGate>
          </PrivacyCover>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell() {
  const { scheme, colors } = useTheme();
  const router = useRouter();

  useEffect(() => {
    // api.ts cannot navigate on its own (importing the router from a service
    // would create a cycle with the layout that mounts it), so it emits and we
    // navigate here. 423 = account locked; the login screen explains it.
    const stopAuth = onAuthFailure((reason) => {
      router.replace(reason === 'locked' ? '/login?locked=1' : '/login');
    });
    // Refresh an expired token when the app returns from the background —
    // without this, the first request after a resume 401s and boots the user.
    const stopResume = startResumeRefresh();

    // Deep-link on notification tap. `data.type` decides the destination; the
    // route guards still apply, so an unauthenticated tap lands on /login.
    const routeFor = (data: Record<string, unknown> | undefined) => {
      if (!data) return null;
      if (data.type === 'message' && data.peer_id) return `/(app)/chat/${data.peer_id}`;
      if (data.type === 'reminder') return '/(app)/reminders';
      if (data.type === 'interview') return '/(app)/interviews';
      return null;
    };
    const onTap = (resp: Notifications.NotificationResponse) => {
      const dest = routeFor(
        resp.notification.request.content.data as Record<string, unknown> | undefined,
      );
      if (dest) router.push(dest as never);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(onTap);
    // App opened cold from a notification tap.
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) onTap(r);
    });

    return () => {
      stopAuth();
      stopResume();
      sub.remove();
    };
  }, [router]);

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.ink,
          headerTitleStyle: { color: colors.ink, fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ title: 'Reset password' }} />
        <Stack.Screen name="reset-password" options={{ title: 'Set a new password' }} />
        <Stack.Screen name="change-password" options={{ title: 'Change password' }} />
        <Stack.Screen name="accept-invitation" options={{ title: 'Accept invitation' }} />
        <Stack.Screen name="complete-profile" options={{ title: 'Complete your profile' }} />
        <Stack.Screen name="unauthorized" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
