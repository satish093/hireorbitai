import { Router } from 'express';
import * as callsCtl from '../controllers/calls.controller';

export const callsRouter = Router();

callsRouter.post('/offer', callsCtl.offer);
callsRouter.post('/answer', callsCtl.answer);
callsRouter.post('/ice-candidate', callsCtl.iceCandidate);
callsRouter.post('/end', callsCtl.end);
callsRouter.post('/reject', callsCtl.reject);
// Short-lived ICE/TURN credentials minted server-side so the Cloudflare
// bearer token never reaches the browser. Frontend fetches this once per
// call (before opening the offer / accepting an incoming call) and feeds
// the result into RTCPeerConnection.
callsRouter.get('/turn-credentials', callsCtl.turnCredentials);
