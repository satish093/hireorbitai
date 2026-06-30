import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/invoices.controller';

// Invoices are role-only: MANAGER_TIER. Capability grants never widen access.
// The mount in routes/index.ts applies the same gate + feature flag; these
// per-route gates are belt-and-suspenders.
export const invoicesRouter = Router();
const gate = requireRole(...MANAGER_TIER);
const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
  message: { error: 'Too many invoice emails. Try again later.' },
});

invoicesRouter.get('/', gate, c.list);
invoicesRouter.get('/companies', gate, c.companies);
invoicesRouter.get('/:id', gate, c.get);
// Document generation (download) + email-send. Distinct suffixes, so order vs
// the bare /:id routes doesn't matter; grouped here for clarity.
invoicesRouter.get('/:id/document', gate, c.document);
invoicesRouter.post('/:id/send', gate, emailLimiter, c.send);
// Overdue / payment reminder to the client + company managers. Rate-limited
// like the invoice send since it dispatches email.
invoicesRouter.post('/:id/remind', gate, emailLimiter, c.remind);
invoicesRouter.post('/', gate, c.create);
invoicesRouter.patch('/:id', gate, c.update);
invoicesRouter.post('/:id/transition', gate, c.transition);
invoicesRouter.post('/:id/archive', gate, c.archive);
invoicesRouter.post('/:id/restore', gate, c.restore);
// Partial-payment ledger.
invoicesRouter.post('/:id/payments', gate, c.recordPayment);
invoicesRouter.delete('/:id/payments/:paymentId', gate, c.voidPayment);
invoicesRouter.delete('/:id', gate, c.remove);
