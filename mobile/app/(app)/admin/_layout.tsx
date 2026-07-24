import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';

export const unstable_settings = { initialRouteName: 'users' };

export default function AdminLayout() {
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
      <Stack.Screen name="users" options={{ title: 'Users' }} />
      <Stack.Screen name="audit-log" options={{ title: 'Audit log' }} />
      <Stack.Screen name="features" options={{ title: 'Feature flags' }} />
      <Stack.Screen name="groups" options={{ title: 'User groups' }} />
      <Stack.Screen name="deactivated" options={{ title: 'Deactivated' }} />
      <Stack.Screen name="ai-settings" options={{ title: 'AI settings' }} />
      <Stack.Screen name="calls-usage" options={{ title: 'Call usage' }} />
    </Stack>
  );
}
