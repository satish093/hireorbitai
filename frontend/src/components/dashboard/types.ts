// Shared shapes for the recruiter command-center dashboard. Backend rows are
// loose (the API returns `any`-ish JSON), so these describe only the fields the
// dashboard reads, all optional/defensive.

export interface DashConsultant {
  id: string;
  primary_skill?: string | null;
  marketing_status?: string | null;
  updated_at?: string | null;
  user?: {
    id?: string;
    full_name?: string | null;
    email?: string | null;
    last_seen_at?: string | null;
  } | null;
}

export interface DashApplication {
  id: string;
  consultant_id?: string | null;
  status?: string | null;
  match_score?: number | null;
  submitted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  job?: { id?: string; title?: string | null } | null;
  consultant?: { id?: string; user?: { full_name?: string | null } | null } | null;
}

/** 6-stage recruiting funnel, in order. */
export const PIPELINE_STAGES = [
  'Sourced',
  'Submitted',
  'Screening',
  'Interview',
  'Offer',
  'Placed',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Map an application status to a funnel stage. */
export function stageForStatus(status: string | null | undefined): PipelineStage | null {
  switch (status) {
    case 'SUBMITTED':
      return 'Submitted';
    case 'SCREENING':
      return 'Screening';
    case 'INTERVIEW':
      return 'Interview';
    case 'OFFER':
      return 'Offer';
    case 'PLACED':
    case 'ACCEPTED':
      return 'Placed';
    default:
      return null;
  }
}

export interface ActivityEvent {
  id: string;
  ts: string;
  actor: { name: string; avatar?: string } | 'system';
  verb:
    | 'submitted'
    | 'scored'
    | 'received'
    | 'commented'
    | 'archived'
    | 'updated'
    | 'reached'
    | 'synced';
  object: { label: string; href?: string };
  context?: { label: string; href?: string };
  tone: 'success' | 'danger' | 'warning' | 'accent' | 'neutral';
  icon: 'send' | 'star' | 'sparkles' | 'inbox' | 'trash' | 'doc' | 'video' | 'download';
}
