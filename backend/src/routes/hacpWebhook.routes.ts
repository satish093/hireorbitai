import { Router } from 'express';
import { receiveSync, delistJobs } from '../controllers/hacpWebhook.controller';

export const hacpWebhookRouter = Router();

// Public (machine-to-machine, HMAC-signature-gated in the controller) —
// mounted before requireAuth in routes/index.ts, same reasoning as /files.
hacpWebhookRouter.post('/sync', receiveSync);
hacpWebhookRouter.post('/delist', delistJobs);
