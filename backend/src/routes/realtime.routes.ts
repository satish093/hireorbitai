import { Router } from 'express';
import * as c from '../controllers/realtime.controller';

export const realtimeRouter = Router();

// Exchange a bearer JWT for a short-lived SSE token. This avoids passing the
// full JWT in the EventSource URL query string, which would appear in CDN logs.
realtimeRouter.post('/token', c.issueToken);

// Long-lived SSE stream. Token validated in the controller (short-lived SSE
// token preferred; falls back to req.user for backwards compatibility).
// Rate limiting is intentionally NOT applied here — each browser tab opens
// exactly one stream and the global limiter would close it via 429.
realtimeRouter.get('/stream', c.stream);
