import { Redirect } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { SplashGate } from '../src/components/SplashGate';

/**
 * Entry route. Decides where a cold launch lands.
 *
 * Only two outcomes here — everything more specific (temp-password rotation,
 * profile completion, role onboarding) is decided by <RouteGuard> once the app
 * group mounts, so the rules live in exactly one place.
 */
export default function Index() {
  const { session, loading } = useAuth();
  if (loading) return <SplashGate />;
  return <Redirect href={session ? '/(app)/dashboard' : '/login'} />;
}
