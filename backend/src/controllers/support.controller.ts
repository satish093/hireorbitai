import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, ADMIN_TIER } from '../types';

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

// .strict() — server controls reporter_id / status / timestamps; the body may
// only carry the user-supplied report fields (no mass-assignment).
const createSchema = z
  .object({
    severity: z.enum(SEVERITIES).default('low'),
    summary: z.string().trim().min(3).max(2000),
    steps: z.string().max(8000).optional(),
    page_url: z.string().max(2000).optional(),
  })
  .strict();

/**
 * POST /support/tickets — file a bug report. Any authenticated user. The
 * reporter is always taken from req.user (never the body), and the row is built
 * from an explicit allowlist.
 */
export const createTicket: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const { data, error } = await db
    .from('support_tickets')
    .insert({
      reporter_id: req.user.id,
      severity: parsed.data.severity,
      summary: parsed.data.summary,
      steps: parsed.data.steps ?? null,
      page_url: parsed.data.page_url ?? null,
    })
    .select('id, severity, summary, status, created_at')
    .single();
  if (error) throw httpError(500, error.message ?? 'Failed to create ticket');
  res.status(201).json(data);
};

/**
 * GET /support/tickets — list tickets. Developers + admin-tier see every
 * ticket (the support queue); everyone else sees only the ones they filed.
 */
export const listTickets: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const role = req.user.role;
  const isStaffViewer = role === 'DEVELOPER' || (ADMIN_TIER as readonly string[]).includes(role);

  let query = db
    .from('support_tickets')
    .select('id, reporter_id, severity, summary, steps, page_url, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (!isStaffViewer) query = query.eq('reporter_id', req.user.id);

  const { data, error } = await query;
  if (error) throw httpError(500, 'Database error');
  res.json(data ?? []);
};
