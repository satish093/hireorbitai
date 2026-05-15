import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { atsScore } from '../services/ai.service';
import { httpError } from '../types';

export const list: RequestHandler = async (req, res) => {
  const { consultant_id, recruiter_id, status } = req.query as Record<string, string | undefined>;
  let qb = db
    .from('applications')
    .select('*, job:jobs(*), vendor:vendors(*), consultant:consultants(*)');
  if (consultant_id) qb = qb.eq('consultant_id', consultant_id);
  if (recruiter_id) qb = qb.eq('recruiter_id', recruiter_id);
  if (status) qb = qb.eq('status', status);
  const { data, error } = await qb.order('submitted_at', { ascending: false });
  if (error) throw httpError(500, error.message);
  res.json(data);
};

/**
 * Check for an existing submission (consultant + job + vendor) before creating
 * a new one. Returns 409 with the offending row if found.
 */
export const checkDuplicate: RequestHandler = async (req, res) => {
  const { consultant_id, job_id, vendor_id } = req.query as Record<string, string | undefined>;
  if (!consultant_id || !job_id) throw httpError(400, 'consultant_id and job_id required');
  let qb = db
    .from('applications')
    .select('*')
    .eq('consultant_id', consultant_id)
    .eq('job_id', job_id);
  if (vendor_id) qb = qb.eq('vendor_id', vendor_id);
  const { data, error } = await qb;
  if (error) throw httpError(500, error.message);
  res.json({ duplicate: (data?.length ?? 0) > 0, matches: data });
};

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const body = req.body ?? {};
  if (!body.consultant_id || !body.job_id)
    throw httpError(400, 'consultant_id and job_id required');

  // Duplicate guard.
  let dupQ = db
    .from('applications')
    .select('id')
    .eq('consultant_id', body.consultant_id)
    .eq('job_id', body.job_id);
  if (body.vendor_id) dupQ = dupQ.eq('vendor_id', body.vendor_id);
  const { data: dups } = await dupQ;
  if (dups && dups.length > 0 && !body.force) {
    throw httpError(409, 'Duplicate submission detected', { existing: dups });
  }

  const { force, ...insertBody } = body;
  const { data, error } = await db.from('applications').insert(insertBody).select().single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  const { data, error } = await db
    .from('applications')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    // Most likely cause when ARCHIVED PATCH fails: the migration that adds
    // the enum value hasn't been applied yet. Surface a clear hint instead
    // of a raw Postgres message.
    if (/invalid input value for enum application_status.*ARCHIVED/i.test(error.message)) {
      throw httpError(
        400,
        "ARCHIVED isn't in the application_status enum yet — apply database/applications-archived-status.sql to the database, then retry.",
      );
    }
    throw httpError(500, error.message);
  }
  res.json(data);
};

// ---------------------------------------------------------------------------
// POST /applications/from-job — record that the recruiter (or consultant)
// actually applied. Called from the "Did you apply? Yes" confirmation modal.
//
// Body:
//   {
//     job_id: uuid,
//     consultant_id: uuid,
//     resume_id?: uuid,             // resume that was sent (tailored OR original)
//     tailored_resume_id?: uuid,    // the tailored variant if any
//     method: 'CUSTOMIZED' | 'ORIGINAL',
//     match_score?: number,
//     ats_score?: number,
//     source_url?: string,
//   }
// ---------------------------------------------------------------------------
export const fromJob: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    job_id: z.string().uuid(),
    consultant_id: z.string().uuid(),
    resume_id: z.string().uuid().optional().nullable(),
    tailored_resume_id: z.string().uuid().optional().nullable(),
    method: z.enum(['CUSTOMIZED', 'ORIGINAL']),
    match_score: z.number().optional().nullable(),
    ats_score: z.number().optional().nullable(),
    source_url: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Identify the caller's recruiter row, if any — populates applications.recruiter_id.
  const { data: rec } = await db
    .from('recruiters')
    .select('id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  const insertBody: any = {
    consultant_id: parsed.data.consultant_id,
    job_id: parsed.data.job_id,
    resume_id: parsed.data.resume_id ?? null,
    tailored_resume_id: parsed.data.tailored_resume_id ?? null,
    recruiter_id: rec?.id ?? null,
    applied_method: parsed.data.method,
    match_score: parsed.data.match_score ?? null,
    ats_score: parsed.data.ats_score ?? null,
    source_url: parsed.data.source_url ?? null,
    status: 'SUBMITTED',
    submitted_at: new Date().toISOString(),
    notes: parsed.data.notes ?? null,
  };

  let { data, error } = await db.from('applications').insert(insertBody).select().single();

  // 1) Strip optional columns added by ai-job-search-and-apply.sql if the
  //    migration hasn't been applied yet. Each retry below peels one column.
  const OPTIONAL_COLS = [
    'applied_method',
    'match_score',
    'source_url',
    'tailored_resume_id',
    'ats_score',
  ];
  let stripCount = 0;
  while (error && stripCount < OPTIONAL_COLS.length) {
    const msg = error.message ?? '';
    const isSchemaErr = /schema cache|column .* does not exist|could not find/i.test(msg);
    if (!isSchemaErr) break;
    let removed = false;
    for (const col of OPTIONAL_COLS) {
      if (msg.includes(col) && col in insertBody) {
        delete insertBody[col];
        removed = true;
        stripCount++;
        break;
      }
    }
    if (!removed) break;
    ({ data, error } = await db.from('applications').insert(insertBody).select().single());
  }

  if (error) {
    // Log the raw database error so we can diagnose if the toast is still vague.
    // eslint-disable-next-line no-console
    console.error(
      '[applications.fromJob] database error:',
      error,
      'payload keys:',
      Object.keys(insertBody),
    );
    const code = (error as any).code ?? '';
    if (code === '23505' || /duplicate|unique/i.test(error.message)) {
      throw httpError(409, 'This consultant has already been submitted to this job.');
    }
    if (code === '23503' || /foreign key/i.test(error.message)) {
      throw httpError(
        400,
        `Foreign-key violation: ${error.message}. Check that the consultant / job / resume IDs are valid.`,
      );
    }
    if (/invalid input value for enum/i.test(error.message)) {
      throw httpError(
        400,
        `Enum value rejected: ${error.message}. The application_method or status value isn't in the database enum yet — apply database/ai-job-search-and-apply.sql.`,
      );
    }
    // Surface the exact Postgres message + code so we can fix it.
    throw httpError(500, `Database error: ${error.message} (code ${code || '?'})`);
  }
  // Audit trail: every successful application gets an apply_confirmed event.
  logEvent({
    application_id: data?.id,
    job_id: parsed.data.job_id,
    consultant_id: parsed.data.consultant_id,
    kind: 'apply_confirmed',
    payload: {
      method: parsed.data.method,
      match_score: parsed.data.match_score ?? null,
      ats_score: parsed.data.ats_score ?? null,
    },
    created_by: req.user.id,
  });
  res.status(201).json(data);
};

