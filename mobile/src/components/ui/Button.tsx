import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTheme } from '../../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Props {
  label: string;
  onPress?: () => void;
  /** Navigate instead of calling onPress. Mutually exclusive with onPress. */
  href?: Href;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Stretch to the container width. Default true — the common case on mobile. */
  block?: boolean;
  /** Rendered before the label. */
  icon?: React.ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

/**
 * The one button.
 *
 * Height comes from the theme (48px), not from the web's `h-9` (36px) — 36 is
 * below the 44px minimum touch target that .claude/rules/frontend-responsive.md
 * requires. FormInput and SelectInput use the same value so a stacked form
 * stays visually aligned, which is the property the web's h-9 rule protects.
 */
export function Button({
  label,
  onPress,
  href,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  block = true,
  icon,
  style,
  accessibilityLabel,
}: Props) {
  const { colors, radius, fontSize, controlHeight, spacing } = useTheme();
  const router = useRouter();

  const isDisabled = !!disabled || !!loading;

  const height = size === 'sm' ? 40 : size === 'lg' ? 56 : controlHeight;
  const textSize = size === 'sm' ? fontSize.sm : size === 'lg' ? fontSize.md : fontSize.base;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.ink, fg: colors.bg, border: colors.ink },
    secondary: { bg: colors.surface, fg: colors.ink, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.accent, border: 'transparent' },
    danger: { bg: colors.danger, fg: '#ffffff', border: colors.danger },
  };
  const tone = palette[variant];

  const handlePress = () => {
    if (isDisabled) return;
    if (href) router.push(href);
    else onPress?.();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          minHeight: height,
          borderRadius: radius.lg,
          backgroundColor: tone.bg,
          borderColor: tone.border,
          paddingHorizontal: spacing.xl,
          alignSelf: block ? 'stretch' : 'flex-start',
          opacity: isDisabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tone.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <View style={{ marginRight: spacing.sm }}>{icon}</View> : null}
          <Text numberOfLines={1} style={{ color: tone.fg, fontSize: textSize, fontWeight: '600' }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
