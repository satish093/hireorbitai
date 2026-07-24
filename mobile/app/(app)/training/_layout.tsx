import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';

/**
 * Training stack.
 *
 * `my` is the initial route so the consultant tab (which targets the stack, not
 * a leaf) opens on the learner view rather than the admin catalog.
 */
export const unstable_settings = { initialRouteName: 'my' };

export default function TrainingLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerTitleStyle: { color: colors.ink, fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="my" options={{ title: 'My training' }} />
      <Stack.Screen name="courses" options={{ title: 'Courses' }} />
      <Stack.Screen name="assignments" options={{ title: 'Assignments' }} />
      <Stack.Screen name="reports" options={{ title: 'Training reports' }} />
      <Stack.Screen name="ai-activity" options={{ title: 'AI activity' }} />
    </Stack>
  );
}
