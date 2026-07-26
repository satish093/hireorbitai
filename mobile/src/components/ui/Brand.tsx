import { Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../theme';

/**
 * HireOrbit AI brand mark — a planet ringed by an orbit + an AI spark.
 *
 * A faithful react-native-svg port of frontend/src/components/Brand.tsx
 * (BrandMark). Same viewBox, same gradient stops (#1e3a8a → #3b82f6 → #7c3aed),
 * same geometry — so the login/splash mark is pixel-identical to the website.
 *
 * Uses react-native-svg, which is already a native dependency, so adding this
 * does NOT require a new native build.
 */
export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="brandMarkGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#1e3a8a" />
          <Stop offset="55%" stopColor="#3b82f6" />
          <Stop offset="100%" stopColor="#7c3aed" />
        </LinearGradient>
      </Defs>
      <Rect width="64" height="64" rx="14" fill="url(#brandMarkGrad)" />
      {/* Orbit ring — slight diagonal so the planet looks like it's moving */}
      <Ellipse
        cx="32"
        cy="34"
        rx="22"
        ry="10"
        transform="rotate(-22 32 34)"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        opacity={0.85}
      />
      {/* Planet body */}
      <Circle cx="32" cy="34" r="9" fill="#ffffff" />
      <Circle cx="32" cy="34" r="9" fill="url(#brandMarkGrad)" opacity={0.35} />
      {/* AI spark */}
      <Path
        d="M48 16 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2z"
        fill="#ffffff"
        opacity={0.95}
      />
      <Circle cx="53" cy="11" r="1.1" fill="#ffffff" opacity={0.95} />
    </Svg>
  );
}

/**
 * Mark + wordmark. Matches the web `<Brand>`: "Hire" in ink, "Orbit" in the
 * blue→violet brand colour, and a small gradient "AI" badge.
 *
 * The web renders "Orbit" and the badge with a CSS gradient; RN can't gradient
 * plain text, so "Orbit" uses the brand accent (the perceptual midpoint of the
 * blue→violet ramp) and the badge is a small filled pill — visually the same at
 * wordmark scale.
 */
export function Brand({ size = 'lg' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { colors, radius } = useTheme();
  const dim = size === 'sm' ? 32 : size === 'lg' ? 44 : 36;
  const titleSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 15;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <BrandMark size={dim} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text
          style={{ fontSize: titleSize, fontWeight: '700', letterSpacing: -0.3, color: colors.ink }}
        >
          Hire
        </Text>
        <Text
          style={{
            fontSize: titleSize,
            fontWeight: '700',
            letterSpacing: -0.3,
            color: colors.brandOnSoft,
          }}
        >
          Orbit
        </Text>
        <View
          style={{
            marginLeft: 5,
            backgroundColor: colors.brandOnSoft,
            borderRadius: radius.sm,
            paddingHorizontal: 4,
            paddingVertical: 1,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#ffffff' }}>AI</Text>
        </View>
      </View>
    </View>
  );
}
