import { Router } from 'express';
import * as c from '../controllers/realtime.controller';

export const realtimeRouter = Router();

// Exchange a bearer JWT for a short-lived SSE token. This avoids passing the
// full JWT in the EventSource URL query string, which would appear in CDN logs.
realtimeRouter.post('/token', c.issueToken);

// NOTE: GET /stream is intentionally NOT here — it is mounted directly on the
// root router BEFORE requireAuth in routes/index.ts so the SSE token (query
// param) can be validated without requiring an Authorization header.
