import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { httpError } from '../types';

// AES-256-GCM encryption for secrets that must be readable later (LinkedIn
// OAuth tokens) — unlike everything else in this codebase (passwords,
// refresh tokens, HMAC signatures), which is one-way hashed because it never
// needs to be recovered. Keyed by env.tokenEncryptionKey (base64, 32 bytes),
// validated at boot in config/env.ts.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV, the GCM-recommended size.
const FORMAT_VERSION = 'v1';

function getKey(): Buffer {
  if (!env.tokenEncryptionKey) {
    throw httpError(503, 'Token encryption is not configured on this server');
  }
  return Buffer.from(env.tokenEncryptionKey, 'base64');
}

/** Encrypts `plaintext`, returning a self-contained serialized string. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** Reverses {@link encryptSecret}. Throws if the payload is malformed or the tag doesn't verify. */
export function decryptSecret(serialized: string): string {
  const key = getKey();
  const parts = serialized.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw httpError(500, 'Malformed encrypted secret');
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
