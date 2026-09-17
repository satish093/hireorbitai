import { randomBytes } from 'node:crypto';
import { RequestHandler } from 'express';
import { env } from '../config/env';
import { httpError } from '../types';
import { audit } from '../services/audit.service';
import * as linkedin from '../services/linkedin.service';

// Short-lived, signed, httpOnly cookie carrying the OAuth CSRF `state` +
// the initiating user's id. Scoped to the callback path only. This is the
// FIRST cookie this codebase sets — everywhere else, auth travels in JSON
// bodies/Authorization headers (see auth.local.ts) because there's no
// browser-redirect leg to babysit. LinkedIn's OAuth flow is exactly that
// kind of redirect leg, so a cookie is unavoidable here.
const STATE_COOKIE = 'li_oauth_state';
const STATE_COOKIE_PATH = '/api/linkedin/callback';
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * GET /linkedin/authorize — requireAuth (Bearer token). Returns JSON rather
 * than a 302 because the caller is the frontend's authenticated axios
 * instance, not a bare `<a href>` — the frontend does
 * `window.location.href = url` itself to hand the browser off to LinkedIn.
 */
export const authorize: RequestHandler = (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const state = randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE, `${state}:${req.user.id}`, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: STATE_TTL_MS,
    path: STATE_COOKIE_PATH,
  });
  res.json({ url: linkedin.buildAuthorizationUrl(state) });
};

/**
 * GET /linkedin/callback — LinkedIn redirects the user's browser here with
 * NO Authorization header (it's a top-level navigation, not an XHR), so this
 * route must be mounted PUBLIC (before global requireAuth) and authenticate
 * the caller from the signed state cookie instead of req.user. Always ends
 * in a redirect back to the user's own profile page, never a JSON error, so
 * a bare page-load never shows the user a raw API error screen.
 */
export const callback: RequestHandler = async (req, res) => {
  const profileUrl = (userId: string) => `${env.frontendUrl}/users/${userId}`;
  const cookieValue = (req.signedCookies as Record<string, string | undefined> | undefined)?.[
    STATE_COOKIE
  ];
  res.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });

  if (!cookieValue) {
    res.redirect(`${env.frontendUrl}/login?linkedin=error`);
    return;
  }
  const [expectedState, userId] = cookieValue.split(':');
  if (!expectedState || !userId) {
    res.redirect(`${env.frontendUrl}/login?linkedin=error`);
    return;
  }

  // The user denied the LinkedIn consent screen — not an error, just a no-op.
  if (req.query.error) {
    res.redirect(`${profileUrl(userId)}?linkedin=cancelled`);
    return;
  }

  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  if (!code || state !== expectedState) {
    res.redirect(`${profileUrl(userId)}?linkedin=error`);
    return;
  }

  try {
    await linkedin.handleCallback(userId, code);
    audit({ action: 'linkedin_connected', user_id: userId, req });
    res.redirect(`${profileUrl(userId)}?linkedin=connected`);
  } catch (err) {
    req.log.error({ err }, '[linkedin.callback] connect failed');
    res.redirect(`${profileUrl(userId)}?linkedin=error`);
  }
};

/** GET /linkedin/status — requireAuth. DB-only read, no outbound LinkedIn call. */
export const status: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  res.json(await linkedin.getConnectionStatus(req.user.id));
};

/** POST /linkedin/disconnect — requireAuth. "Forget our copy of the tokens";
 *  LinkedIn has no revoke endpoint at this product tier. */
export const disconnect: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await linkedin.disconnect(req.user.id);
  audit({ action: 'linkedin_disconnected', user_id: req.user.id, email: req.user.email, req });
  res.json({ ok: true });
};
