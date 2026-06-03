import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/invoices.controller';

// Invoices are a MANAGER_TIER-only back-office tracker. The mount in
// routes/index.ts also applies requireRole(...MANAGER_TIER) + requireFeature
// ('invoices'); the per-route gates here are belt-and-suspenders, mirroring
// vendors.routes.ts.
export const invoicesRouter = Router();

invoicesRouter.get('/', requireRole(...MANAGER_TIER), c.list);
invoicesRouter.get('/:id', requireRole(...MANAGER_TIER), c.get);
invoicesRouter.post('/', requireRole(...MANAGER_TIER), c.create);
invoicesRouter.patch('/:id', requireRole(...MANAGER_TIER), c.update);
invoicesRouter.delete('/:id', requireRole(...MANAGER_TIER), c.remove);
