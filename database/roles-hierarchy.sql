-- TalentBridge AI — extended role hierarchy
-- Adds CEO / CTO / DIRECTOR to the user_role enum + a generic reports_to
-- pointer on users so org chains beyond the recruiter→manager link are
-- representable.
-- Idempotent: safe to re-run.

-- ALTER TYPE ... ADD VALUE IF NOT EXISTS works on Postgres 9.6+.
alter type user_role add value if not exists 'CEO';
alter type user_role add value if not exists 'CTO';
alter type user_role add value if not exists 'DIRECTOR';

-- Generic "reports to" so the leadership chain can be modeled without bolting
-- onto recruiters.manager_id. Self-referential.
alter table public.users add column if not exists reports_to uuid
  references public.users(id) on delete set null;
create index if not exists users_reports_to_idx on public.users (reports_to);
