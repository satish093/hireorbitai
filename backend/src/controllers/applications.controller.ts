import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { atsScore } from '../services/ai.service';
import { httpError, MANAGER_TIER, type Role } from '../types';
import {
  managerGroupConsultantIds,
  isAdminTier,
  isGroupLead,
  leadCanAccessConsultant,
  assertCanAccessConsultant,
} from '../services/groupScope';

// ---------------------------------------------------------------------------
// Authorization helpers
//
// The router mount is requireRole(...BUSINESS_ROLES); the OPERATOR_TIER
// endpoints (list, create, update, events, …) are additionally gated per-route
// in applications.routes.ts. Only GET /applications/mine is reachable by a
// CONSULTANT. Each handler ALSO scopes by the caller's principal as
// defense-in-depth:
//   - MANAGER_TIER (super-admin, ceo, cto, director, manager, …) — full view.
//   - RECRUITER  — only applications where applications.recruiter_id ==
//                   <their recruiters.id>.
//   - CONSULTANT — only their own rows, via the narrowed listMine projection
//                   (the operator `list` consultant branch below is retained as
//                   defense-in-depth but is unreachable behind the route gate).
// ---------------------------------------------------------------------------

function isManagerTier(role?: string): boolean {
  return !!role && (MANAGER_TIER as string[]).includes(role);
}

