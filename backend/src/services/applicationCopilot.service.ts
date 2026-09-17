/**
 * LinkedIn Application Copilot — assembles a self-apply submission
 * (duplicate check, resume selection, cover letter, common-question answers,
 * review screen) for a CONSULTANT applying to a LinkedIn-sourced job, then
 * records the manual on-LinkedIn submit the consultant confirms themselves.
 *
 * Fully synchronous — there's no long-running server-side LinkedIn session to
 * track, so every step here is a plain request/response DB read+write, not a
 * queued job. "Detected questions" means the fixed
 * `APPLICATION_QUESTION_CATALOG`, not live DOM field detection — LinkedIn
 * exposes no API for that, so a copilot review screen IS the honest UI for
 * this feature (see shared/src/applicationQuestions.ts).
 *
 * Self-service only: every mutating function requires the caller to BE the
 * consultant on the application (never an admin/recruiter acting "on behalf
 * of" one) because a submission confirmation is a first-person attestation
 * tied to whoever is actually logged into LinkedIn. Read access (`getState`)
 * is broader — it reuses `loadAndAuthorize`, the same ownership check
 * `applications.controller.ts` uses everywhere else — so a recruiter/admin
 * can still see status, just never assemble or confirm on the consultant's
 * behalf.
 */
import { createHash } from 'node:crypto';
import { db } from '../config/db';
import { httpError, type Role } from '../types';
import {
  APPLICATION_QUESTION_CATALOG,
  findApplicationQuestion,
  type ApplicationQuestionDef,
} from '@hireorbitai/shared';
import { AI_GENERATION_AVAILABLE, generateCoverLetter } from './ai.service';
import * as linkedin from './linkedin.service';
import type { LinkedInConnectionStatus } from './linkedin.service';
import {
  getCallerConsultantRowId,
  loadAndAuthorize,
  logEvent,
} from '../controllers/applications.controller';

const TERMINAL_APPLIED_STATUSES = new Set(['SUBMITTED', 'EXTERNAL_APPLICATION']);
const BLOCKING_DUPLICATE_STATUSES_EXCLUDED = new Set(['REJECTED', 'WITHDRAWN']);

function questionHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

interface ConsultantProfileRow {
  id: string;
  user_id: string | null;
  recruiter_id: string | null;
  primary_skill: string | null;
  skills: string[] | null;
  total_experience_years: number | null;
  visa_status: string | null;
  relocation: boolean | null;
  remote_only: boolean | null;
  expected_rate: number | null;
}

interface JobRow {
  id: string;
  title: string;
  company_name: string | null;
  location: string | null;
  description: string | null;
  required_skills: string[] | null;
  requirements: { required_skills?: string[]; job_seniority?: string } | null;
  level: string | null;
  linkedin_job_url: string | null;
}

interface ApplicationRow {
  id: string;
  consultant_id: string;
  job_id: string;
  resume_id: string | null;
  recruiter_id: string | null;
  status: string;
  application_type: string | null;
  submitted_at: string | null;
  cover_letter_text: string | null;
  cover_letter_source: string | null;
}

export interface CopilotQuestionAnswer {
  key: string;
  text: string;
  inputType: ApplicationQuestionDef['inputType'];
  required: boolean;
  answer: string | null;
  source: 'user' | 'profile' | 'previous_application' | 'generated' | null;
}

export interface CopilotState {
  application: {
    id: string;
    status: string;
    applicationType: string | null;
    submittedAt: string | null;
  };
  job: { id: string; title: string; companyName: string | null; linkedinJobUrl: string | null };
  resume: { id: string; fileName: string | null } | null;
  coverLetter: { text: string | null; source: string | null };
  questions: CopilotQuestionAnswer[];
  missingRequiredKeys: string[];
  linkedin: { status: LinkedInConnectionStatus };
  alreadyApplied: boolean;
}

interface Caller {
  id: string;
  role: Role;
  group_id?: string | null;
  email?: string;
}

/** Only the consultant themselves may assemble or confirm a copilot
 *  application — see the file-level note on self-service-only mutations. */
async function requireOwnConsultantId(caller: Caller): Promise<string> {
  if (caller.role !== 'CONSULTANT') {
    throw httpError(403, 'Only the consultant can connect LinkedIn and apply through the copilot');
  }
  const consultantId = await getCallerConsultantRowId(caller.id);
  if (!consultantId) throw httpError(404, 'Consultant profile not found');
  return consultantId;
}

