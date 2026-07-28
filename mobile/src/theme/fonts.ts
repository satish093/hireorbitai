import { Text, TextInput, StyleSheet } from 'react-native';
import { cloneElement } from 'react';

/**
 * Make the ENTIRE app render in Inter — the exact typeface the website uses
 * (frontend loads Inter 400–800 from Google Fonts). React Native has no global
 * font and does NOT map `fontWeight` to a custom font's weight files on Android,
 * so we do both here in one place:
 *
 *  1. map every `fontWeight` the app uses to the matching Inter variant, and
 *  2. patch the base Text / TextInput render so that mapping applies to EVERY
 *     `<Text>` in the app without touching ~50 screens.
 *
 * This is what makes the app read as "the same design" as the website on every
 * page — same letterforms, same weights — rather than the device system font.
 *
 * Explicit `fontFamily` on a style is respected (e.g. the audit log's monospace),
 * so this never clobbers a deliberate choice.
 */

const FAMILY_BY_WEIGHT: Record<string, string> = {
  '100': 'Inter_400Regular',
  '200': 'Inter_400Regular',
  '300': 'Inter_400Regular',
  '400': 'Inter_400Regular',
  normal: 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  bold: 'Inter_700Bold',
  '800': 'Inter_800ExtraBold',
  '900': 'Inter_800ExtraBold',
};

export function familyForWeight(weight?: string | number): string {
  return FAMILY_BY_WEIGHT[String(weight ?? '400')] ?? 'Inter_400Regular';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function patchComponent(Component: any): void {
  if (!Component || Component.__interPatched || typeof Component.render !== 'function') return;
  const originalRender = Component.render;
  Component.__interPatched = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component.render = function patchedRender(...args: any[]) {
    const element = originalRender.apply(this, args);
    if (!element?.props) return element;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flat = (StyleSheet.flatten(element.props.style) || {}) as any;
    // Respect an explicitly-set family (monospace, etc.).
    if (flat.fontFamily) return element;
    const fontFamily = familyForWeight(flat.fontWeight);
    return cloneElement(element, {
      style: [{ fontFamily }, element.props.style],
    });
  };
}

let applied = false;

/** Call once, after the Inter fonts have loaded. Idempotent. */
export function applyInterFont(): void {
  if (applied) return;
  applied = true;
  patchComponent(Text);
  patchComponent(TextInput);
}
