import { StyleSheet, Text, View } from 'react-native';
import { useTheme, type Palette } from '../../theme';

/**
 * Status / priority / tag badge — the mobile <Pill>.
 *
 * Port of the web's shared Pill. The rule from
 * .claude/rules/frontend-responsive.md carries over verbatim: **add a new tone,
 * never restyle one off**. Every status badge in the app renders through here so
 * "SUBMITTED" looks the same on the applications list, the job detail screen and
 * the dashboard.
 */
export type PillTone = 'neutral' | 'accent' | 'brand' | 'success' | 'warn' | 'danger' | 'info';

interface Props {
  label: string;
  tone?: PillTone;
  /** Small leading dot — used for presence and status rows. */
  dot?: boolean;
  size?: 'sm' | 'md';
}

function toneColors(tone: PillTone, c: Palette): { bg: string; fg: string; border: string } {
  switch (tone) {
    case 'accent':
      return { bg: c.accentSoft, fg: c.accent, border: c.accentSoft };
    case 'brand':
      return { bg: c.brandSoft, fg: c.brandOnSoft, border: c.brandSoftBorder };
    case 'success':
      return { bg: c.successSoft, fg: c.success, border: c.successSoft };
    case 'warn':
      return { bg: c.warnSoft, fg: c.warn, border: c.warnSoft };
    case 'danger':
      return { bg: c.dangerSoft, fg: c.danger, border: c.dangerSoft };
    case 'info':
      return { bg: c.brandSoft, fg: c.brandOnSoft, border: c.brandSoftBorder };
    case 'neutral':
    default:
      return { bg: c.hover, fg: c.ink2, border: c.border };
  }
}

export function Pill({ label, tone = 'neutral', dot, size = 'md' }: Props) {
  const { colors, radius, fontSize, spacing } = useTheme();
  const t = toneColors(tone, colors);

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: t.bg,
          borderColor: t.border,
          borderRadius: radius.pill,
          paddingHorizontal: size === 'sm' ? spacing.sm : spacing.md,
          paddingVertical: size === 'sm' ? 2 : 4,
        },
      ]}
    >
      {dot ? (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: t.fg,
            marginRight: 6,
          }}
        />
      ) : null}
      <Text
        numberOfLines={1}
        style={{
          color: t.fg,
          fontSize: size === 'sm' ? fontSize.xs : fontSize.sm,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Domain tone maps — one place that decides what colour a status is, so the
// mapping can't drift between the list screen and the detail screen.
// ---------------------------------------------------------------------------

export const APPLICATION_STATUS_TONE: Record<string, PillTone> = {
  SUBMITTED: 'info',
  SCREENING: 'accent',
  INTERVIEW: 'brand',
  OFFER: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

export const TASK_STATUS_TONE: Record<string, PillTone> = {
  BACKLOG: 'neutral',
  TODO: 'info',
  IN_PROGRESS: 'accent',
  BLOCKED: 'danger',
  REVIEW: 'warn',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export const TASK_PRIORITY_TONE: Record<string, PillTone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warn',
  URGENT: 'danger',
};

export const INTERVIEW_STATUS_TONE: Record<string, PillTone> = {
  SCHEDULED: 'info',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
};

export const MARKETING_STATUS_TONE: Record<string, PillTone> = {
  ACTIVE: 'success',
  PAUSED: 'warn',
  PLACED: 'brand',
  DEACTIVATED: 'neutral',
};

export const INVOICE_STATUS_TONE: Record<string, PillTone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  PAID: 'success',
  OVERDUE: 'danger',
  VOID: 'neutral',
  PARTIAL: 'warn',
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
