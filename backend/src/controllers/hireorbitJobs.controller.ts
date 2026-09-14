import { RequestHandler } from 'express';
import { httpError } from '../types';
import { listSynced } from '../repositories/hireorbitJobs.repository';

/**
 * GET /jobs/hireorbit-synced
 *
 * Read-only list of jobs synced in from the external HACP/Oracle agent
 * (public.hireorbit_jobs). Deliberately separate from the main jobs board —
 * never merged into public.jobs, never written to here. Same auth gate as
 * the rest of jobsRouter (mounted at requireRole(...OPERATOR_TIER)).
 */
export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = await listSynced({ limit });
  res.json(rows);
};
