import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Button } from './Button';

/**
 * Empty / error / loading states.
 *
 * Ported from the web's <EmptyState> and <Skeleton> family. The rule that
 * matters: never render a bare "Loading…" string — use a Skeleton, so the
 * layout doesn't jump when data lands.
 */

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  compact,
  icon = '◎',
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Use when nested inside an already-bordered card. */
  compact?: boolean;
  icon?: string;
}) {
  const { colors, spacing, fontSize } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: compact ? spacing.xl : spacing['4xl'],
        paddingHorizontal: spacing.xl,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.hover,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        }}
      >
        <Text style={{ fontSize: 20, color: colors.faint }}>{icon}</Text>
      </View>
      <Text
        style={{
          fontSize: fontSize.md,
          fontWeight: '600',
          color: colors.ink,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {description ? (
        <Text
          style={{
            fontSize: fontSize.sm,
            color: colors.muted,
            textAlign: 'center',
            marginTop: spacing.xs,
            lineHeight: 20,
            maxWidth: 320,
          }}
        >
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.lg, minWidth: 200 }}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  compact,
}: {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { colors, spacing, fontSize, radius } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: compact ? spacing.xl : spacing['3xl'],
        paddingHorizontal: spacing.xl,
      }}
    >
      <View
        style={{
          backgroundColor: colors.dangerSoft,
          borderRadius: radius.lg,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          maxWidth: 380,
        }}
      >
        <Text style={{ color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' }}>
          {message}
        </Text>
      </View>
      {onRetry ? (
        <View style={{ marginTop: spacing.lg, minWidth: 180 }}>
          <Button label="Try again" onPress={onRetry} variant="secondary" size="sm" />
        </View>
      ) : null}
    </View>
  );
}

/** Shimmering placeholder block. */
export function Skeleton({
  width,
  height = 14,
  radius: r,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const { colors, radius: themeRadius } = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          width: width ?? '100%',
          height,
          borderRadius: r ?? themeRadius.sm,
          backgroundColor: colors.hover,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

/** Card-shaped skeleton — the default list placeholder. */
export function SkeletonCard() {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.xl,
        padding: spacing.lg,
        gap: spacing.sm,
      }}
    >
      <Skeleton width="60%" height={16} />
      <Skeleton width="85%" height={12} />
      <Skeleton width="40%" height={12} />
    </View>
  );
}

/** N stacked skeleton cards — what a list screen shows on first load. */
export function SkeletonList({ count = 5 }: { count?: number }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

/** Grid of metric skeletons — what a dashboard shows on first load. */
export function SkeletonMetricGrid({ count = 4 }: { count?: number }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flex: 1, minWidth: 140 }}>
          <SkeletonCard />
        </View>
      ))}
    </View>
  );
}
