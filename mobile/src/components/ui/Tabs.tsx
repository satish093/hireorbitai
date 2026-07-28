import { ScrollView, Text, View, type ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { useTheme } from '../../theme';

/**
 * Horizontally-scrollable filter/tab strip — the mobile port of the web's stage
 * tablist (frontend/src/pages/Applications.tsx: `overflow-x-auto` + `border-b-2`
 * active underline + count badge). This is the single most reused missing
 * pattern: Applications, Tasks, Training, Reports all filter by a scrollable row
 * of labelled counts.
 *
 * Active tab = accent text + 2px accent underline; inactive = muted. Counts render
 * as a small pill after the label. Keep it to <=~7 items; it scrolls beyond that.
 */

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  style,
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  style?: ViewStyle;
}) {
  const { colors, spacing, fontSize } = useTheme();

  return (
    <View style={[{ borderBottomWidth: 1, borderBottomColor: colors.border }, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.xs, paddingRight: spacing.md }}
      >
        {items.map((item) => {
          const active = item.key === value;
          const tint = active ? colors.accent : colors.muted;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(item.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderBottomWidth: 2,
                marginBottom: -1,
                borderBottomColor: active ? colors.accent : 'transparent',
              }}
            >
              <Text
                style={{
                  fontSize: fontSize.sm,
                  fontWeight: active ? '700' : '600',
                  color: tint,
                }}
              >
                {item.label}
              </Text>
              {item.count != null ? (
                <View
                  style={{
                    minWidth: 18,
                    paddingHorizontal: 5,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: active ? colors.accentSoft : colors.hover,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      color: active ? colors.accent : colors.muted,
                    }}
                  >
                    {item.count}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