// ---------------------------------------------------------------------------
// Application event log — Jobright's apply-funnel audit trail.
// Rows can exist BEFORE an application is created (e.g. viewed, apply_declined).
// ---------------------------------------------------------------------------

const EVENT_KINDS = [
  'viewed',
  'apply_clicked',
  'customize_started',
  'customize_finished',
  'apply_confirmed',
  'apply_declined',
  'status_changed',
  'note',
] as const;

/** POST /applications/:id/events  body: { kind, job_id?, consultant_id?, payload? }
 *  Append an event to an existing application's log.
 *
 *  Also reusable via /applications/events for events that aren't tied to an
 *  application yet (see logEvent below). */
export const appendEvent: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    kind: z.enum(EVENT_KINDS),
    job_id: z.string().uuid().optional().nullable(),
    consultant_id: z.string().uuid().optional().nullable(),
    payload: z.record(z.string(), z.any()).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const insertBody: any = {
    application_id: req.params.id === 'none' ? null : req.params.id,
    job_id: parsed.data.job_id ?? null,
    consultant_id: parsed.data.consultant_id ?? null,
    kind: parsed.data.kind,
    payload: parsed.data.payload ?? null,
    created_by: req.user.id,
  };
  let { data, error } = await db.from('application_events').insert(insertBody).select().single();
  if (error && /application_events|relation .* does not exist/i.test(error.message)) {
    throw httpError(
      400,
      'application_events table missing — apply database/apply-flow-tables.sql to the database.',
    );
  }
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

/** GET /applications/:id/events — full event timeline for one application. */
export const listEvents: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db
    .from('application_events')
    .select('*')
    .eq('application_id', req.params.id)
    .order('created_at', { ascending: true });
  if (error) {
    if (/application_events|relation .* does not exist/i.test(error.message)) {
      res.json([]);
      return;
    }
    throw httpError(500, error.message);
  }
  res.json(data ?? []);
};

/** Internal helper — same insert as appendEvent but callable from other
 *  controllers without going through HTTP. Fire-and-forget; logs but never
 *  throws so the parent request still succeeds even if the audit row fails. */
export async function logEvent(opts: {
  application_id?: string | null;
  job_id?: string | null;
  consultant_id?: string | null;
  kind: (typeof EVENT_KINDS)[number];
  payload?: Record<string, unknown> | null;
  created_by?: string | null;
}): Promise<void> {
  try {
    const { error } = await db.from('application_events').insert({
      application_id: opts.application_id ?? null,
      job_id: opts.job_id ?? null,
      consultant_id: opts.consultant_id ?? null,
      kind: opts.kind,
      payload: opts.payload ?? null,
      created_by: opts.created_by ?? null,
    });
    if (error && !/application_events|schema cache/i.test(error.message)) {
      // eslint-disable-next-line no-console
      console.warn('[application_events.log] insert failed:', error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[application_events.log] threw:', e);
  }
}

/** Run ATS scoring against an application's job description + resume text. */
export const runAtsScore: RequestHandler = async (req, res) => {
  const resumeText = String(req.body?.resume_text ?? '');
  const jobDescription = String(req.body?.job_description ?? '');
  if (!resumeText || !jobDescription)
    throw httpError(400, 'resume_text and job_description required');

  const result = await atsScore(resumeText, jobDescription);
  const { data, error } = await db
    .from('applications')
    .update({ ats_score: result.score, ats_feedback: result })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};
