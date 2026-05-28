import { Router } from 'express';
import * as callsCtl from '../controllers/calls.controller';

export const callsRouter = Router();

callsRouter.post('/offer', callsCtl.offer);
callsRouter.post('/answer', callsCtl.answer);
callsRouter.post('/ice-candidate', callsCtl.iceCandidate);
callsRouter.post('/end', callsCtl.end);
callsRouter.post('/reject', callsCtl.reject);
