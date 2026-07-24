import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '../theme';

/**
 * Full-screen loading gate — the mobile equivalent of the web's
 * <LoadingScreen />. Shown while the auth context bootstraps and while a
 * feature-flag map resolves.
 *
 * Deliberately quiet: no logo, no copy. It is on screen for a few hundred
 * milliseconds in the normal case, and anything busier reads as a flash.
 */
export function SplashGate() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
      }}
    >
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}
