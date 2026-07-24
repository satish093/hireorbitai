import { RequestHandler } from 'express';
import { fetchGlassdoorInterview } from '../services/glassdoor.service';
import { httpError } from '../types';

/**
 * GET /api/glassdoor/interview/:id
 * Proxy for Glassdoor Real-Time's interview-details endpoint. Useful from the
 * interview-prep view: "Show me what a real Glassdoor interview at this
 * company looked like."
 */
export const interview: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const id = req.params.id;
  if (!id) throw httpError(400, 'interview id required');
  try {
    const data = await fetchGlassdoorInterview(id);
    res.json(data);
  } catch (e: any) {
    throw httpError(502, e?.message ?? 'Glassdoor request failed');
  }
};
