import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

/**
 * Bottom sheet — the mobile replacement for the web's centered <Modal>.
 *
 * The web rule (.claude/rules/frontend-responsive.md) is "modals are viewport-
 * centered and portaled to document.body", and the reason is specific to CSS: a
 * transformed ancestor re-anchors `position: fixed`. None of that exists in
 * React Native — RN's <Modal> already renders in its own native window above
 * everything, so the portal problem simply doesn't occur.
 *
 * What DOES carry over is the intent behind that rule:
 *   • full-screen scrim so the dialog owns the screen
 *   • the body scrolls INTERNALLY, never pushing the sheet off-screen
 *   • safe-area padding at the bottom so the last row clears the home indicator
 *
 * A sheet anchored to the bottom edge is used instead of a centred dialog
 * because it lands under the thumb. The web's Drawer had the same rationale.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Cap the sheet height as a fraction of the screen. Default 0.85. */
  maxHeightRatio?: number;
  /** Pinned footer (action buttons) that never scrolls away. */
  footer?: React.ReactNode;
}

export function Sheet({ open, onClose, title, children, maxHeightRatio = 0.85, footer }: Props) {
  const { colors, radius, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Scrim — tapping outside dismisses, matching the web backdrop. */}
      <Pressable
        accessibilityLabel="Close"
        onPress={onClose}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: height * maxHeightRatio,
          backgroundColor: colors.bgElev,
          borderTopLeftRadius: radius['2xl'],
          borderTopRightRadius: radius['2xl'],
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          paddingBottom: insets.bottom || spacing.lg,
        }}
      >
        {/* Grab handle — the standard affordance for "drag or tap away". */}
        <View style={{ alignItems: 'center', paddingTop: spacing.sm }}>
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.borderStrong,
            }}
          />
        </View>

        {title ? (
          <View
            style={{
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.md,
              paddingBottom: spacing.sm,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: colors.ink, flex: 1 }}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={{ color: colors.muted, fontSize: fontSize.lg }}>✕</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Internal scroll — tall content must never push the sheet off-screen. */}
        <ScrollView
          style={{ flexGrow: 0 }}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>

        {footer ? (
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.md,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
            }}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** Destructive/confirm dialog. Replaces the web's ConfirmDialog. */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
}) {
  const { colors, fontSize, spacing } = useTheme();
  // Imported lazily at module scope would create a cycle (Button → Sheet for
  // SelectInput). Requiring the component here keeps the graph acyclic.
  const { Button } = require('./Button') as typeof import('./Button');

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {message ? (
        <Text
          style={{
            fontSize: fontSize.base,
            color: colors.muted,
            lineHeight: 22,
            marginBottom: spacing.xl,
          }}
        >
          {message}
        </Text>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        <Button
          label={confirmLabel}
          onPress={onConfirm}
          loading={pending}
          variant={destructive ? 'danger' : 'primary'}
        />
        <Button label="Cancel" onPress={onClose} variant="secondary" disabled={pending} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject },
});
