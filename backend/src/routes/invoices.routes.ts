import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/invoices.controller';

// Invoices: MANAGER_TIER by default, OR any user granted the 'invoices'
// page-access capability by an admin. The mount in routes/index.ts applies the
// same gate + requireFeature('invoices'); these per-route gates are
// belt-and-suspenders, mirroring vendors.routes.ts.
export const invoicesRouter = Router();
const gate = requireRoleOrCapability(MANAGER_TIER, 'invoices');

invoicesRouter.get('/', gate, c.list);
invoicesRouter.get('/:id', gate, c.get);
// Document generation (download) + email-send. Distinct suffixes, so order vs
// the bare /:id routes doesn't matter; grouped here for clarity.
invoicesRouter.get('/:id/document', gate, c.document);
invoicesRouter.post('/:id/send', gate, c.send);
invoicesRouter.post('/', gate, c.create);
invoicesRouter.patch('/:id', gate, c.update);
invoicesRouter.delete('/:id', gate, c.remove);