async function getCallerRecruiterRowId(userId: string): Promise<string | null> {
  const { data } = await db.from('recruiters').select('id').eq('user_id', userId).maybeSingle();
  if ((data as { id?: string } | null)?.id) return (data as { id: string }).id;
  // Self-heal for legacy RECRUITER accounts created via /admin/users (or
  // invitations with null parent) that never got their `recruiters` row.
  // Without this the applications + submissions endpoints always return []
  // for these users until an admin intervenes. Mirrors the same self-heal
  // in consultants.controller.
  try {
    const { data: created } = await db
      .from('recruiters')
      .upsert({ user_id: userId, manager_id: null }, { onConflict: 'user_id' })
      .select('id')
      .single();
    return (created as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

async function getCallerConsultantRowId(userId: string): Promise<string | null> {
  const { data } = await db.from('consultants').select('id').eq('user_id', userId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

// Consultant-scope for create/checkDuplicate/fromJob is the canonical shared
// guard (admin unscoped; group lead → own group; recruiter → own consultants;
// consultant → self) — see services/groupScope.assertCanAccessConsultant.
const assertCanActOnConsultant = assertCanAccessConsultant;

interface ApplicationOwnership {
  id: string;
  recruiter_id: string | null;
  consultant_id: string | null;
}

/** Throws 404 if the application doesn't exist, 403 if the caller can't see
 *  it. Returns the loaded row for downstream use. */
async function loadAndAuthorize(
  caller: { id: string; role: Role; group_id?: string | null },
  applicationId: string,
): Promise<ApplicationOwnership> {
  const { data, error } = await db
    .from('applications')
    .select('id, recruiter_id, consultant_id')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  if (!data) throw httpError(404, 'Application not found');
  const row = data as ApplicationOwnership;

  // Admin tier unscoped; group leads (HR_MANAGER/MANAGER) only for consultants
  // in their group.
  if (isAdminTier(caller.role)) return row;
  if (isGroupLead(caller.role)) {
    if (row.consultant_id && (await leadCanAccessConsultant(caller, row.consultant_id))) return row;
    throw httpError(404, 'Application not found');
  }

  if (caller.role === 'RECRUITER') {
    const myRecId = await getCallerRecruiterRowId(caller.id);
    if (myRecId && row.recruiter_id === myRecId) return row;
  } else if (caller.role === 'CONSULTANT') {
    const myConsId = await getCallerConsultantRowId(caller.id);
    if (myConsId && row.consultant_id === myConsId) return row;
  }
  // 404 instead of 403 so the endpoint doesn't double as an existence oracle.
  throw httpError(404, 'Application not found');
}

// ---------------------------------------------------------------------------
// GET /applications — scoped list.
// ---------------------------------------------------------------------------
export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { consultant_id, recruiter_id, status } = req.query as Record<string, string | undefined>;
  let qb = db
    .from('applications')
    .select('*, job:jobs(*), vendor:vendors(*), consultant:consultants(*)');

  if (isManagerTier(req.user.role)) {
    if (consultant_id) qb = qb.eq('consultant_id', consultant_id);
    if (recruiter_id) qb = qb.eq('recruiter_id', recruiter_id);
    // A MANAGER only sees applications for consultants in their own group.
    const groupConsultantIds = await managerGroupConsultantIds(req.user);
    if (groupConsultantIds !== null) {
      if (groupConsultantIds.length === 0) {
        res.json([]);
        return;
      }
      qb = qb.in('consultant_id', groupConsultantIds);
    }
  } else if (req.user.role === 'RECRUITER') {
    const myRecId = await getCallerRecruiterRowId(req.user.id);
    if (!myRecId) {
      res.json([]);
      return;
    }
    qb = qb.eq('recruiter_id', myRecId);
    // Optional consultant filter is still honoured but only within the
    // recruiter's own pipeline.
    if (consultant_id) qb = qb.eq('consultant_id', consultant_id);
  } else if (req.user.role === 'CONSULTANT') {
    const myConsId = await getCallerConsultantRowId(req.user.id);
    if (!myConsId) {
      res.json([]);
      return;
    }
    qb = qb.eq('consultant_id', myConsId);
  } else {
    res.json([]);
    return;
  }

  if (status) qb = qb.eq('status', status);
  const { data, error } = await qb.order('submitted_at', { ascending: false });
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

// ---------------------------------------------------------------------------
// GET /applications/mine — consultant-safe view of the caller's OWN submissions.
//
// The operator `list` above is mounted OPERATOR_TIER and returns `*` (which
// carries recruiter-side context: recruiter_id, ats_score, internal notes) —
// deliberately hidden from consultants (see routes/index.ts mount comment).
// This endpoint exists so a CONSULTANT can power their dashboard with a
// NARROWED projection of their own applications and nothing else. It self-
// scopes to the caller's consultants row; a caller with no consultant row
// (any non-consultant, or a not-yet-onboarded consultant) gets [].
// ---------------------------------------------------------------------------
export const listMine: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const myConsId = await getCallerConsultantRowId(req.user.id);
  if (!myConsId) {
    res.json([]);
    return;
  }
  // Explicit safe projection — NO recruiter_id / ats_score / notes / recruiter embed.
  const { data, error } = await db
    .from('applications')
    .select(
      'id, status, submitted_at, job:jobs(id, title, company_name), vendor:vendors(id, company_name)',
    )
    .eq('consultant_id', myConsId)
    .order('submitted_at', { ascending: false });
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

/**
 * Check for an existing submission (consultant + job + vendor) before creating
 * a new one. Returns 409 with the offending row if found.
 */
export const checkDuplicate: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { consultant_id, job_id, vendor_id } = req.query as Record<string, string | undefined>;
  if (!consultant_id || !job_id) throw httpError(400, 'consultant_id and job_id required');

  // Scope: admin unscoped; group lead → own group; recruiter → own consultants;
  // consultant → self.
  await assertCanActOnConsultant(req.user, consultant_id);

  let qb = db
    .from('applications')
    .select('*')
    .eq('consultant_id', consultant_id)
    .eq('job_id', job_id);
  if (vendor_id) qb = qb.eq('vendor_id', vendor_id);
  const { data, error } = await qb;
  if (error) throw httpError(500, 'Database error');
  res.json({ duplicate: (data?.length ?? 0) > 0, matches: data });
};

// Mass-assignment allowlist for manual POST /applications. Excludes the
// server-controlled `recruiter_id` (which must never be caller-supplied —
// otherwise a recruiter/consultant who passes the consultant ownership check
// could mis-attribute the application to another recruiter's pipeline) and all
// other server-owned columns (created_at, status_changed_by, …). `force` is
// consumed by the duplicate guard, not persisted. Types are intentionally
// permissive (no stricter than the prior behavior) — the security fix is the
// allowlist + `.strict()`, not tightened field validation.
const createSchema = z
  .object({
    consultant_id: z.string(),
    job_id: z.string(),
    vendor_id: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    status: z.string().optional(),
    submitted_at: z.string().optional().nullable(),
    follow_up_at: z.string().optional().nullable(),
    rejection_reason: z.string().optional().nullable(),
    source_url: z.string().optional().nullable(),
    resume_id: z.string().uuid().optional().nullable(),
    force: z.boolean().optional(),
  })
  .strict();

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const body = parsed.data;
  if (!body.consultant_id || !body.job_id)
    throw httpError(400, 'consultant_id and job_id required');

  // Scope: the caller must legitimately represent that consultant (admin
  // unscoped; group lead → own group; recruiter → own consultants; consultant →
  // self). Without this, any signed-in user could pin an application to any
  // consultant.
  await assertCanActOnConsultant(req.user, body.consultant_id);

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

  // `force` is consumed by the duplicate-check guard above; strip it before
  // we hand the rest of the body to the INSERT so it doesn't collide with
  // the column allowlist. The `_force` rename signals "intentionally unused".
  const { force: _force, ...insertBody } = body;
  const { data, error } = await db.from('applications').insert(insertBody).select().single();
  if (error) throw httpError(500, 'Database error');
  res.status(201).json(data);
};

// Editable fields via PATCH. Anything not in this allowlist is silently
// dropped — protects against mass-assignment of recruiter_id / consultant_id /
// arbitrary AI fields by callers who pass the ownership check.
const updateSchema = z
  .object({
    status: z.string().optional(),
    notes: z.string().optional().nullable(),
    vendor_id: z.string().uuid().optional().nullable(),
    submitted_at: z.string().datetime().optional().nullable(),
    follow_up_at: z.string().datetime().optional().nullable(),
    rejection_reason: z.string().optional().nullable(),
    source_url: z.string().optional().nullable(),
  })
  .strict();

export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await loadAndAuthorize(req.user, req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const { data, error } = await db
    .from('applications')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    if (/invalid input value for enum application_status.*ARCHIVED/i.test(error.message)) {
      throw httpError(
        400,
        "ARCHIVED isn't in the application_status enum yet — apply database/applications-archived-status.sql to the database, then retry.",
      );
    }
    throw httpError(500, 'Database error');
  }
  res.json(data);
};

// ---------------------------------------------------------------------------
// POST /applications/from-job — record that the recruiter (or consultant)
// actually applied. Called from the "Did you apply? Yes" confirmation modal.
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

  // Scope the consultant id to the caller (admin unscoped; group lead → own
  // group; recruiter → own consultants; consultant → self). Without this, any
  // user could log an application "from" another consultant.
  await assertCanActOnConsultant(req.user, parsed.data.consultant_id);

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
    recruiter_id: (rec as { id?: string } | null)?.id ?? null,
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
    req.log.error(
      { err: error, payloadKeys: Object.keys(insertBody) },
      '[applications.fromJob] database error',
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
    throw httpError(500, `Database error: ${error.message} (code ${code || '?'})`);
  }
  // Audit trail: every successful application gets an apply_confirmed event.
  logEvent({
    application_id: (data as { id?: string } | null)?.id ?? null,
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

/** POST /applications/:id/events — append an event to an existing application's log. */
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

  // Two modes: attached to an existing application (must be owned by caller),
  // or "free-floating" pre-application events (POST /applications/none/events).
  // The free-floating mode lets recruiters log "viewed" / "apply_declined" /
  // "apply_clicked" before any application row exists.
  let applicationId: string | null = null;
  if (req.params.id !== 'none') {
    await loadAndAuthorize(req.user, req.params.id);
    applicationId = req.params.id;
  } else if (parsed.data.consultant_id) {
    // For pre-application events, the caller must still own the referenced
    // consultant — otherwise this is an audit-log forgery primitive.
    if (!isManagerTier(req.user.role)) {
      if (req.user.role === 'RECRUITER') {
        const myRecId = await getCallerRecruiterRowId(req.user.id);
        if (!myRecId) throw httpError(403, 'Forbidden');
        const { data: cons } = await db
          .from('consultants')
          .select('id')
          .eq('id', parsed.data.consultant_id)
          .eq('recruiter_id', myRecId)
          .maybeSingle();
        if (!cons) throw httpError(403, 'Forbidden');
      } else if (req.user.role === 'CONSULTANT') {
        const myConsId = await getCallerConsultantRowId(req.user.id);
        if (myConsId !== parsed.data.consultant_id) throw httpError(403, 'Forbidden');
      } else {
        throw httpError(403, 'Forbidden');
      }
    }
  }

  const insertBody: any = {
    application_id: applicationId,
    job_id: parsed.data.job_id ?? null,
    consultant_id: parsed.data.consultant_id ?? null,
    kind: parsed.data.kind,
    payload: parsed.data.payload ?? null,
    created_by: req.user.id,
  };
  const { data, error } = await db.from('application_events').insert(insertBody).select().single();
  if (error && /application_events|relation .* does not exist/i.test(error.message)) {
    throw httpError(
      400,
      'application_events table missing — apply database/apply-flow-tables.sql to the database.',
    );
  }
  if (error) throw httpError(500, 'Database error');
  res.status(201).json(data);
};

/** GET /applications/:id/events — full event timeline for one application. */
export const listEvents: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await loadAndAuthorize(req.user, req.params.id);
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
    throw httpError(500, 'Database error');
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
      console.warn('[application_events.log] insert failed (table missing or schema mismatch)');
    }
  } catch {
    /* fire-and-forget audit; swallow */
  }
}

/** Run ATS scoring against an application's job description + resume text. */
export const runAtsScore: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await loadAndAuthorize(req.user, req.params.id);

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
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};
