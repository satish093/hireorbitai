import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import {
  uploadResumeFile,
  getResumeSignedUrl,
  readResumeFile,
  deleteResumeFile,
} from '../services/storage.service';
import {
  scoreResume,
  tailorResumeForJob,
  tailorResumeForJobStructured,
  scoreResumeAgainstJob,
  extractJobRequirements,
} from '../services/ai.service';
import { extractResumeText } from '../services/resumeText.service';
import { httpError, MANAGER_TIER } from '../types';

function isManagerTier(role?: string): boolean {
  return !!role && (MANAGER_TIER as string[]).includes(role);
}

/**
 * Authorize the caller to view/act on the given consultantId's resumes.
 * Throws 403 if they shouldn't see it.
 */
async function authorizeConsultantAccess(
  consultantId: string,
  caller: { id: string; role: string },
): Promise<void> {
  if (isManagerTier(caller.role)) return; // admins + managers see all

  const { data: cons } = await db
    .from('consultants')
    .select('id, user_id, recruiter_id')
    .eq('id', consultantId)
    .maybeSingle();
  if (!cons) throw httpError(404, 'Consultant not found');

  if (caller.role === 'CONSULTANT') {
    if (cons.user_id !== caller.id) throw httpError(403, 'Forbidden');
    return;
  }
  if (caller.role === 'RECRUITER') {
    const { data: rec } = await db
      .from('recruiters')
      .select('id')
      .eq('user_id', caller.id)
      .maybeSingle();
    if (!rec || cons.recruiter_id !== rec.id) throw httpError(403, 'Forbidden');
    return;
  }
  throw httpError(403, 'Forbidden');
}

/** Delete a single resume version. Auto-promotes the next most-recent if deleting current. */
export const deleteVersion: RequestHandler = async (req, _res, _next) => {
  const { id } = req.params;
  const caller = req.user!;

  const { data: resume } = await db
    .from('resumes')
    .select('id, consultant_id, storage_path, is_current')
    .eq('id', id)
    .maybeSingle();
  if (!resume) throw httpError(404, 'Resume not found');

  await authorizeConsultantAccess(resume.consultant_id, caller);

  if (resume.is_current) {
    const { data: next } = await db
      .from('resumes')
      .select('id')
      .eq('consultant_id', resume.consultant_id)
      .neq('id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (next) {
      await db.from('resumes').update({ is_current: true }).eq('id', next.id);
    }
  }

  await db.from('resumes').delete().eq('id', id);
  try {
    await deleteResumeFile(resume.storage_path);
  } catch {
    // File already gone from storage — ignore
  }

  _res.status(204).end();
};

/** List resume versions for a consultant. */
export const listForConsultant: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await authorizeConsultantAccess(req.params.consultantId, req.user);
  // Embed the tailored-for job so the version strip can render "Tailored for
  // <company>" without an N+1 fetch. Fall back to '*' if the column/join isn't
  // available yet (resumes predates the tailored_for_job_id column).
  let { data, error } = await db
    .from('resumes')
    .select('*, tailored_job:jobs!tailored_for_job_id(id, title, company_name)')
    .eq('consultant_id', req.params.consultantId)
    .order('version', { ascending: false });
  if (error && /tailored_for_job_id|schema cache|column/i.test(error.message)) {
    ({ data, error } = await db
      .from('resumes')
      .select('*')
      .eq('consultant_id', req.params.consultantId)
      .order('version', { ascending: false }));
  }
  if (error) throw httpError(500, error.message);
  res.json(data);
};

/**
 * Upload a new resume version. multipart/form-data: { file, consultant_id, text? }
 * The server extracts readable text from the uploaded PDF/DOCX (stored in
 * body_text) so the site can display it and the AI features can use it. If the
 * client passes `text` it takes precedence over extraction. When text is
 * available we also run AI scoring once, server-side.
 */
