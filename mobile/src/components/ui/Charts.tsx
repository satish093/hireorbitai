import { Text, View } from 'react-native';
import { useTheme } from '../../theme';

/**
 * Tiny data-viz primitives, pure React Native — the web ships NO chart library
 * (its dashboards hand-roll CSS bars), so neither do we. Colours are passed in by
 * the caller (usually from a Pill status-tone map) so the viz stays generic.
 *
 * StackedBar  — one thin rounded bar split into proportional coloured segments
 *               (web ManagerDashboard `StackedBar`: tasks-by-status).
 * BreakdownRow — a labelled row with a proportional coloured bar + count
 *               (web "by priority" breakdown grid).
 */

export interface Segment {
  key: string;
  value: number;
  color: string;
  label?: string;
}

export function StackedBar({ segments, height = 8 }: { segments: Segment[]; height?: number }) {
  const { colors } = useTheme();
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  if (total === 0) {
    return <View style={{ height, borderRadius: height / 2, backgroundColor: colors.hover }} />;
  }

  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: colors.hover,
        overflow: 'hidden',
        flexDirection: 'row',
      }}
    >
      {segments.map((seg) =>
        seg.value > 0 ? (
          <View
            key={seg.key}
            style={{ width: `${(seg.value / total) * 100}%`, backgroundColor: seg.color }}
          />
        ) : null,
      )}
    </View>
  );
}

/** Legend row for a StackedBar: a colour dot + label + count, wrapping grid-style. */
export function LegendRow({ segments }: { segments: Segment[] }) {
  const { colors, spacing, fontSize } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm }}
    >
      {segments.map((seg) => (
        <View key={seg.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: seg.color }} />
          <Text style={{ fontSize: fontSize.xs, color: colors.muted }}>
            {seg.label ?? seg.key}{' '}
            <Text style={{ fontWeight: '700', color: colors.ink2 }}>{seg.value}</Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

export function BreakdownRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const { colors, fontSize, spacing } = useTheme();
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.ink2 }}>{label}</Text>
        <Text style={{ fontSize: fontSize.sm, fontWeight: '700', color: colors.ink }}>{value}</Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: colors.hover,
          overflow: 'hidden',
        }}
      >
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color }} />
      </View>
    </View>
  );
}
