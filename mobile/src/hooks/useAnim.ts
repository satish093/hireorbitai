import { useCallback, useEffect, useRef } from 'react';
import { Animated, type ViewStyle } from 'react-native';

/**
 * Motion helpers, deliberately built on React Native's own `Animated` with
 * `useNativeDriver: true`. Native-driven transform/opacity animations run on the
 * UI thread — they keep 60fps even while JS is busy fetching or rendering a
 * list, which is exactly the "animate everything without lag" requirement.
 *
 * We stick to `transform` (scale/translate) and `opacity` — the only props the
 * native driver accepts — so nothing here ever forces a layout pass.
 */

/**
 * Press feedback: a spring scale-down while held, spring back on release.
 * Spread `handlers` onto a Pressable and wrap the visual in Animated.View with
 * `style`. One-shot, GPU-driven, no per-frame JS.
 */
export function usePressScale(to = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  }, [scale, to]);

  const onPressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 24,
      bounciness: 8,
    }).start();
  }, [scale]);

  const style: Animated.WithAnimatedObject<ViewStyle> = { transform: [{ scale }] };
  return { handlers: { onPressIn, onPressOut }, style };
}

/**
 * Mount entrance: fade + a small upward slide, played once when the component
 * mounts. Applied at the screen-container level so every screen enters the same
 * way with zero per-screen code.
 */
export function useEntrance({ distance = 10, duration = 260, delay = 0 } = {}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(t, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [t, duration, delay]);

  const style: Animated.WithAnimatedObject<ViewStyle> = {
    opacity: t,
    transform: [
      {
        translateY: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
      },
    ],
  };
  return style;
}
