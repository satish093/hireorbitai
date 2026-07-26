import { Redirect } from 'expo-router';

/**
 * The "More" destination is now a slide-up SHEET owned by the bottom bar
 * (src/components/nav/MoreSheet.tsx), matching the website's MobileMoreSheet —
 * not a full screen. This route is kept only so a stray navigation to `/more`
 * lands somewhere sane instead of 404ing.
 */
export default function MoreRedirect() {
  return <Redirect href="/(app)/dashboard" />;
}
