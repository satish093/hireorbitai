/**
 * Centralized, validated frontend config. Single source of truth — never
 * access `import.meta.env.VITE_*` directly anywhere else in the app.
 *
 * Validation runs at module load (which happens before React mounts in
 * main.tsx). A missing or malformed value throws synchronously so we see a
 * clean error in the console instead of a cryptic "TypeError: undefined" deep
 * inside the axios client.
 */

function readUrl(name: string, value: string | undefined): string {
  if (!value || typeof value !== 'string') {
    throw new Error(
      `Missing required env var ${name}. Set it in frontend/.env and re-run \`npm run build\`. ` +
        `Note that Vite bakes env vars into the bundle at build time — runtime changes have no effect.`,
    );
  }
  try {
    new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL: "${value}"`);
  }
  // Strip trailing slash. Callers always prepend their path with a leading
  // slash (`${apiBaseUrl}/auth/login`), so without normalization a value of
  // `https://api.example.com/` produces `https://api.example.com//auth/login`,
  // which Nginx forwards as a literal `//auth/login` — most apps 404 on that.
  return value.replace(/\/+$/, '');
}

const e = import.meta.env;

/** Validated frontend config. Import this — not `import.meta.env`. */
export const config = {
  apiBaseUrl: readUrl('VITE_API_URL', e.VITE_API_URL),
  isProd: !!e.PROD,
  mode: e.MODE as 'development' | 'production' | string,
} as const;
