import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { Screen } from './Screen';
import { Brand } from './Brand';
import { useTheme } from '../../theme';

/**
 * Shared signed-out layout — the exact shell every auth page uses on the web
 * (`min-h-dvh bg-hover … max-w-… → <Brand size="lg"/> → bg-surface rounded-2xl
 * border shadow-sm card`): login, forgot/reset/change-password,
 * accept-invitation, unauthorized.
 *
 * One component so all of them stay visually identical to the site and to each
 * other. Pass `wide` for the `max-w-md` pages (invitation, unauthorized) and
 * `aboveCard` for a banner that sits between the brand and the card (e.g. the
 * account-locked notice on login).
 */
export function AuthCard({
  children,
  wide,
  aboveCard,
}: {
  children: ReactNode;
  wide?: boolean;
  aboveCard?: ReactNode;
}) {
  const { colors, spacing, radius } = useTheme();
  return (
    <Screen edges={['top', 'bottom']} style={{ backgroundColor: colors.hover }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ width: '100%', maxWidth: wide ? 448 : 384 }}>
            <View style={{ alignItems: 'center', marginBottom: spacing['2xl'] }}>
              <Brand size="lg" />
            </View>

            {aboveCard ? <View style={{ marginBottom: spacing.md }}>{aboveCard}</View> : null}

            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: radius['2xl'],
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
                padding: spacing['2xl'],
                // shadow-sm
                shadowColor: '#000',
                shadowOpacity: 0.06,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 2,
              }}
            >
              {children}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * Card heading — the web's `<h1 class="text-xl font-semibold tracking-tight">`
 * plus an optional muted subtitle. Every auth card leads with one.
 */
export function AuthHeading({
  title,
  subtitle,
  center,
}: {
  title: string;
  subtitle?: string;
  center?: boolean;
}) {
  const { colors, fontSize, spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg, alignItems: center ? 'center' : 'flex-start' }}>
      <Text
        style={{
          fontSize: fontSize.xl,
          fontWeight: '600',
          letterSpacing: -0.3,
          color: colors.ink,
          textAlign: center ? 'center' : 'left',
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            fontSize: fontSize.sm,
            color: colors.muted,
            marginTop: 4,
            textAlign: center ? 'center' : 'left',
            lineHeight: 20,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