export const upload: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw httpError(400, 'Missing file');
  const consultant_id = (req.body?.consultant_id as string) ?? '';
  if (!consultant_id) throw httpError(400, 'Missing consultant_id');
  await authorizeConsultantAccess(consultant_id, req.user);

  // Next version number.
  const { data: existing } = await db
    .from('resumes')
    .select('version')
    .eq('consultant_id', consultant_id)
    .order('version', { ascending: false })
    .limit(1);
  const nextVersion = (existing?.[0]?.version ?? 0) + 1;

  const { path, size } = await uploadResumeFile(consultant_id, {
    buffer: file.buffer,
    originalname: file.originalname,
    mimetype: file.mimetype,
  });

  let aiScore: number | null = null;
  let aiFeedback: any = null;
  // Convert the raw upload into readable text. Client-pasted `text` wins (the
  // wizard sometimes provides it); otherwise extract server-side from the
  // PDF/DOCX so body_text is populated and every downstream AI feature can use
  // it. Extraction is non-fatal — an unparseable file just yields ''.
  let rawText = req.body?.text ? String(req.body.text) : '';
  if (!rawText) {
    rawText = await extractResumeText({
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
  }
  if (rawText) {
    try {
      const result = await scoreResume(rawText);
      aiScore = result.score;
      aiFeedback = result;
    } catch (e) {
      // Non-fatal — resume is still saved; client can retry scoring.

      console.warn('Resume AI scoring failed:', e);
    }
    // Keep the raw text on ai_feedback so /jobs/:id/skill-match-for-me can
    // score against this resume later without the client having to re-paste.
    aiFeedback = { ...(aiFeedback ?? {}), resume_text: rawText };
  }

  // Flip is_current off for prior versions, on for this one.
  await db.from('resumes').update({ is_current: false }).eq('consultant_id', consultant_id);

  const insertBody: any = {
    consultant_id,
    version: nextVersion,
    file_name: file.originalname,
    storage_path: path,
    mime_type: file.mimetype,
    size_bytes: size,
    ai_score: aiScore,
    ai_feedback: aiFeedback,
    is_current: true,
    uploaded_by: req.user.id,
  };
  // Persist the extracted text as readable data. body_text is a late-arrival
  // column, so strip-and-retry if a DB hasn't applied that migration yet
  // (the text still lives on ai_feedback.resume_text for AI consumers).
  if (rawText) insertBody.body_text = rawText;
  let { data, error } = await db.from('resumes').insert(insertBody).select().single();
  if (error && /body_text/.test(error.message) && /schema cache|column/i.test(error.message)) {
    delete insertBody.body_text;
    ({ data, error } = await db.from('resumes').insert(insertBody).select().single());
  }
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

/**
 * Re-extract readable text from an already-uploaded resume's stored file.
 * For versions uploaded before server-side extraction existed (body_text
 * empty), this reads the original PDF/DOCX back, extracts the text into
 * body_text, and re-runs AI scoring. No-op (extracted:false) for files with no
 * extractable text (legacy .doc, scanned PDFs, tailored .md versions).
 */
export const reextract: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: row, error } = await db
    .from('resumes')
    .select('id, consultant_id, storage_path, mime_type, file_name, ai_feedback')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) throw httpError(500, error.message);
  if (!row) throw httpError(404, 'Resume not found');
  const resume = row as any;
  await authorizeConsultantAccess(resume.consultant_id, req.user);
  if (!resume.storage_path)
    throw httpError(400, 'This version has no stored file to extract from.');

  const buffer = await readResumeFile(resume.storage_path);
  const text = await extractResumeText({
    buffer,
    mimetype: resume.mime_type ?? '',
    originalname: resume.file_name ?? '',
  });
  if (!text) {
    res.json({ id: resume.id, extracted: false, chars: 0, ai_score: null });
    return;
  }

  let aiScore: number | null = null;
  let aiFeedback: any = { ...(resume.ai_feedback ?? {}), resume_text: text };
  try {
    const scored = await scoreResume(text);
    aiScore = scored.score;
    aiFeedback = { ...scored, resume_text: text };
  } catch (e) {
    // Non-fatal — the text is still saved; the user can score on demand.

    console.warn('Re-extract AI scoring failed:', e);
  }

  const patch: any = { ai_feedback: aiFeedback, ai_score: aiScore, body_text: text };
  let { error: upErr } = await db.from('resumes').update(patch).eq('id', resume.id);
  if (upErr && /body_text/.test(upErr.message) && /schema cache|column/i.test(upErr.message)) {
    delete patch.body_text;
    ({ error: upErr } = await db.from('resumes').update(patch).eq('id', resume.id));
  }
  if (upErr) throw httpError(500, upErr.message);
  res.json({ id: resume.id, extracted: true, chars: text.length, ai_score: aiScore });
};

/** Signed-URL download link for a resume version. */
export const downloadUrl: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db
    .from('resumes')
    .select('storage_path, consultant_id')
    .eq('id', req.params.id)
    .single();
  if (error || !data) throw httpError(404, 'Resume not found');
  await authorizeConsultantAccess(data.consultant_id, req.user);
  const url = await getResumeSignedUrl(data.storage_path);
  res.json({ url });
};

/** Run AI scoring on an existing resume using provided text. */
export const score: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const text = String(req.body?.text ?? '');
  if (!text) throw httpError(400, 'Missing resume text');
  const { data: existing } = await db
    .from('resumes')
    .select('consultant_id')
    .eq('id', req.params.id)
    .single();
  if (!existing) throw httpError(404, 'Resume not found');
  await authorizeConsultantAccess(existing.consultant_id, req.user);
  const result = await scoreResume(text);
  const { data, error } = await db
    .from('resumes')
    .update({ ai_score: result.score, ai_feedback: { ...result, resume_text: text } })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

