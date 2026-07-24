import { Image, Text, View } from 'react-native';
import { useTheme } from '../../theme';

/**
 * User avatar with an initials fallback.
 *
 * Most users have no avatar_url, so the initials path is the common case, not
 * the exception. Colour is derived deterministically from the user id so the
 * same person is always the same colour across every screen.
 */

const SWATCHES = [
  '#5b3df5',
  '#2563eb',
  '#0891b2',
  '#059669',
  '#b7791f',
  '#c2410c',
  '#be123c',
  '#7c3aed',
] as const;

function swatchFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return SWATCHES[hash % SWATCHES.length] as string;
}

function initialsFrom(name?: string | null, email?: string | null): string {
  const source = (name ?? '').trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase() || '?';
  }
  const e = (email ?? '').trim();
  return e ? (e[0] as string).toUpperCase() : '?';
}

export function Avatar({
  name,
  email,
  uri,
  id,
  size = 40,
  /** Small presence dot in the corner. */
  online,
}: {
  name?: string | null;
  email?: string | null;
  uri?: string | null;
  id?: string;
  size?: number;
  online?: boolean;
}) {
  const { colors } = useTheme();
  const bg = swatchFor(id ?? email ?? name ?? '?');
  const initials = initialsFrom(name, email);

  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: '#ffffff',
              fontSize: Math.max(10, size * 0.38),
              fontWeight: '700',
            }}
          >
            {initials}
          </Text>
        </View>
      )}

      {online !== undefined ? (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: Math.max(10, size * 0.28),
            height: Math.max(10, size * 0.28),
            borderRadius: size,
            backgroundColor: online ? colors.success : colors.faint,
            borderWidth: 2,
            borderColor: colors.surface,
          }}
        />
      ) : null}
    </View>
  );
}
