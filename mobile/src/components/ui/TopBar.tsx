import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from './Icon';
import { useTheme } from '../../theme';

/**
 * Per-page top bar — matches the website's mobile header: the page title on the
 * left, a notifications bell + a light/dark theme toggle on the right, sitting on
 * the page background with a hairline bottom border. Optional back chevron and
 * an extra trailing action slot.
 *
 * Use this at the top of every screen in place of the old PageHeader so the app
 * carries the same chrome as the site on every page.
 */
export function PageTopBar({
  title,
  subtitle,
  showBack,
  onBack,
  right,
  bell = true,
}: {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  /** Extra trailing element rendered before the bell + toggle. */
  right?: React.ReactNode;
  /** Show the notifications bell (navigates to reminders). Default true. */
  bell?: boolean;
}) {
  const { colors, fontSize, spacing, scheme, setMode } = useTheme();
  const router = useRouter();

  const IconBtn = ({
    name,
    onPress,
    label,
  }: {
    name: Parameters<typeof Icon>[0]['name'];
    onPress: () => void;
    label: string;
  }) => (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={name} size={20} color={colors.ink2} />
    </Pressable>
  );

  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.bg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
      }}
    >
      {showBack ? (
        <Pressable
          onPress={onBack ?? (() => router.back())}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{
            marginLeft: -6,
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scaleX: -1 }],
          }}
        >
          <Icon name="chevronRight" size={22} color={colors.ink} strokeWidth={2} />
        </Pressable>
      ) : null}

      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: fontSize.xl, fontWeight: '700', color: colors.ink }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 1 }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right}
      {bell ? (
        <IconBtn name="bell" label="Reminders" onPress={() => router.push('/(app)/reminders')} />
      ) : null}
      <IconBtn
        name={scheme === 'dark' ? 'sun' : 'moon'}
        label="Toggle theme"
        onPress={() => setMode(scheme === 'dark' ? 'light' : 'dark')}
      />
    </View>
  );
}