/** Mark a specific version as current. */
export const setCurrent: RequestHandler = async (req, res) => {
  const { id } = req.params;
  const { data: resume, error: e1 } = await db
    .from('resumes')
    .select('consultant_id')
    .eq('id', id)
    .single();
  if (e1 || !resume) throw httpError(404, 'Resume not found');
  if (!req.user) throw httpError(401, 'Not authenticated');
  await authorizeConsultantAccess(resume.consultant_id, req.user);
  await db.from('resumes').update({ is_current: false }).eq('consultant_id', resume.consultant_id);
  const { data, error } = await db
    .from('resumes')
    .update({ is_current: true })
    .eq('id', id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

// ---------------------------------------------------------------------------
// AI-tailor a resume for a specific job (Jobright's "Fix My Resume" flow).
//
// Body:
//   {
//     source_resume_id: uuid,    // resume to start from (must belong to consultant)
//     job_id: uuid,
//     sections: string[],        // ["Summary","Skills","Work Experience","Projects","Certifications"]
//     keywords: string[],        // missing keywords the recruiter chose to inject
//   }
//
// Returns the new resume row + before/after match scores + change summary.
// ---------------------------------------------------------------------------
export const tailorForJob: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    source_resume_id: z.string().uuid(),
    job_id: z.string().uuid(),
    sections: z.array(z.string()).max(8),
    keywords: z.array(z.string()).max(40),
    /** Optional escape hatch: when the source resume has no extractable text
     *  (e.g. uploaded before we captured PDF body), the recruiter can paste
     *  the text here. We persist it on the source resume so the next tailor
     *  call doesn't need re-pasting. */
    resume_text: z.string().min(50).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Load the source resume (with text) and the job.
  const { data: source, error: srcErr } = await db
    .from('resumes')
    .select('id, consultant_id, file_name, version, ai_feedback, body_text')
    .eq('id', parsed.data.source_resume_id)
    .single();
  if (srcErr || !source) throw httpError(404, 'Source resume not found');
  await authorizeConsultantAccess(source.consultant_id, req.user);

  let resumeText: string =
    (source as any).body_text ||
    (typeof (source as any).ai_feedback?.resume_text === 'string'
      ? (source as any).ai_feedback.resume_text
      : '') ||
    '';

  // If the caller passed pasted text, use it AND persist it on the source so
  // we never have to ask again.
  if (parsed.data.resume_text && (!resumeText || resumeText.length < 100)) {
    resumeText = parsed.data.resume_text;
    const persistPatch: any = {
      ai_feedback: { ...((source as any).ai_feedback ?? {}), resume_text: parsed.data.resume_text },
    };
    // Try storing in body_text too; falls back to ai_feedback only if column doesn't exist.
    persistPatch.body_text = parsed.data.resume_text;
    let { error: persistErr } = await db.from('resumes').update(persistPatch).eq('id', source.id);
    if (
      persistErr &&
      /body_text/.test(persistErr.message) &&
      /schema cache|column/i.test(persistErr.message)
    ) {
      delete persistPatch.body_text;
      ({ error: persistErr } = await db.from('resumes').update(persistPatch).eq('id', source.id));
    }
    // Non-fatal if persist still fails — we already have the text in memory for this request.
  }

  if (!resumeText) {
    throw httpError(
      400,
      'NO_RESUME_TEXT: Source resume has no extractable text. Paste the resume text in the wizard or re-upload the resume with a text body.',
    );
  }

  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('*')
    .eq('id', parsed.data.job_id)
    .single();
  if (jobErr || !job) throw httpError(404, 'Job not found');

  // Ensure requirements are extracted so we have skills + must_haves.
  let reqs = job.requirements;
  if (!reqs) {
    reqs = await extractJobRequirements({
      title: job.title,
      description: job.description,
      required_skills: job.required_skills,
      location: job.location,
    });
    await db.from('jobs').update({ requirements: reqs }).eq('id', job.id);
  }

  // Before score on the ORIGINAL resume.
  const before = await scoreResumeAgainstJob({
    resumeText,
    job: {
      title: job.title,
      description: job.description,
      required_skills: reqs?.required_skills ?? job.required_skills,
      min_years_of_experience: reqs?.min_years_of_experience ?? null,
      job_seniority: reqs?.job_seniority ?? job.level ?? null,
    },
  });

  let tailored = await tailorResumeForJob({
    resumeText,
    job: {
      title: job.title,
      company: job.company_name,
      description: job.description,
      required_skills: reqs?.required_skills ?? job.required_skills,
      must_haves: reqs?.must_haves ?? [],
    },
    sections: parsed.data.sections,
    keywords: parsed.data.keywords,
  });

  let after = await scoreResumeAgainstJob({
    resumeText: tailored.tailored_resume_markdown,
    job: {
      title: job.title,
      description: job.description,
      required_skills: reqs?.required_skills ?? job.required_skills,
      min_years_of_experience: reqs?.min_years_of_experience ?? null,
      job_seniority: reqs?.job_seniority ?? job.level ?? null,
    },
  });

  // Iterative refinement: if the first pass landed below the target band,
  // retry in "aggressive" mode using the freshly-tailored resume as the
  // starting point. This routinely lifts scores 10–20 points without
  // requiring the recruiter to re-prompt.
  const TARGET_SCORE = 85;
  if (after.overall_score < TARGET_SCORE) {
    const retried = await tailorResumeForJob({
      resumeText: tailored.tailored_resume_markdown, // build on what we just produced
      job: {
        title: job.title,
        company: job.company_name,
        description: job.description,
        required_skills: reqs?.required_skills ?? job.required_skills,
        must_haves: reqs?.must_haves ?? [],
      },
      sections: parsed.data.sections,
      keywords: parsed.data.keywords,
      mode: 'aggressive',
    });
    const retriedScore = await scoreResumeAgainstJob({
      resumeText: retried.tailored_resume_markdown,
      job: {
        title: job.title,
        description: job.description,
        required_skills: reqs?.required_skills ?? job.required_skills,
        min_years_of_experience: reqs?.min_years_of_experience ?? null,
        job_seniority: reqs?.job_seniority ?? job.level ?? null,
      },
    });
    // Keep whichever pass scored higher (sometimes aggressive over-densifies
    // and trips the scorer's "too generic" check — keep the better one).
    if (retriedScore.overall_score > after.overall_score) {
      tailored = {
        ...retried,
        changes_summary: [
          ...tailored.changes_summary,
          `[Pass 2 — aggressive] ${retried.changes_summary.slice(0, 3).join('; ')}`,
        ],
      };
      after = retriedScore;
    }
  }

  // Persist as a new resume version. We store the markdown body in body_text.
  const { data: existing } = await db
    .from('resumes')
    .select('version')
    .eq('consultant_id', source.consultant_id)
    .order('version', { ascending: false })
    .limit(1);
  const nextVersion = (existing?.[0]?.version ?? 0) + 1;
  const safeTitle = String(job.title ?? 'job')
    .slice(0, 40)
    .replace(/\s+/g, '_');
  const fileName = `tailored-v${nextVersion}-${safeTitle}.md`;

  const insertRow: any = {
    consultant_id: source.consultant_id,
    version: nextVersion,
    file_name: fileName,
    storage_path: `tailored/${source.consultant_id}/${nextVersion}.md`,
    mime_type: 'text/markdown',
    size_bytes: Buffer.byteLength(tailored.tailored_resume_markdown, 'utf8'),
    ai_score: after.overall_score,
    ai_feedback: {
      rank_desc: after.rank_desc,
      rationale: after.rationale,
      per_skill: after.per_skill,
      resume_text: tailored.tailored_resume_markdown,
    },
    is_current: false,
    uploaded_by: req.user.id,
    tailored_for_job_id: job.id,
    parent_resume_id: source.id,
    tailor_metadata: {
      sections_modified: tailored.sections_modified,
      keywords_added: tailored.keywords_added,
      changes_summary: tailored.changes_summary,
      before_score: before.overall_score,
      after_score: after.overall_score,
    },
    body_text: tailored.tailored_resume_markdown,
  };

  let { data, error } = await db.from('resumes').insert(insertRow).select().single();
  if (
    error &&
    /tailored_for_job_id|parent_resume_id|tailor_metadata|body_text/.test(error.message) &&
    /schema cache|column/i.test(error.message)
  ) {
    delete insertRow.tailored_for_job_id;
    delete insertRow.parent_resume_id;
    delete insertRow.tailor_metadata;
    delete insertRow.body_text;
    ({ data, error } = await db.from('resumes').insert(insertRow).select().single());
  }
  if (error) throw httpError(500, error.message);

  // Persist a first-class customization row so we can later query "all
  // customizations for job X" or "all customizations by recruiter Y" cheaply.
  // Non-fatal if the table isn't migrated yet.
  try {
    await db.from('resume_customizations').insert({
      consultant_id: source.consultant_id,
      job_id: parsed.data.job_id,
      source_resume_id: source.id,
      tailored_resume_id: data?.id ?? null,
      sections_chosen: parsed.data.sections,
      keywords_chosen: parsed.data.keywords,
      keywords_added: tailored.keywords_added,
      changes_summary: tailored.changes_summary,
      before_score: before.overall_score,
      after_score: after.overall_score,
      created_by: req.user.id,
    });
  } catch {
    /* table missing — surfaces via the apply-flow-tables.sql migration */
  }

  res.status(201).json({
    resume: data,
    tailored_markdown: tailored.tailored_resume_markdown,
    before_score: before.overall_score,
    after_score: after.overall_score,
    rank_before: before.rank_desc,
    rank_after: after.rank_desc,
    changes_summary: tailored.changes_summary,
    keywords_added: tailored.keywords_added,
    sections_modified: tailored.sections_modified,
  });
};

// ---------------------------------------------------------------------------
// Fetch a resume's body (markdown). Used by the "Download resume" button.
// ---------------------------------------------------------------------------
export const body: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db
    .from('resumes')
    .select('id, consultant_id, file_name, body_text, ai_feedback, tailor_metadata, ai_score')
    .eq('id', req.params.id)
    .single();
  if (error || !data) throw httpError(404, 'Resume not found');
  await authorizeConsultantAccess(data.consultant_id, req.user);
  const text =
    (data as any).body_text ||
    (typeof (data as any).ai_feedback?.resume_text === 'string'
      ? (data as any).ai_feedback.resume_text
      : '');
  res.json({
    id: data.id,
    file_name: data.file_name,
    body: text,
    tailor_metadata: (data as any).tailor_metadata ?? null,
    ai_score: data.ai_score ?? null,
  });
};

