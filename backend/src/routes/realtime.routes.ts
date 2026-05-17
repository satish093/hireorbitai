import { Router } from 'express';
import * as c from '../controllers/realtime.controller';

export const realtimeRouter = Router();

// Long-lived SSE stream. Auth from the global requireAuth middleware in
// routes/index.ts. Rate limiting is intentionally NOT applied here —
// each browser tab opens exactly one stream and the global limiter
// would close it via 429 once a user opens N tabs.
realtimeRouter.get('/stream', c.stream);
