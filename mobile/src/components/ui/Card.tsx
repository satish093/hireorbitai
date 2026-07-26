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
import { usePressScale } from '../../hooks/useAnim';

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

/** Big number + caption, used on every dashboard. */
export function MetricTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'success' | 'warn' | 'danger';
}) {
  const { colors, fontSize, spacing } = useTheme();
  const valueColor =
    tone === 'success'
      ? colors.success
      : tone === 'warn'
        ? colors.warn
        : tone === 'danger'
          ? colors.danger
          : colors.ink;

  return (
    <Card style={{ flex: 1, minWidth: 140 }}>
      <Text
        style={{
          fontSize: fontSize.xs,
          color: colors.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: fontSize['2xl'],
          fontWeight: '700',
          color: valueColor,
          marginTop: spacing.xs,
        }}
      >
        {value}
      </Text>
      {hint ? (
        <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}>{hint}</Text>
      ) : null}
    </Card>
  );
}