// ===========================================================================
// Tailoring workspace — resume_tailor_sessions + resume_tailor_edits
//
// A session is one AI tailoring run from a base version toward a job. It owns
// an ordered list of reviewable per-section edits. "apply" materializes the
// accepted subset into a brand-new resume version (never overwrites — versions
// stay immutable). Backed by database/resume-tailor-sessions.sql.
// ===========================================================================

const SESSION_COLS =
  'id, resume_id, base_version_id, result_version_id, job_id, applied, ai_summary, score_before, score_after, edit_count, created_at, job:jobs!job_id(id, title, company_name)';
const EDIT_COLS = 'id, section, before_text, after_text, ai_reason, status, ordinal';

/** Load a resume version row by id and authorize the caller against its
 *  consultant. The single choke point every workspace endpoint runs through —
 *  IDOR protection lives here, not in the route. */
async function loadResumeForCaller(id: string, caller: { id: string; role: string }): Promise<any> {
  const { data } = await db
    .from('resumes')
    .select(
      'id, consultant_id, version, file_name, body_text, ai_feedback, ai_score, is_current, tailored_for_job_id, tailor_metadata, created_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (!data) throw httpError(404, 'Resume not found');
  await authorizeConsultantAccess((data as any).consultant_id, caller);
  return data;
}

function resumeBodyText(row: any): string {
  return (
    row?.body_text ||
    (typeof row?.ai_feedback?.resume_text === 'string' ? row.ai_feedback.resume_text : '') ||
    ''
  );
}

const stripBold = (s: string): string => s.replace(/\*\*(.+?)\*\*/g, '$1');

function versionLite(r: any) {
  return r
    ? { id: r.id, version: r.version, file_name: r.file_name, ai_score: r.ai_score ?? null }
    : null;
}

/** Split a markdown resume into a heading -> section-body map. */
function splitSections(md: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!md) return map;
  const parts = md.split(/\n(?=#{1,3}\s)/);
  for (const part of parts) {
    const m = part.match(/^#{1,3}\s+(.+)/);
    const heading = m ? m[1].trim() : 'Header';
    map.set(heading, part.trim());
  }
  return map;
}

/** Heuristic 5-factor ATS breakdown — cheap, no AI round-trip. Falls back
 *  gracefully when there's no target job (perSkill empty). */
function computeAtsFactors(text: string, perSkill: Array<{ skill: string; score: number }>) {
  const bullets = text.split('\n').filter((l) => /^\s*[-*•]/.test(l));
  const totalBullets = bullets.length || 1;
  const quantified = bullets.filter((b) => /\d|%|\$/.test(b)).length;
  const ACTION =
    /^\s*[-*•]\s*(led|built|designed|shipped|drove|owned|launched|reduced|improved|increased|cut|automated|architected|delivered|scaled|migrated|implemented|created|developed|optimized|managed|spearheaded|engineered|established|streamlined)/i;
  const actionful = bullets.filter((b) => ACTION.test(b)).length;
  const matched = perSkill.filter((p) => p.score >= 0.75).length;
  const coverPct = perSkill.length ? Math.round((matched / perSkill.length) * 100) : text ? 60 : 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const recent = /(202[2-9]|present|current)/i.test(text);
  const lengthScore =
    words === 0 ? 0 : words < 250 ? 45 : words <= 950 ? 92 : words <= 1300 ? 70 : 50;
  return [
    {
      key: 'keyword_coverage',
      label: 'Keyword coverage',
      score: coverPct,
      hint: perSkill.length
        ? `${matched} / ${perSkill.length} must-haves`
        : 'No target job selected',
    },
    {
      key: 'quantified_impact',
      label: 'Quantified impact',
      score: Math.round((quantified / totalBullets) * 100),
      hint: `${quantified} of ${totalBullets} bullets quantified`,
    },
    {
      key: 'recency',
      label: 'Recency',
      score: recent ? 90 : 55,
      hint: recent ? 'Recent dates present' : 'Add recent dates',
    },
    {
      key: 'length_density',
      label: 'Length / density',
      score: lengthScore,
      hint: `${words} words`,
    },
    {
      key: 'action_verbs',
      label: 'Action verbs',
      score: Math.round((actionful / totalBullets) * 100),
      hint: `${actionful} of ${totalBullets} bullets lead with an action verb`,
    },
  ];
}

const MISSING_TABLE = /schema cache|does not exist|relation .* does not exist|undefined table/i;

/** GET /resumes/:id/tailor-sessions?versionId=… — sessions for a version. */
export const listTailorSessions: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const base = await loadResumeForCaller(req.params.id, req.user);
  const versionId = (req.query.versionId as string) || base.id;
  const { data, error } = await db
    .from('resume_tailor_sessions')
    .select(SESSION_COLS)
    .eq('base_version_id', versionId)
    .order('created_at', { ascending: false });
  if (error) {
    // Table not migrated yet — render an empty history rather than 500ing.
    if (MISSING_TABLE.test(error.message)) {
      res.json([]);
      return;
    }
    throw httpError(500, error.message);
  }
  res.json(data ?? []);
};

/** GET /resumes/:id/tailor-sessions/:sessionId — one session with its edits. */
export const getTailorSession: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: session, error } = await db
    .from('resume_tailor_sessions')
    .select(SESSION_COLS)
    .eq('id', req.params.sessionId)
    .maybeSingle();
  if (error && MISSING_TABLE.test(error.message)) throw httpError(404, 'Tailor session not found');
  if (error) throw httpError(500, error.message);
  if (!session) throw httpError(404, 'Tailor session not found');
  // Authorize against the session's OWN resume — closes cross-consultant IDOR.
  await loadResumeForCaller((session as any).resume_id, req.user);
  const { data: edits } = await db
    .from('resume_tailor_edits')
    .select(EDIT_COLS)
    .eq('session_id', (session as any).id)
    .order('ordinal', { ascending: true });
  res.json({ ...session, edits: edits ?? [] });
};

