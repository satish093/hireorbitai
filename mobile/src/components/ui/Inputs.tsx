import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { useTheme } from '../../theme';
import { Sheet } from './Sheet';

/**
 * Form controls.
 *
 * ONE non-negotiable rule from .claude/rules/frontend-responsive.md carries
 * over: **never set a font size below 16 on a text input.** On the web that was
 * about iOS Safari auto-zooming sub-16px inputs. In a native app there is no
 * auto-zoom, but the reason underneath is the same — smaller than 16 is simply
 * hard to read while typing on a phone. The default here is 16 and callers
 * cannot lower it.
 *
 * Heights match Button (48px from the theme), so a stacked form is aligned —
 * the property the web's `h-9` convention protects.
 */

interface FieldProps {
  label?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}

function Field({ label, error, hint, required, children }: FieldProps) {
  const { colors, fontSize, spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {label ? (
        <Text
          style={{
            fontSize: fontSize.sm,
            fontWeight: '600',
            color: colors.ink2,
            marginBottom: spacing.xs,
          }}
        >
          {label}
          {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
        </Text>
      ) : null}
      {children}
      {error ? (
        <Text style={{ fontSize: fontSize.sm, color: colors.danger, marginTop: 4 }}>{error}</Text>
      ) : hint ? (
        <Text style={{ fontSize: fontSize.xs, color: colors.muted, marginTop: 4 }}>{hint}</Text>
      ) : null}
    </View>
  );
}

interface FormInputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
}

export function FormInput({
  label,
  error,
  hint,
  required,
  multiline,
  ...inputProps
}: FormInputProps) {
  const { colors, radius, fontSize, spacing, controlHeight } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <Field label={label} error={error} hint={hint} required={required}>
      <TextInput
        placeholderTextColor={colors.faint}
        {...inputProps}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          inputProps.onBlur?.(e);
        }}
        style={{
          minHeight: multiline ? 110 : controlHeight,
          height: multiline ? undefined : controlHeight,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: error ? colors.danger : focused ? colors.accent : colors.border,
          backgroundColor: colors.surface,
          color: colors.ink,
          paddingHorizontal: spacing.md,
          paddingTop: multiline ? spacing.md : 0,
          paddingBottom: multiline ? spacing.md : 0,
          // Never below 16 — see the file header.
          fontSize: Math.max(16, fontSize.md),
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </Field>
  );
}

/** Password field with a show/hide toggle. */
export function PasswordInput(props: FormInputProps) {
  const { colors, fontSize, spacing } = useTheme();
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ position: 'relative' }}>
      <FormInput
        {...props}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute',
          right: spacing.md,
          // Sits on the input row, below the label.
          top: props.label ? 34 : 0,
          height: 48,
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' }}>
          {visible ? 'Hide' : 'Show'}
        </Text>
      </Pressable>
    </View>
  );
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
}

/**
 * Select — opens a bottom sheet rather than a dropdown.
 *
 * A web-style anchored dropdown is the wrong pattern on a phone: it overflows
 * small screens and lands under the thumb. A sheet is reachable and cancellable.
 */
export function SelectInput<T extends string = string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  error,
  hint,
  required,
  disabled,
}: {
  label?: string;
  value: T | null | undefined;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { colors, radius, fontSize, spacing, controlHeight } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <Field label={label} error={error} hint={hint} required={required}>
        <Pressable
          onPress={() => !disabled && setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={label ? `${label}. ${selected?.label ?? placeholder}` : placeholder}
          style={{
            height: controlHeight,
            borderRadius: radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: error ? colors.danger : colors.border,
            backgroundColor: disabled ? colors.hover : colors.surface,
            paddingHorizontal: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              fontSize: Math.max(16, fontSize.md),
              color: selected ? colors.ink : colors.faint,
              flex: 1,
            }}
          >
            {selected?.label ?? placeholder}
          </Text>
          <Text style={{ color: colors.muted, fontSize: fontSize.sm, marginLeft: spacing.sm }}>
            ▾
          </Text>
        </Pressable>
      </Field>

      <Sheet open={open} onClose={() => setOpen(false)} title={label ?? 'Select'}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={({ pressed }) => ({
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.lg,
                borderRadius: radius.lg,
                backgroundColor: active
                  ? colors.accentSoft
                  : pressed
                    ? colors.hover
                    : 'transparent',
                minHeight: 48,
                justifyContent: 'center',
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text
                  style={{
                    flex: 1,
                    fontSize: fontSize.md,
                    color: active ? colors.accent : colors.ink,
                    fontWeight: active ? '600' : '400',
                  }}
                >
                  {opt.label}
                </Text>
                {active ? <Text style={{ color: colors.accent }}>✓</Text> : null}
              </View>
              {opt.description ? (
                <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                  {opt.description}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </Sheet>
    </>
  );
}

/** Search box for list screens. */
export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Search…',
  onSubmit,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
}) {
  const { colors, radius, fontSize, spacing, controlHeight } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: controlHeight,
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.md,
      }}
    >
      <Text style={{ color: colors.faint, marginRight: spacing.sm }}>⌕</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={{ flex: 1, color: colors.ink, fontSize: Math.max(16, fontSize.md) }}
      />
    </View>
  );
}
