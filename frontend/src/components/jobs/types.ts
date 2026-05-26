export type TabKey = 'recommended' | 'liked' | 'applied';

/** Applications pipeline (mirrors the database enum). */
export type AppStatus =
  | 'SUBMITTED'
  | 'SCREENING'
  | 'INTERVIEW'
  | 'OFFER'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'ARCHIVED';

export type AppliedSubTab = 'applied' | 'interviewing' | 'offer' | 'rejected' | 'archived';

export const APPLIED_SUB_TABS: { key: AppliedSubTab; label: string; statuses: AppStatus[] }[] = [
  { key: 'applied', label: 'Applied', statuses: ['SUBMITTED', 'SCREENING'] },
  { key: 'interviewing', label: 'Interviewing', statuses: ['INTERVIEW'] },
  { key: 'offer', label: 'Offer Received', statuses: ['OFFER'] },
  { key: 'rejected', label: 'Rejected', statuses: ['REJECTED'] },
  { key: 'archived', label: 'Archived', statuses: ['ARCHIVED', 'WITHDRAWN'] },
];

/** Human-friendly labels for the status dropdown on each card. */
export const STATUS_LABEL: Record<AppStatus, string> = {
  SUBMITTED: 'Applied',
  SCREENING: 'Applied',
  INTERVIEW: 'Interviewing',
  OFFER: 'Offer Received',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Archived',
  ARCHIVED: 'Archived',
};

export function matchSubTab(status: string | undefined): AppliedSubTab {
  if (!status) return 'applied';
  for (const t of APPLIED_SUB_TABS) {
    if ((t.statuses as string[]).includes(status)) return t.key;
  }
  return 'applied';
}

export interface JobRow {
  id: string;
  title: string;
  location?: string | null;
  remote?: boolean;
  job_type?: string | null;
  level?: string | null;
  rate_min?: number | null;
  rate_max?: number | null;
  description?: string | null;
  required_skills?: string[] | null;
  posted_at?: string | null;
  created_at: string;
  is_active?: boolean;
  client?: { id: string; company_name: string } | null;
  vendor?: { id: string; company_name: string } | null;
  liked?: boolean;
  match_score?: number | null;
  match_reasons?: string[];
  application_id?: string;
  application_status?: AppStatus | string;
  applied_at?: string;
  applied_method?: 'CUSTOMIZED' | 'ORIGINAL' | null;
  ats_score?: number | null;
  // Live ingestion fields
  source?: 'remoteok' | 'greenhouse' | 'lever' | 'adzuna' | null;
  external_id?: string | null;
  apply_url?: string | null;
  company_name?: string | null;
  publisher?: string | null;
  last_synced_at?: string | null;
  requirements?: {
    // Hard match signals
    must_haves?: string[];
    nice_to_haves?: string[];
    required_skills?: string[];
    min_years_of_experience?: number | null;
    job_seniority?: string | null;
    work_model?: string | null;
    work_authorization?: string[];
    location_requirements?: string | null;
    // Human-readable bullets
    core_responsibilities?: string[];
    skill_summaries?: string[];
    benefits_summaries?: string[];
    education_summaries?: string[];
    // Display chips
    highlights?: string[];
    recommendation_tags?: string[];
    // Legacy fields (back-compat)
    years_required?: number | null;
    level?: string | null;
  } | null;
}

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'liked', label: 'Saved' },
  { key: 'applied', label: 'Applied' },
];

export type ApplyTarget = {
  consultantId: string;
  consultantName: string;
  resumeId: string | null;
  skills: string[];
};

export interface ConsultantOption {
  id: string;
  user_id: string;
  primary_skill?: string | null;
  skills?: string[] | null;
  user?: { id: string; full_name: string | null; email: string } | null;
}

export interface ResumeOption {
  id: string;
  version: number;
  file_name: string;
  is_current: boolean;
  ai_score?: number | null;
  parsed_profile?: { skills?: string[] | null } | null;
}

export interface SourceCompany {
  id: string;
  source: 'remoteok' | 'greenhouse' | 'lever' | 'adzuna' | 'remotive' | 'arbeitnow';
  slug: string | null;
  display_name: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_jobs_count: number | null;
  last_sync_error: string | null;
}

export interface SourceHealth {
  source: string;
  key_configured: boolean;
  needs_key: boolean;
  needs_slug: boolean;
  rows_total: number;
  rows_active: number;
  last_synced_at: string | null;
  last_sync_jobs_count: number;
  last_error: string | null;
  status: 'ok' | 'error' | 'missing_key' | 'no_rows';
}