/** POST /resumes/:id/tailor-sessions — kick off a new AI tailor for a job. */
export const createTailorSession: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z
    .object({
      job_id: z.string().uuid(),
      source_version_id: z.string().uuid().optional(),
      sections: z.array(z.string()).max(8).optional(),
      keywords: z.array(z.string()).max(40).optional(),
      resume_text: z.string().min(50).optional(),
    })
    .strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const sourceId = parsed.data.source_version_id ?? req.params.id;
  const source = await loadResumeForCaller(sourceId, req.user);

  let resumeText = resumeBodyText(source);
  if (parsed.data.resume_text && (!resumeText || resumeText.length < 100)) {
    resumeText = parsed.data.resume_text;
    const persistPatch: any = {
      ai_feedback: { ...(source.ai_feedback ?? {}), resume_text: parsed.data.resume_text },
      body_text: parsed.data.resume_text,
    };
    let { error: persistErr } = await db.from('resumes').update(persistPatch).eq('id', source.id);
    if (
      persistErr &&
      /body_text/.test(persistErr.message) &&
      /schema cache|column/i.test(persistErr.message)
    ) {
      delete persistPatch.body_text;
      await db.from('resumes').update(persistPatch).eq('id', source.id);
    }
  }
  if (!resumeText) {
    throw httpError(
      400,
      'NO_RESUME_TEXT: Source resume has no extractable text. Paste the resume text or re-upload with a text body.',
    );
  }

  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('*')
    .eq('id', parsed.data.job_id)
    .single();
  if (jobErr || !job) throw httpError(404, 'Job not found');

  let reqs = job.requirements;
  if (!reqs) {
    reqs = await extractJobRequirements({
      title: job.title,
      description: job.description,
      required_skills: job.required_skills,
      location: job.location,
    });
    await db.from('jobs').update({ requirements: reqs }).eq('id', job.id);
  }

  const sections = parsed.data.sections ?? ['Summary', 'Skills', 'Work Experience'];
  const keywords = parsed.data.keywords ?? [];

  const before = await scoreResumeAgainstJob({
    resumeText,
    job: {
      title: job.title,
      description: job.description,
      required_skills: reqs?.required_skills ?? job.required_skills,
      min_years_of_experience: reqs?.min_years_of_experience ?? null,
      job_seniority: reqs?.job_seniority ?? job.level ?? null,
    },
  });

  const tailored = await tailorResumeForJobStructured({
    resumeText,
    job: {
      title: job.title,
      company: job.company_name,
      description: job.description,
      required_skills: reqs?.required_skills ?? job.required_skills,
      must_haves: reqs?.must_haves ?? [],
    },
    sections,
    keywords,
  });

  const after = await scoreResumeAgainstJob({
    resumeText: tailored.tailored_resume_markdown,
    job: {
      title: job.title,
      description: job.description,
      required_skills: reqs?.required_skills ?? job.required_skills,
      min_years_of_experience: reqs?.min_years_of_experience ?? null,
      job_seniority: reqs?.job_seniority ?? job.level ?? null,
    },
  });

  const { data: session, error: sErr } = await db
    .from('resume_tailor_sessions')
    .insert({
      resume_id: source.id,
      base_version_id: source.id,
      result_version_id: null,
      job_id: job.id,
      applied: false,
      ai_summary: tailored.ai_summary,
      result_markdown: tailored.tailored_resume_markdown,
      score_before: Math.round(before.overall_score),
      score_after: Math.round(after.overall_score),
      edit_count: tailored.edits.length,
      created_by: req.user.id,
    })
    .select(SESSION_COLS)
    .single();
  if (sErr) {
    if (MISSING_TABLE.test(sErr.message)) {
      throw httpError(
        503,
        'Tailor sessions not migrated — apply database/resume-tailor-sessions.sql',
      );
    }
    throw httpError(500, sErr.message);
  }

  const editRows = tailored.edits.map((e, i) => ({
    session_id: (session as any).id,
    section: e.section,
    before_text: e.before_text,
    after_text: e.after_text,
    ai_reason: e.ai_reason,
    status: 'proposed',
    ordinal: i,
  }));
  let edits: any[] = [];
  if (editRows.length) {
    const { error: eErr } = await db.from('resume_tailor_edits').insert(editRows);
    if (eErr) throw httpError(500, eErr.message);
    const { data: inserted } = await db
      .from('resume_tailor_edits')
      .select(EDIT_COLS)
      .eq('session_id', (session as any).id)
      .order('ordinal', { ascending: true });
    edits = inserted ?? [];
  }

  res.status(201).json({ ...session, edits });
};

