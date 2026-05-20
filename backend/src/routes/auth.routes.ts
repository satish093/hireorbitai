import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import * as auth from '../controllers/auth.controller';

export const authRouter = Router();

// Per-route limiters, stricter than the global one in server.ts. Mounted on
// the routes that are the most enumerate-able / brute-forceable.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 login attempts / IP / 15min
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5, // 5 forgot-password requests / IP / hour
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// --- Public ------------------------------------------------------------------
authRouter.post('/login', loginLimiter, auth.login);
authRouter.post('/refresh', auth.refresh);
authRouter.post('/forgot-password', forgotLimiter, auth.forgotPassword);
authRouter.post('/reset-password', resetLimiter, auth.resetPassword);

// --- Authenticated -----------------------------------------------------------
// /me and /sync are usable even when must_change_password is true, so the
// frontend can read the flag and route to /change-password.
authRouter.get('/me', requireAuth, auth.me);
authRouter.post('/sync', requireAuth, auth.syncProfile);
// /change-password is the ONE protected route a "must_change" user can hit.
authRouter.post('/change-password', requireAuth, auth.changePassword);
authRouter.post('/complete-tour', requireAuth, auth.completeTour);
authRouter.post('/logout', requireAuth, auth.logout);