/** Loads an application row and 404s (not 403) unless it belongs to the
 *  caller's own consultant row — the mutating-endpoint counterpart of
 *  `loadAndAuthorize`, narrowed to self-only. */
async function loadOwnDraft(caller: Caller, applicationId: string): Promise<ApplicationRow> {
  const consultantId = await requireOwnConsultantId(caller);
  const { data, error } = await db
    .from('applications')
    .select(
      'id, consultant_id, job_id, resume_id, recruiter_id, status, application_type, submitted_at, cover_letter_text, cover_letter_source',
    )
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  const row = data as ApplicationRow | null;
  if (!row || row.consultant_id !== consultantId) throw httpError(404, 'Application not found');
  return row;
}

async function loadConsultant(consultantId: string): Promise<ConsultantProfileRow> {
  const { data, error } = await db
    .from('consultants')
    .select(
      'id, user_id, recruiter_id, primary_skill, skills, total_experience_years, visa_status, relocation, remote_only, expected_rate',
    )
    .eq('id', consultantId)
    .maybeSingle();
  if (error || !data) throw httpError(404, 'Consultant profile not found');
  return data as ConsultantProfileRow;
}

async function loadJob(jobId: string): Promise<JobRow> {
  const { data, error } = await db
    .from('jobs')
    .select(
      'id, title, company_name, location, description, required_skills, requirements, level, linkedin_job_url',
    )
    .eq('id', jobId)
    .maybeSingle();
  if (error || !data) throw httpError(404, 'Job not found');
  return data as JobRow;
}

