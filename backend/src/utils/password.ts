import crypto from 'node:crypto';

/**
 * Crypto-secure temporary password generator.
 *
 *   - 14 characters minimum (per spec)
 *   - At least one uppercase, one lowercase, one digit, one special
 *   - All bytes drawn from crypto.randomInt — no Math.random
 *
 * The function NEVER returns the password through any logging API. Callers
 * are responsible for not storing or echoing the value beyond the one-time
 * email send.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';    // omit O/I for legibility
const LOWER = 'abcdefghijkmnopqrstuvwxyz';   // omit l
const DIGIT = '23456789';                    // omit 0/1
const SPECIAL = '!@#$%^&*?-_=+';
const ALPHABET = UPPER + LOWER + DIGIT + SPECIAL;

function pick(charset: string): string {
  return charset[crypto.randomInt(charset.length)]!;
}

export function generateTempPassword(length = 16): string {
  if (length < 14) length = 14;
  // Guarantee one of each required class.
  const required = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
  // Fill the rest from the union alphabet.
  for (let i = required.length; i < length; i++) required.push(pick(ALPHABET));
  // Fisher–Yates shuffle so the required chars aren't always at the start.
  for (let i = required.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [required[i], required[j]] = [required[j]!, required[i]!];
  }
  return required.join('');
}

// --- Strength validation -----------------------------------------------------
export interface PasswordStrengthResult {
  ok: boolean;
  problems: string[];
}

/**
 * Server-side strength check for user-chosen passwords (change-password +
 * reset-password). Rules:
 *
 *   - >= 12 chars
 *   - upper + lower + digit + special
 *   - not all-the-same character
 *   - not the user's email local-part
 *   - not in a tiny list of egregiously common passwords (sample only — for
 *     real prod, plug in have-i-been-pwned k-anonymity or zxcvbn)
 */
const COMMON_BANLIST = new Set([
  'password', 'password1', 'password123',
  'qwerty', 'qwerty123', 'letmein', 'admin', 'admin123',
  'welcome', 'welcome1', 'iloveyou', 'changeme',
  'abc12345', '12345678', '123456789', 'p@ssword', 'p@ssw0rd',
]);

export function validatePasswordStrength(
  password: string,
  context: { email?: string } = {},
): PasswordStrengthResult {
  const problems: string[] = [];
  if (password.length < 12) problems.push('Must be at least 12 characters.');
  if (!/[A-Z]/.test(password)) problems.push('Must include an uppercase letter.');
  if (!/[a-z]/.test(password)) problems.push('Must include a lowercase letter.');
  if (!/[0-9]/.test(password)) problems.push('Must include a number.');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('Must include a special character.');
  if (/^(.)\1+$/.test(password)) problems.push('Cannot be a single repeated character.');
  if (context.email) {
    const local = context.email.split('@')[0]!.toLowerCase();
    if (local.length >= 4 && password.toLowerCase().includes(local)) {
      problems.push('Cannot contain your email username.');
    }
  }
  if (COMMON_BANLIST.has(password.toLowerCase())) {
    problems.push('This password is too common.');
  }
  return { ok: problems.length === 0, problems };
}

// --- Token hashing -----------------------------------------------------------
/**
 * SHA-256 hash of a high-entropy random token. We store the hash, never the
 * raw token; the raw token is only ever sent in the email link. A simple
 * SHA-256 is appropriate here (not bcrypt/argon2) because the input is
 * 32 random bytes — there's no pre-image space worth brute-forcing.
 */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Generates a URL-safe random token. 32 bytes ≈ 256 bits of entropy —
 * collision-resistant well past the lifetime of the app.
 */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Constant-time string compare. Use this on token equality checks so the
 * verification time doesn't leak how many bytes matched.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
