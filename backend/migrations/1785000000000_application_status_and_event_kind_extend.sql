-- Extend application_status and application_event_kind for the LinkedIn
-- Application Copilot's wizard steps.
--
-- READY_FOR_REVIEW / NEEDS_USER_ACTION / SUBMITTING / EXTERNAL_APPLICATION
-- join the existing SUBMITTED/SCREENING/INTERVIEW/OFFER/REJECTED/WITHDRAWN.
-- SUBMITTED remains the single "counted as applied" terminal state for both
-- the guided copilot and the staffing flow; application_type (see
-- applications_copilot_columns migration) distinguishes how it got there.
--
-- This file is additive-only (ALTER TYPE ... ADD VALUE, nothing else) and
-- must stay that way: Postgres does not allow a newly-added enum value to be
-- referenced by DML in the same transaction it was added in.
--
-- Idempotent: `add value if not exists` (Postgres 12+) no-ops on a re-run.

alter type application_status add value if not exists 'READY_FOR_REVIEW';
alter type application_status add value if not exists 'NEEDS_USER_ACTION';
alter type application_status add value if not exists 'SUBMITTING';
alter type application_status add value if not exists 'EXTERNAL_APPLICATION';

alter type application_event_kind add value if not exists 'linkedin_connected';
alter type application_event_kind add value if not exists 'linkedin_disconnected';
alter type application_event_kind add value if not exists 'linkedin_reauthorization_required';
alter type application_event_kind add value if not exists 'duplicate_check_completed';
alter type application_event_kind add value if not exists 'profile_loaded';
alter type application_event_kind add value if not exists 'resume_selected';
alter type application_event_kind add value if not exists 'cover_letter_ready';
alter type application_event_kind add value if not exists 'questions_answered';
alter type application_event_kind add value if not exists 'ready_for_review';
alter type application_event_kind add value if not exists 'submission_confirmed';
alter type application_event_kind add value if not exists 'needs_user_action';
alter type application_event_kind add value if not exists 'user_action_completed';
alter type application_event_kind add value if not exists 'external_application_detected';