/** PATCH /resumes/:id/tailor-sessions/:sessionId/edits/:editId — set status. */
export const patchTailorEdit: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z
    .object({
      status: z.enum(['accepted', 'rejected', 'edited']),
      after_text: z.string().min(1).optional(),
    })
    .strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const { data: edit } = await db
    .from('resume_tailor_edits')
    .select('id, session_id, status')
    .eq('id', req.params.editId)
    .maybeSingle();
  if (!edit || (edit as any).session_id !== req.params.sessionId)
    throw httpError(404, 'Edit not found');
  const { data: session } = await db
    .from('resume_tailor_sessions')
    .select('id, resume_id')
    .eq('id', (edit as any).session_id)
    .maybeSingle();
  if (!session) throw httpError(404, 'Edit not found');
  await loadResumeForCaller((session as any).resume_id, req.user);

  const patch: any = { status: parsed.data.status };
  if (parsed.data.status === 'edited') {
    if (!parsed.data.after_text) throw httpError(400, 'after_text required when status is edited');
    patch.after_text = parsed.data.after_text;
  }
  const { data, error } = await db
    .from('resume_tailor_edits')
    .update(patch)
    .eq('id', (edit as any).id)
    .select(EDIT_COLS)
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

/** POST /resumes/:id/tailor-sessions/:sessionId/apply — materialize accepted
 *  edits into a brand-new resume version. Idempotent once applied. */
