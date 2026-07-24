import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type FlatListProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { EmptyState, ErrorState, SkeletonList } from './States';

/**
 * Screen containers.
 *
 * `.claude/rules/frontend-responsive.md` requires safe-area handling for any
 * full-bleed surface (the web used .safe-pt / .safe-pb utilities). Here that is
 * `SafeAreaView` plus explicit insets, so content clears the notch and the home
 * indicator on every device.
 *
 * <ListScreen> is the important one: it wires loading → error → empty → data in
 * a single place. Every list screen in the app uses it, so those four states
 * behave identically across all 50-odd screens instead of each one inventing its
 * own.
 */

export function Screen({
  children,
  style,
  edges = ['top'],
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: colors.bg }, style]}>
      {children}
    </SafeAreaView>
  );
}

/** Scrollable screen with pull-to-refresh. */
export function ScreenScroll({
  children,
  refreshing,
  onRefresh,
  contentStyle,
  edges,
}: {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Screen edges={edges}>
      <ScrollView
        contentContainerStyle={[
          {
            padding: spacing.lg,
            // Clear the tab bar and the home indicator.
            paddingBottom: spacing['4xl'] + insets.bottom,
            gap: spacing.lg,
          },
          contentStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </Screen>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const { colors, fontSize, spacing } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
        paddingBottom: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: colors.ink }}>{title}</Text>
        {subtitle ? (
          <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

interface ListScreenProps<T> extends Omit<FlatListProps<T>, 'data' | 'refreshControl'> {
  items: T[];
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  /** Rendered above the list, inside the scroll (filters, search, metrics). */
  header?: React.ReactNode;
  /** Number of skeleton cards to show on first load. */
  skeletonCount?: number;
}

/**
 * The list workhorse.
 *
 * State precedence is deliberate and matches the web:
 *   first load (no data yet) → skeletons
 *   error with no data       → error state with retry
 *   empty result             → empty state
 *   otherwise                → rows
 *
 * An error that arrives while data is ALREADY on screen does not blank the
 * list — stale rows beat an error card, and pull-to-refresh will retry.
 */
export function ListScreen<T>({
  items,
  loading,
  refreshing,
  error,
  onRefresh,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  header,
  skeletonCount = 5,
  ...flatListProps
}: ListScreenProps<T>) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const showSkeleton = loading && items.length === 0;
  const showError = !!error && items.length === 0 && !loading;

  return (
    <FlatList
      data={showSkeleton ? [] : items}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: spacing['4xl'] + insets.bottom,
        gap: spacing.md,
        flexGrow: 1,
      }}
      ListHeaderComponent={
        header ? <View style={{ marginBottom: spacing.sm }}>{header}</View> : null
      }
      ListEmptyComponent={
        showSkeleton ? (
          <SkeletonList count={skeletonCount} />
        ) : showError ? (
          <ErrorState message={error} onRetry={onRetry ?? onRefresh} />
        ) : (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            actionLabel={emptyActionLabel}
            onAction={onEmptyAction}
          />
        )
      }
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        ) : undefined
      }
      {...flatListProps}
    />
  );
}

/** Inline banner — non-blocking notice at the top of a screen. */
export function Banner({
  tone = 'info',
  message,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'success';
  message: string;
}) {
  const { colors, radius, fontSize, spacing } = useTheme();
  const map = {
    info: { bg: colors.brandSoft, fg: colors.brandOnSoft },
    warn: { bg: colors.warnSoft, fg: colors.warn },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    success: { bg: colors.successSoft, fg: colors.success },
  } as const;
  const t = map[tone];

  return (
    <View
      style={{
        backgroundColor: t.bg,
        borderRadius: radius.lg,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.bg,
      }}
    >
      <Text style={{ color: t.fg, fontSize: fontSize.sm, lineHeight: 20 }}>{message}</Text>
    </View>
  );
}
