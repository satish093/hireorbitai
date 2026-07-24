import { Router } from 'express';
import * as c from '../controllers/support.controller';

// Mounted under /support behind the global requireAuth. No role/feature gate:
// any authenticated user may file a bug report. The list handler scopes rows
// per-role (own tickets, or all for developers + admin-tier).
export const supportRouter = Router();

supportRouter.post('/tickets', c.createTicket);
supportRouter.get('/tickets', c.listTickets);
