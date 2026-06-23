-- Heal recruiters promoted via a role change before recruiters rows were
-- auto-created (admin changed someone's role to RECRUITER, but the Recruiters
-- directory is built from the recruiters table, so they never appeared there).
-- Give every active RECRUITER-role user a recruiters row.
--
-- Idempotent: the NOT EXISTS guard + the user_id unique constraint make re-runs
-- safe; defaults fill the rest of the row (target_submissions_per_week=10,
-- marketing_status='ACTIVE').

insert into public.recruiters (user_id)
select u.id
from public.users u
where u.role = 'RECRUITER'
  and coalesce(u.is_active, true) = true
  and not exists (select 1 from public.recruiters r where r.user_id = u.id)
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
