import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme';

/**
 * App-wide crash net.
 *
 * React Native has no default error boundary, so any uncaught error thrown while
 * rendering a screen unwinds to the root and CLOSES the app. This catches those,
 * shows a themed "something went wrong" fallback with a Retry, and keeps the rest
 * of the app alive. Wrap the router with it in app/_layout.tsx.
 *
 * Class component because only class components can be error boundaries
 * (getDerivedStateFromError / componentDidCatch). The fallback UI is a function
 * component so it can read the theme via hooks.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    // Surface in dev; in a release build this is where a crash reporter would go.
    if (__DEV__) console.error('[ErrorBoundary]', error);
  }

  reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    if (this.state.error) {
      return <Fallback error={this.state.error} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

function Fallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { colors, spacing, radius, fontSize } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.md,
      }}
    >
      <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: colors.ink }}>
        Something went wrong
      </Text>
      <Text
        style={{
          fontSize: fontSize.sm,
          color: colors.muted,
          textAlign: 'center',
          lineHeight: 20,
        }}
      >
        This screen hit an unexpected error. You can try again — the rest of the app is still
        running.
      </Text>
      {__DEV__ ? (
        <Text
          style={{
            fontSize: fontSize.xs,
            color: colors.faint,
            textAlign: 'center',
            marginTop: spacing.xs,
          }}
        >
          {error.message}
        </Text>
      ) : null}
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={{
          marginTop: spacing.md,
          paddingHorizontal: spacing.xl,
          height: 48,
          borderRadius: radius.lg,
          backgroundColor: colors.ink,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.bg, fontSize: fontSize.base, fontWeight: '600' }}>
          Try again
        </Text>
      </Pressable>
    </View>
  );
}
