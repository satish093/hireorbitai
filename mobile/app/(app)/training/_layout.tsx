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
      <Stack.Screen name="plan" options={{ title: 'Study plan' }} />
      <Stack.Screen name="create" options={{ title: 'New course' }} />
      {/* Dynamic detail routes set their own titles via <Stack.Screen> inline. */}
      <Stack.Screen name="course/[id]" options={{ title: 'Course' }} />
      <Stack.Screen name="lesson/[id]" options={{ title: 'Lesson' }} />
      <Stack.Screen name="quiz/[id]" options={{ title: 'Quiz' }} />
      <Stack.Screen name="edit/[id]" options={{ title: 'Edit course' }} />
    </Stack>
  );
}
