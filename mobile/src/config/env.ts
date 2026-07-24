/**
 * Centralized, validated mobile config. Single source of truth — never read
 * `process.env.EXPO_PUBLIC_*` directly anywhere else in the app.
 *
 * Mirrors frontend/src/config/env.ts deliberately, including the trailing-slash
 * normalization: callers always prepend their path with a leading slash
 * (`${apiBaseUrl}/auth/login`), so an unnormalized `https://api.example.com/`
 * would produce `//auth/login`, which nginx forwards literally and most apps
 * 404 on.
 *
 * Validation runs at module load, which happens before the router mounts.
 * A missing or malformed value throws synchronously so we get a clean red
 * screen naming the variable instead of a cryptic axios failure later.
 */

function readUrl(name: string, value: string | undefined): string {
  if (!value || typeof value !== 'string') {
    throw new Error(
      `Missing required env var ${name}. Set it in mobile/.env and restart the ` +
        `bundler with a cleared cache (\`npx expo start -c\`). Expo inlines ` +
        `EXPO_PUBLIC_* vars at build time — editing .env without a restart has ` +
        `no effect.`,
    );
  }
  try {
    // eslint-disable-next-line no-new
    new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL: "${value}"`);
  }
  return value.replace(/\/+$/, '');
}

/** Validated mobile config. Import this — not process.env. */
export const config = {
  apiBaseUrl: readUrl('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL),
  isDevTools: process.env.EXPO_PUBLIC_DEV_TOOLS === 'true',
  /** __DEV__ is injected by the React Native bundler. */
  isDev: typeof __DEV__ !== 'undefined' && __DEV__,
} as const;
