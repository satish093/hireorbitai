import type { Request, Response } from 'express';
import { z } from 'zod';
import { httpError } from '../types';
import { registerToken, revokeToken } from '../services/push.service';

const registerSchema = z
  .object({
    token: z.string().min(1).max(512),
    platform: z.enum(['ios', 'android']),
  })
  .strict();

const unregisterSchema = z.object({ token: z.string().min(1).max(512) }).strict();

/** POST /push/register — the app sends its Expo push token after permission grant. */
export async function register(req: Request, res: Response): Promise<void> {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const p = registerSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid token payload');
  await registerToken(req.user.id, p.data.token, p.data.platform);
  res.status(204).end();
}

/** POST /push/unregister — on logout, so a shared device stops receiving. */
export async function unregister(req: Request, res: Response): Promise<void> {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const p = unregisterSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid token payload');
  await revokeToken(p.data.token);
  res.status(204).end();
}
