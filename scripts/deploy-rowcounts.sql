-- Pre/post-deploy row-count snapshot for the important tables.
-- Run BEFORE the promote and AGAIN after migrations to confirm nothing was lost.
--
--   set -a; source ~/hireorbitai/backend/.env; set +a
--   psql "$DATABASE_URL" -f ~/hireorbitai/scripts/deploy-rowcounts.sql
--
-- Read-only. Counts must be >= the pre-deploy snapshot for every user-data table
-- (a deploy adds columns/tables; it must never reduce these counts).

SELECT 'users'               AS table_name, count(*) AS rows FROM public.users
UNION ALL SELECT 'users_active',        count(*) FROM public.users WHERE is_active IS NOT FALSE
UNION ALL SELECT 'users_super_admin',   count(*) FROM public.users WHERE role = 'SUPER_ADMIN' AND is_active IS NOT FALSE
UNION ALL SELECT 'user_groups',         count(*) FROM public.user_groups
UNION ALL SELECT 'invitations',         count(*) FROM public.invitations
UNION ALL SELECT 'consultants',         count(*) FROM public.consultants
UNION ALL SELECT 'recruiters',          count(*) FROM public.recruiters
UNION ALL SELECT 'recruiter_managers',  count(*) FROM public.recruiter_managers
UNION ALL SELECT 'resumes',             count(*) FROM public.resumes
UNION ALL SELECT 'jobs',                count(*) FROM public.jobs
UNION ALL SELECT 'applications',        count(*) FROM public.applications
UNION ALL SELECT 'interviews',          count(*) FROM public.interviews
UNION ALL SELECT 'messages',            count(*) FROM public.messages
UNION ALL SELECT 'feature_flags',       count(*) FROM public.feature_flags
UNION ALL SELECT 'training_courses',    count(*) FROM public.training_courses
UNION ALL SELECT 'training_assignments',count(*) FROM public.training_assignments
ORDER BY table_name;
