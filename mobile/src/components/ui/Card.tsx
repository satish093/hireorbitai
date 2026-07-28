import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTheme } from '../../theme';
import { usePressScale, useCountUp } from '../../hooks/useAnim';

interface CardProps {
  children: React.ReactNode;
  /** Makes the whole card tappable. */
  onPress?: () => void;
  href?: Href;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

/** Surface container — the mobile equivalent of the web's bordered card. */
export function Card({ children, onPress, href, style, padded = true }: CardProps) {
  const { colors, radius, spacing } = useTheme();
  const router = useRouter();
  const press = usePressScale(0.98);

  const body = (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.xl,
          padding: padded ? spacing.lg : 0,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress && !href) return body;

  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        onPress={() => (href ? router.push(href) : onPress?.())}
        onPressIn={press.handlers.onPressIn}
        onPressOut={press.handlers.onPressOut}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}

/** Section title with an optional trailing action. */
export function SectionHeader({
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
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: spacing.md,
        gap: spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: colors.ink }}>{title}</Text>
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

/** Label/value row used across every detail screen. */
export function DetailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value?: React.ReactNode;
  tone?: 'default' | 'muted';
}) {
  const { colors, fontSize, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingVertical: spacing.sm,
        gap: spacing.lg,
      }}
    >
      <Text style={{ fontSize: fontSize.sm, color: colors.muted, flexShrink: 0 }}>{label}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        {typeof value === 'string' || typeof value === 'number' ? (
          <Text
            style={{
              fontSize: fontSize.base,
              color: tone === 'muted' ? colors.muted : colors.ink,
              textAlign: 'right',
            }}
          >
            {value === '' || value == null ? '—' : value}
          </Text>
        ) : (
          (value ?? <Text style={{ color: colors.muted }}>—</Text>)
        )}
      </View>
    </View>
  );
}

/** Hairline divider matching the card border colour. */
export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
        marginLeft: inset,
      }}
    />
  );
}

export type MetricAccent = 'brand' | 'blue' | 'green' | 'amber' | 'red' | 'slate';

/**
 * KPI tile — the mobile port of the web KpiCard/DashboardCard: a 3px left accent
 * bar, uppercase label, large count-up value, and an optional trend delta (▲ in
 * success colour when `up`). Used for the 4-up metric rows on every dashboard.
 */
export function MetricTile({
  label,
  value,
  hint,
  tone,
  accent,
  delta,
  up,
  onPress,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'success' | 'warn' | 'danger';
  /** Left accent-bar colour, matching the web KpiCard accents. */
  accent?: MetricAccent;
  /** Trend text under the value, e.g. "+3 this week". */
  delta?: string;
  /** Renders ▲ in success colour before the delta. */
  up?: boolean;
  onPress?: () => void;
}) {
  const { colors, fontSize, spacing, radius } = useTheme();
  const isNumber = typeof value === 'number';
  const animated = useCountUp(isNumber ? (value as number) : 0);

  const valueColor =
    tone === 'success'
      ? colors.success
      : tone === 'warn'
        ? colors.warn
        : tone === 'danger'
          ? colors.danger
          : colors.ink;

  const accentColor: Record<MetricAccent, string> = {
    brand: colors.accent,
    blue: colors.accent2,
    green: colors.success,
    amber: colors.warn,
    red: colors.danger,
    slate: colors.faint,
  };

  return (
    <Card style={{ flex: 1, minWidth: 140 }} onPress={onPress}>
      {accent ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            borderTopLeftRadius: radius.xl,
            borderBottomLeftRadius: radius.xl,
            backgroundColor: accentColor[accent],
          }}
        />
      ) : null}
      <Text
        style={{
          fontSize: fontSize.xs,
          color: colors.ink2,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontWeight: '700',
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: fontSize['2xl'],
          fontWeight: '800',
          color: valueColor,
          marginTop: spacing.xs,
        }}
      >
        {isNumber ? animated : value}
      </Text>
      {delta ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs }}>
          {up ? (
            <Text style={{ fontSize: fontSize.xs, fontWeight: '700', color: colors.success }}>
              ▲
            </Text>
          ) : null}
          <Text style={{ fontSize: fontSize.xs, color: colors.muted }}>{delta}</Text>
        </View>
      ) : null}
      {hint ? (
        <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}>{hint}</Text>
      ) : null}
    </Card>
  );
}
