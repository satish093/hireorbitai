import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { uploadResumeFile, getResumeSignedUrl } from '../services/storage.service';
import {
  scoreResume,
  tailorResumeForJob,
  scoreResumeAgainstJob,
  atsScore,
  extractJobRequirements,
} from '../services/ai.service';
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

/** List resume versions for a consultant. */
export const listForConsultant: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await authorizeConsultantAccess(req.params.consultantId, req.user);
  const { data, error } = await db
    .from('resumes')
    .select('*')
    .eq('consultant_id', req.params.consultantId)
    .order('version', { ascending: false });
  if (error) throw httpError(500, error.message);
  res.json(data);
};

/**
 * Upload a new resume version. multipart/form-data: { file, consultant_id, text? }
 * If `text` is provided we run AI scoring server-side. Otherwise the client can
 * call /resumes/:id/score later.
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
  const rawText = req.body?.text ? String(req.body.text) : '';
  if (rawText) {
    try {
      const result = await scoreResume(rawText);
      aiScore = result.score;
      aiFeedback = result;
    } catch (e) {
      // Non-fatal — resume is still saved; client can retry scoring.
      // eslint-disable-next-line no-console
      console.warn('Resume AI scoring failed:', e);
    }
    // Keep the raw text on ai_feedback so /jobs/:id/skill-match-for-me can
    // score against this resume later without the client having to re-paste.
    aiFeedback = { ...(aiFeedback ?? {}), resume_text: rawText };
  }

  // Flip is_current off for prior versions, on for this one.
  await db.from('resumes').update({ is_current: false }).eq('consultant_id', consultant_id);

  const { data, error } = await db
    .from('resumes')
    .insert({
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
    })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
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
