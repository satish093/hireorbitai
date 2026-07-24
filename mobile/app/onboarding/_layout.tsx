import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme';

export default function OnboardingLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerTitleStyle: { color: colors.ink, fontWeight: '700' },
        headerShadowVisible: false,
        // No back button: onboarding is a gate, not a detour. The guard sends
        // the user straight back here anyway until the row exists.
        headerBackVisible: false,
        gestureEnabled: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="consultant" options={{ title: 'Set up your profile' }} />
      <Stack.Screen name="recruiter" options={{ title: 'Set up your profile' }} />
    </Stack>
  );
}