function skillsForMatching(c: ConsultantProfileRow): string[] {
  if (Array.isArray(c.skills) && c.skills.length > 0) {
    return c.skills.map((s) => s.trim()).filter(Boolean);
  }
  if (typeof c.primary_skill === 'string' && c.primary_skill.trim()) {
    return c.primary_skill
      .split(/[,;|/]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** Only fields that map cleanly onto their question's data type are
 *  auto-filled. `visa_status` is deliberately excluded — it's free text, not
 *  a reliable source for a yes/no legal work-authorization attestation. The
 *  consultant must answer that explicitly at least once; it's then
 *  remembered via `application_answers` like any manually-entered answer. */
function deriveProfileAnswer(
  q: ApplicationQuestionDef,
  consultant: ConsultantProfileRow,
): string | null {
  switch (q.profileField) {
    case 'total_experience_years':
      return consultant.total_experience_years != null
        ? String(consultant.total_experience_years)
        : null;
    case 'relocation':
      return consultant.relocation != null ? (consultant.relocation ? 'Yes' : 'No') : null;
    case 'remote_only':
      return consultant.remote_only != null ? (consultant.remote_only ? 'Yes' : 'No') : null;
    case 'expected_rate':
      return consultant.expected_rate != null ? String(consultant.expected_rate) : null;
    default:
      return null;
  }
}

interface SavedAnswerRow {
  question_hash: string;
  answer: string;
  source: string;
}

async function assembleQuestions(
  consultant: ConsultantProfileRow,
): Promise<CopilotQuestionAnswer[]> {
  const userId = consultant.user_id;
  let saved: SavedAnswerRow[] = [];
  if (userId) {
    const { data } = await db
      .from('application_answers')
      .select('question_hash, answer, source')
      .eq('user_id', userId);
    saved = (data as SavedAnswerRow[] | null) ?? [];
  }
  const savedByHash = new Map(saved.map((r) => [r.question_hash, r]));

  return APPLICATION_QUESTION_CATALOG.map((q) => {
    const savedRow = savedByHash.get(questionHash(q.key));
    if (savedRow) {
      return {
        key: q.key,
        text: q.text,
        inputType: q.inputType,
        required: q.required,
        answer: savedRow.answer,
        source: savedRow.source as CopilotQuestionAnswer['source'],
      };
    }
    const derived = deriveProfileAnswer(q, consultant);
    return {
      key: q.key,
      text: q.text,
      inputType: q.inputType,
      required: q.required,
      answer: derived,
      source: derived != null ? 'profile' : null,
    };
  });
}

function missingRequiredKeys(questions: CopilotQuestionAnswer[]): string[] {
  return questions.filter((q) => q.required && !q.answer).map((q) => q.key);
}

async function buildState(row: ApplicationRow): Promise<CopilotState> {
  const [job, consultant] = await Promise.all([
    loadJob(row.job_id),
    loadConsultant(row.consultant_id),
  ]);
  const questions = await assembleQuestions(consultant);

  let resume: CopilotState['resume'] = null;
  if (row.resume_id) {
    const { data } = await db
      .from('resumes')
      .select('id, file_name')
      .eq('id', row.resume_id)
      .maybeSingle();
    if (data)
      resume = { id: data.id, fileName: (data as { file_name?: string }).file_name ?? null };
  }

  const linkedinStatus = consultant.user_id
    ? await linkedin.getConnectionStatus(consultant.user_id)
    : { status: 'not_connected' as const };

  return {
    application: {
      id: row.id,
      status: row.status,
      applicationType: row.application_type,
      submittedAt: row.submitted_at,
    },
    job: {
      id: job.id,
      title: job.title,
      companyName: job.company_name,
      linkedinJobUrl: job.linkedin_job_url,
    },
    resume,
    coverLetter: { text: row.cover_letter_text, source: row.cover_letter_source },
    questions,
    missingRequiredKeys: missingRequiredKeys(questions),
    linkedin: { status: linkedinStatus.status },
    alreadyApplied: TERMINAL_APPLIED_STATUSES.has(row.status),
  };
}

/** Most recent non-rejected/withdrawn application for this consultant+job,
 *  if any — the resume/duplicate-guard point. Multiple NULL vendor_ids don't
 *  collide in the DB's unique index (LinkedIn copilot rows have no vendor),
 *  so this app-level lookup IS the duplicate guard for this path. */
async function findExisting(consultantId: string, jobId: string): Promise<ApplicationRow | null> {
  const { data } = await db
    .from('applications')
    .select(
      'id, consultant_id, job_id, resume_id, recruiter_id, status, application_type, submitted_at, cover_letter_text, cover_letter_source',
    )
    .eq('consultant_id', consultantId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1);
  const row = (data as ApplicationRow[] | null)?.[0] ?? null;
  if (row && BLOCKING_DUPLICATE_STATUSES_EXCLUDED.has(row.status)) return null;
  return row;
}

/** POST /application-copilot/start — create (or resume) the draft for
 *  consultant+job. Assembly (resume pick, cover letter, question answers)
 *  only runs ONCE, on first creation — resuming an existing draft just
 *  re-reads it, so it never clobbers a user-edited cover letter or answer. */
export async function startOrResume(caller: Caller, jobId: string): Promise<CopilotState> {
  const consultantId = await requireOwnConsultantId(caller);
  const job = await loadJob(jobId);

  const existing = await findExisting(consultantId, jobId);
  if (existing) return buildState(existing);

  const consultant = await loadConsultant(consultantId);

  await logEvent({
    consultant_id: consultantId,
    job_id: jobId,
    kind: 'duplicate_check_completed',
    payload: { found: false },
    created_by: caller.id,
  });
  await logEvent({
    consultant_id: consultantId,
    job_id: jobId,
    kind: 'profile_loaded',
    created_by: caller.id,
  });

  const { data: resume } = await db
    .from('resumes')
    .select('id, file_name, body_text, ai_feedback')
    .eq('consultant_id', consultantId)
    .eq('is_current', true)
    .maybeSingle();
  const resumeRow = resume as {
    id: string;
    file_name: string | null;
    body_text: string | null;
    ai_feedback: unknown;
  } | null;
  if (resumeRow) {
    await logEvent({
      consultant_id: consultantId,
      job_id: jobId,
      kind: 'resume_selected',
      payload: { resume_id: resumeRow.id },
      created_by: caller.id,
    });
  }

  let coverLetterText: string | null = null;
  let coverLetterSource: string | null = null;
  if (AI_GENERATION_AVAILABLE) {
    const { data: user } = consultant.user_id
      ? await db.from('users').select('full_name').eq('id', consultant.user_id).maybeSingle()
      : { data: null };
    const resumeText =
      resumeRow?.body_text ||
      (resumeRow?.ai_feedback &&
      typeof resumeRow.ai_feedback === 'object' &&
      typeof (resumeRow.ai_feedback as Record<string, unknown>).resume_text === 'string'
        ? ((resumeRow.ai_feedback as Record<string, unknown>).resume_text as string)
        : null);
    try {
      const result = await generateCoverLetter({
        job: {
          title: job.title,
          company: job.company_name,
          location: job.location,
          description: job.description,
          required_skills: job.requirements?.required_skills ?? job.required_skills,
          seniority: job.requirements?.job_seniority ?? job.level ?? null,
        },
        candidate: {
          name: (user as { full_name?: string } | null)?.full_name ?? null,
          skills: skillsForMatching(consultant),
          experienceYears: consultant.total_experience_years ?? null,
        },
        resumeText,
      });
      coverLetterText = result.cover_letter;
      coverLetterSource = 'ai_generated';
    } catch {
      // Cover letter generation is best-effort — the consultant can still
      // write their own on the review screen. Never block the draft on it.
    }
  }
  if (coverLetterText) {
    await logEvent({
      consultant_id: consultantId,
      job_id: jobId,
      kind: 'cover_letter_ready',
      payload: { source: coverLetterSource },
      created_by: caller.id,
    });
  }

  const questions = await assembleQuestions(consultant);
  const missing = missingRequiredKeys(questions);
  await logEvent({
    consultant_id: consultantId,
    job_id: jobId,
    kind: 'questions_answered',
    payload: { missing },
    created_by: caller.id,
  });

  const status = missing.length > 0 ? 'NEEDS_USER_ACTION' : 'READY_FOR_REVIEW';
  const { data: inserted, error } = await db
    .from('applications')
    .insert({
      consultant_id: consultantId,
      job_id: jobId,
      resume_id: resumeRow?.id ?? null,
      recruiter_id: consultant.recruiter_id ?? null,
      status,
      application_type: 'linkedin_copilot',
      submitted_at: null,
      cover_letter_text: coverLetterText,
      cover_letter_source: coverLetterSource,
    })
    .select(
      'id, consultant_id, job_id, resume_id, recruiter_id, status, application_type, submitted_at, cover_letter_text, cover_letter_source',
    )
    .single();
  if (error) throw httpError(500, `Database error: ${error.message}`);
  const row = inserted as ApplicationRow;

  await logEvent({
    application_id: row.id,
    consultant_id: consultantId,
    job_id: jobId,
    kind: status === 'READY_FOR_REVIEW' ? 'ready_for_review' : 'needs_user_action',
    created_by: caller.id,
  });

  return buildState(row);
}

/** GET /application-copilot/:id — broader read access via `loadAndAuthorize`
 *  (admin/group-lead/recruiter/consultant-self), unlike the mutating
 *  endpoints below which are self-only. */
export async function getState(caller: Caller, applicationId: string): Promise<CopilotState> {
  const owned = await loadAndAuthorize(caller, applicationId);
  const { data, error } = await db
    .from('applications')
    .select(
      'id, consultant_id, job_id, resume_id, recruiter_id, status, application_type, submitted_at, cover_letter_text, cover_letter_source',
    )
    .eq('id', owned.id)
    .single();
  if (error || !data) throw httpError(404, 'Application not found');
  return buildState(data as ApplicationRow);
}

export async function updateAnswers(
  caller: Caller,
  applicationId: string,
  answers: { key: string; value: string }[],
): Promise<CopilotState> {
  const row = await loadOwnDraft(caller, applicationId);
  if (TERMINAL_APPLIED_STATUSES.has(row.status)) {
    throw httpError(409, 'This application has already been submitted');
  }
  const consultant = await loadConsultant(row.consultant_id);
  if (!consultant.user_id) throw httpError(400, 'Consultant has no linked user account');

  for (const { key, value } of answers) {
    const def = findApplicationQuestion(key);
    if (!def) throw httpError(400, `Unknown question key: ${key}`);
    const { error } = await db.from('application_answers').upsert(
      {
        user_id: consultant.user_id,
        question_hash: questionHash(key),
        question_text: def.text,
        answer: value,
        source: 'user',
      },
      { onConflict: 'user_id,question_hash' },
    );
    if (error) throw httpError(500, 'Failed to save answer');
  }

  const questions = await assembleQuestions(consultant);
  const missing = missingRequiredKeys(questions);
  const nextStatus = missing.length > 0 ? 'NEEDS_USER_ACTION' : 'READY_FOR_REVIEW';

  const { data: updated, error: updateErr } = await db
    .from('applications')
    .update({ status: nextStatus })
    .eq('id', row.id)
    .select(
      'id, consultant_id, job_id, resume_id, recruiter_id, status, application_type, submitted_at, cover_letter_text, cover_letter_source',
    )
    .single();
  if (updateErr) throw httpError(500, 'Database error');

  await logEvent({
    application_id: row.id,
    consultant_id: row.consultant_id,
    job_id: row.job_id,
    kind: 'questions_answered',
    payload: { missing },
    created_by: caller.id,
  });

  return buildState(updated as ApplicationRow);
}

export async function updateCoverLetter(
  caller: Caller,
  applicationId: string,
  text: string,
): Promise<CopilotState> {
  const row = await loadOwnDraft(caller, applicationId);
  if (TERMINAL_APPLIED_STATUSES.has(row.status)) {
    throw httpError(409, 'This application has already been submitted');
  }
  const { data: updated, error } = await db
    .from('applications')
    .update({ cover_letter_text: text, cover_letter_source: 'user_edited' })
    .eq('id', row.id)
    .select(
      'id, consultant_id, job_id, resume_id, recruiter_id, status, application_type, submitted_at, cover_letter_text, cover_letter_source',
    )
    .single();
  if (error) throw httpError(500, 'Database error');

  await logEvent({
    application_id: row.id,
    consultant_id: row.consultant_id,
    job_id: row.job_id,
    kind: 'cover_letter_ready',
    payload: { source: 'user_edited' },
    created_by: caller.id,
  });

  return buildState(updated as ApplicationRow);
}

/** POST /application-copilot/:id/confirm — the consultant has clicked Submit
 *  on LinkedIn's own site and is confirming it here. Never marks SUBMITTED
 *  without this explicit call — there is no way for the backend to observe
 *  a LinkedIn submission itself, so fabricating success is not an option. */
export async function confirmSubmission(
  caller: Caller,
  applicationId: string,
): Promise<CopilotState> {
  const row = await loadOwnDraft(caller, applicationId);
  if (TERMINAL_APPLIED_STATUSES.has(row.status)) {
    throw httpError(409, 'This application has already been submitted');
  }
  const consultant = await loadConsultant(row.consultant_id);
  const questions = await assembleQuestions(consultant);
  const missing = missingRequiredKeys(questions);
  if (missing.length > 0) {
    throw httpError(409, 'Answer the required questions before confirming', { missing });
  }

  if (consultant.user_id) {
    const connected = await linkedin.verifyConnection(consultant.user_id);
    if (!connected) {
      await db.from('applications').update({ status: 'NEEDS_USER_ACTION' }).eq('id', row.id);
      await logEvent({
        application_id: row.id,
        consultant_id: row.consultant_id,
        job_id: row.job_id,
        kind: 'linkedin_reauthorization_required',
        created_by: caller.id,
      });
      throw httpError(409, 'Your LinkedIn connection needs to be reconnected before confirming');
    }
  }

  // Transient SUBMITTING write before the terminal SUBMITTED write — if the
  // process dies between them, the row is visibly "stuck submitting"
  // (prompting a retry) rather than silently reverting to looking untouched.
  await db.from('applications').update({ status: 'SUBMITTING' }).eq('id', row.id);
  const { data: updated, error } = await db
    .from('applications')
    .update({
      status: 'SUBMITTED',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .select(
      'id, consultant_id, job_id, resume_id, recruiter_id, status, application_type, submitted_at, cover_letter_text, cover_letter_source',
    )
    .single();
  if (error) throw httpError(500, 'Database error');

  await logEvent({
    application_id: row.id,
    consultant_id: row.consultant_id,
    job_id: row.job_id,
    kind: 'submission_confirmed',
    created_by: caller.id,
  });

  return buildState(updated as ApplicationRow);
}

/** POST /application-copilot/log-external — lightweight "I already applied on
 *  LinkedIn directly" quick-log that skips the wizard entirely. */
export async function logExternalApplication(
  caller: Caller,
  jobId: string,
): Promise<{ applicationId: string }> {
  const consultantId = await requireOwnConsultantId(caller);
  await loadJob(jobId);

  const existing = await findExisting(consultantId, jobId);
  if (existing) throw httpError(409, 'You already have an application on record for this job');

  const consultant = await loadConsultant(consultantId);
  const { data: inserted, error } = await db
    .from('applications')
    .insert({
      consultant_id: consultantId,
      job_id: jobId,
      recruiter_id: consultant.recruiter_id ?? null,
      status: 'EXTERNAL_APPLICATION',
      application_type: 'linkedin_external',
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw httpError(500, `Database error: ${error.message}`);
  const applicationId = (inserted as { id: string }).id;

  await logEvent({
    application_id: applicationId,
    consultant_id: consultantId,
    job_id: jobId,
    kind: 'external_application_detected',
    created_by: caller.id,
  });

  return { applicationId };
}
