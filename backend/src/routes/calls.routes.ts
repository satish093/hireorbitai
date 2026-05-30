import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { OWNER_TIER } from '../types';
import * as callsCtl from '../controllers/calls.controller';

export const callsRouter = Router();

callsRouter.post('/offer', callsCtl.offer);
callsRouter.post('/answer', callsCtl.answer);
callsRouter.post('/ice-candidate', callsCtl.iceCandidate);
callsRouter.post('/end', callsCtl.end);
callsRouter.post('/reject', callsCtl.reject);
// Read-only call log for the messaging context panel + mobile Calls tab.
callsRouter.get('/history', callsCtl.history);
// Short-lived ICE/TURN credentials minted server-side so the Cloudflare
// bearer token never reaches the browser. Frontend fetches this once per
// call (before opening the offer / accepting an incoming call) and feeds
// the result into RTCPeerConnection.
callsRouter.get('/turn-credentials', callsCtl.turnCredentials);

// Cap-budget dashboard endpoint. Lives on its own router because the rest
// of /calls/* sits behind MESSAGING_ROLES + requireFeature('messages') in
// routes/index.ts — that gate is wrong here (CONSULTANTS shouldn't see
// the org-wide budget, and turning the messaging feature off shouldn't
// hide spend visibility from the people who own the bill). Mounted at
// /calls-usage in routes/index.ts with its own requireRoleOrCapability
// gate that mirrors /ai-usage's pattern.
export const callsUsageRouter = Router();
callsUsageRouter.use(requireRoleOrCapability(OWNER_TIER, 'calls_usage'));
callsUsageRouter.get('/', callsCtl.usage);