export const applyTailorSession: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: session } = await db
    .from('resume_tailor_sessions')
    .select('*')
    .eq('id', req.params.sessionId)
    .maybeSingle();
  if (!session) throw httpError(404, 'Tailor session not found');
  const source = await loadResumeForCaller((session as any).resume_id, req.user);

  if ((session as any).applied && (session as any).result_version_id) {
    const { data: existing } = await db
      .from('resumes')
      .select('*')
      .eq('id', (session as any).result_version_id)
      .maybeSingle();
    if (existing) {
      res.json({ resume: existing, session });
      return;
    }
  }

  const { data: edits } = await db
    .from('resume_tailor_edits')
    .select(EDIT_COLS)
    .eq('session_id', (session as any).id)
    .order('ordinal', { ascending: true });

  // Reconstruct the final body from the full AI rewrite, then revert any
  // sections the reviewer rejected (best-effort verbatim match). Versions are
  // immutable, so this always writes a NEW row.
  let body: string = (session as any).result_markdown || resumeBodyText(source);
  for (const e of edits ?? []) {
    const aiAfter = stripBold((e as any).after_text);
    if (
      (e as any).status === 'rejected' &&
      (e as any).before_text != null &&
      body.includes(aiAfter)
    ) {
      body = body.replace(aiAfter, (e as any).before_text);
    }
  }
  body = stripBold(body);

  const { data: latest } = await db
    .from('resumes')
    .select('version')
    .eq('consultant_id', source.consultant_id)
    .order('version', { ascending: false })
    .limit(1);
  const nextVersion = ((latest?.[0] as any)?.version ?? 0) + 1;
  const fileName = `tailored-v${nextVersion}.md`;

  const insertRow: any = {
    consultant_id: source.consultant_id,
    version: nextVersion,
    file_name: fileName,
    storage_path: `tailored/${source.consultant_id}/${nextVersion}.md`,
    mime_type: 'text/markdown',
    size_bytes: Buffer.byteLength(body, 'utf8'),
    ai_score: (session as any).score_after ?? null,
    ai_feedback: { resume_text: body, from_tailor_session: (session as any).id },
    is_current: false,
    uploaded_by: req.user.id,
    tailored_for_job_id: (session as any).job_id,
    parent_resume_id: source.id,
    body_text: body,
  };
  let { data: created, error } = await db.from('resumes').insert(insertRow).select().single();
  if (
    error &&
    /tailored_for_job_id|parent_resume_id|body_text/.test(error.message) &&
    /schema cache|column/i.test(error.message)
  ) {
    delete insertRow.tailored_for_job_id;
    delete insertRow.parent_resume_id;
    delete insertRow.body_text;
    ({ data: created, error } = await db.from('resumes').insert(insertRow).select().single());
  }
  if (error) throw httpError(500, error.message);

  await db
    .from('resume_tailor_sessions')
    .update({ applied: true, result_version_id: (created as any)?.id ?? null })
    .eq('id', (session as any).id);

  res.status(201).json({
    resume: created,
    session: { ...session, applied: true, result_version_id: (created as any)?.id ?? null },
  });
};

