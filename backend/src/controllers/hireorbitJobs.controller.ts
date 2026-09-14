import { RequestHandler } from 'express';
import { httpError } from '../types';
import { listSynced, listAgentOutputsForJob } from '../repositories/hireorbitJobs.repository';

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

/**
 * GET /jobs/hireorbit-synced/:fingerprint/insights
 *
 * Read-only list of pre-computed AI agent outputs (public.hireorbit_agent_outputs)
 * for one synced job — grouped by agent_id. Purely a display of what Antigravity
 * already computed; does not call any AI provider itself and does not touch the
 * app's own native copilot/cover-letter/skill-gap routes.
 */
export const insights: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { fingerprint } = req.params;
  if (!fingerprint) throw httpError(400, 'fingerprint is required');
  const rows = await listAgentOutputsForJob(fingerprint);
  res.json(rows);
};
