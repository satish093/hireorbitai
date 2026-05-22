// Shared types for the resume tailoring workspace. Each resume row IS a version
// (the backend has no separate resume_versions table), so ResumeVersion mirrors
// a row of public.resumes.

export type CenterMode = 'preview' | 'diff' | 'edit';

export type EditStatus = 'proposed' | 'accepted' | 'rejected' | 'edited';

export interface ResumeVersion {
  id: string;
  consultant_id: string;
  version: number;
  file_name: string;
  ai_score: number | null;
  is_current: boolean;
  created_at: string;
  tailored_for_job_id?: string | null;
  tailor_metadata?: {
    before_score?: number;
    after_score?: number;
    changes_summary?: string[];
  } | null;
}

export interface JobLite {
  id: string;
  title: string;
  company_name?: string | null;
}

export interface TailorEdit {
  id: string;
  section: string;
  before_text: string | null;
  after_text: string;
  ai_reason: string;
  status: EditStatus;
  ordinal: number;
}

export interface TailorSession {
  id: string;
  base_version_id: string;
  result_version_id: string | null;
  job_id: string | null;
  applied: boolean;
  ai_summary: string;
  score_before: number;
  score_after: number | null;
  edit_count: number;
  created_at: string;
  job?: JobLite | null;
  edits?: TailorEdit[];
}

export interface AtsFactor {
  key: string;
  label: string;
  score: number;
  hint: string;
}

export interface SkillCoverage {
  skill: string;
  level: 'strong' | 'gap' | 'missing';
}

export interface ScoredAgainst {
  job_id: string;
  title: string;
  company_name: string | null;
  ats_score: number | null;
  match_score: number | null;
}

export interface AtsFactorsResponse {
  overall: number | null;
  target: JobLite | null;
  factors: AtsFactor[];
  coverage: SkillCoverage[];
  scored_against: ScoredAgainst[];
}

export interface DiffResponse {
  from: { id: string; version: number; file_name: string; ai_score: number | null } | null;
  to: { id: string; version: number; file_name: string; ai_score: number | null } | null;
  summary: string;
  score_before: number | null;
  score_after: number | null;
  changes: TailorEdit[];
}

/** Score → tone bucket used by the ATS bars and donut across the workspace. */
export function scoreTone(score: number | null | undefined): 'success' | 'warn' | 'danger' {
  if (score == null) return 'warn';
  if (score >= 80) return 'success';
  if (score >= 60) return 'warn';
  return 'danger';
}