/** GET /resumes/:id/ats-factors?against=:jobId — 5 factors + skill coverage. */
export const atsFactors: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const resume = await loadResumeForCaller(req.params.id, req.user);
  const text = resumeBodyText(resume);
  const against = (req.query.against as string) || '';

  let perSkill: Array<{ skill: string; score: number }> = [];
  let overall: number | null =
    typeof resume.ai_score === 'number' ? Math.round(resume.ai_score) : null;
  let target: { id: string; title: string; company_name?: string | null } | null = null;

  if (against && text) {
    const { data: job } = await db
      .from('jobs')
      .select('id, title, company_name, description, required_skills, requirements, level')
      .eq('id', against)
      .maybeSingle();
    if (job) {
      target = { id: job.id, title: job.title, company_name: job.company_name };
      const reqs = (job as any).requirements;
      const scored = await scoreResumeAgainstJob({
        resumeText: text,
        job: {
          title: job.title,
          description: job.description,
          required_skills: reqs?.required_skills ?? job.required_skills,
          min_years_of_experience: reqs?.min_years_of_experience ?? null,
          job_seniority: reqs?.job_seniority ?? (job as any).level ?? null,
        },
      });
      perSkill = scored.per_skill.map((p) => ({ skill: p.skill, score: p.score }));
      overall = Math.round(scored.overall_score);
    }
  } else if (Array.isArray(resume.ai_feedback?.per_skill)) {
    perSkill = resume.ai_feedback.per_skill.map((p: any) => ({ skill: p.skill, score: p.score }));
  }

  const factors = computeAtsFactors(text, perSkill);
  const coverage = perSkill.map((p) => ({
    skill: p.skill,
    level: p.score >= 0.75 ? 'strong' : p.score >= 0.4 ? 'gap' : 'missing',
  }));

  let scoredAgainst: any[] = [];
  try {
    const { data } = await db
      .from('resume_job_matches')
      .select(
        'job_id, ats_score, match_score, computed_at, job:jobs!job_id(id, title, company_name)',
      )
      .eq('consultant_id', resume.consultant_id)
      .order('computed_at', { ascending: false })
      .limit(12);
    scoredAgainst = (data ?? []).map((r: any) => ({
      job_id: r.job_id,
      title: r.job?.title ?? 'Job',
      company_name: r.job?.company_name ?? null,
      ats_score: r.ats_score != null ? Math.round(r.ats_score) : null,
      match_score: r.match_score != null ? Math.round(r.match_score) : null,
    }));
  } catch {
    /* resume_job_matches not present — non-fatal */
  }

  res.json({ overall, target, factors, coverage, scored_against: scoredAgainst });
};

/** GET /resumes/:id/diff?from=:vA&to=:vB — per-section diff, AI-annotated when
 *  a tailor session links the two versions. */
export const diff: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const toId = (req.query.to as string) || req.params.id;
  const fromId = (req.query.from as string) || '';
  const to = await loadResumeForCaller(toId, req.user);
  const from = fromId ? await loadResumeForCaller(fromId, req.user) : null;

  if (fromId) {
    const { data: session } = await db
      .from('resume_tailor_sessions')
      .select('id, ai_summary, score_before, score_after')
      .eq('base_version_id', fromId)
      .eq('result_version_id', toId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (session) {
      const { data: edits } = await db
        .from('resume_tailor_edits')
        .select(EDIT_COLS)
        .eq('session_id', (session as any).id)
        .order('ordinal', { ascending: true });
      res.json({
        from: versionLite(from),
        to: versionLite(to),
        summary: (session as any).ai_summary,
        score_before: (session as any).score_before,
        score_after: (session as any).score_after,
        changes: edits ?? [],
      });
      return;
    }
  }

  // Fallback: naive section-split diff (no AI annotation).
  const beforeSections = splitSections(resumeBodyText(from));
  const afterSections = splitSections(resumeBodyText(to));
  const changes: any[] = [];
  let ord = 0;
  for (const [heading, after] of afterSections) {
    const before = beforeSections.has(heading) ? beforeSections.get(heading)! : null;
    if (before !== after) {
      changes.push({
        id: `${heading}-${ord}`,
        section: heading,
        before_text: before,
        after_text: after,
        ai_reason: '',
        status: 'proposed',
        ordinal: ord++,
      });
    }
  }
  res.json({
    from: versionLite(from),
    to: versionLite(to),
    summary: '',
    score_before: from?.ai_score ?? null,
    score_after: to.ai_score ?? null,
    changes,
  });
};
