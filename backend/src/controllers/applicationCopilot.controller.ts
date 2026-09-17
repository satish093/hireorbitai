import { RequestHandler } from 'express';
import { z } from 'zod';
import { httpError } from '../types';
import { APPLICATION_QUESTION_CATALOG } from '@hireorbitai/shared';
import * as copilot from '../services/applicationCopilot.service';

const startSchema = z.object({ job_id: z.string().uuid() }).strict();

/** POST /application-copilot/start */
export const start: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = startSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  res.json(await copilot.startOrResume(req.user, parsed.data.job_id));
};

/** GET /application-copilot/:id */
export const getState: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  res.json(await copilot.getState(req.user, req.params.id));
};

const answersSchema = z
  .object({
    answers: z
      .array(z.object({ key: z.string().min(1), value: z.string().min(1) }).strict())
      .min(1)
      .max(APPLICATION_QUESTION_CATALOG.length),
  })
  .strict();

/** PATCH /application-copilot/:id/answers */
export const updateAnswers: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = answersSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  res.json(await copilot.updateAnswers(req.user, req.params.id, parsed.data.answers));
};

const coverLetterSchema = z.object({ text: z.string().min(1).max(8000) }).strict();

/** PATCH /application-copilot/:id/cover-letter */
export const updateCoverLetter: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = coverLetterSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  res.json(await copilot.updateCoverLetter(req.user, req.params.id, parsed.data.text));
};

/** POST /application-copilot/:id/confirm — the consultant clicked Submit on
 *  LinkedIn's own site and is confirming it happened. No body. */
export const confirm: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  res.json(await copilot.confirmSubmission(req.user, req.params.id));
};

const logExternalSchema = z.object({ job_id: z.string().uuid() }).strict();

/** POST /application-copilot/log-external — quick "I already applied on
 *  LinkedIn directly" log, skipping the wizard. */
export const logExternal: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = logExternalSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  res.status(201).json(await copilot.logExternalApplication(req.user, parsed.data.job_id));
};
