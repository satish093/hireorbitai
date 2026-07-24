-- Mirror of backend/migrations/1700000000005_v_user_relationships.sql for
-- the fresh-install path (database/init.sql via build-init-sql.mjs).
-- See the migration file for the design notes.

CREATE OR REPLACE VIEW public.v_user_relationships AS
  SELECT u.id AS user_id, u.reports_to AS related_user_id, 'REPORTS_TO'::text AS relationship_type
    FROM public.users u WHERE u.reports_to IS NOT NULL
  UNION ALL
  SELECT u.reports_to AS user_id, u.id AS related_user_id, 'MANAGES'::text AS relationship_type
    FROM public.users u WHERE u.reports_to IS NOT NULL
  UNION ALL
  SELECT r.user_id, rm.manager_id, 'REPORTS_TO_VIA_RECRUITER'::text
    FROM public.recruiter_managers rm JOIN public.recruiters r ON r.id = rm.recruiter_id
   WHERE r.user_id IS NOT NULL
  UNION ALL
  SELECT rm.manager_id, r.user_id, 'MANAGES_RECRUITER'::text
    FROM public.recruiter_managers rm JOIN public.recruiters r ON r.id = rm.recruiter_id
   WHERE r.user_id IS NOT NULL
  UNION ALL
  SELECT r.user_id, r.manager_id, 'REPORTS_TO_VIA_RECRUITER'::text
    FROM public.recruiters r WHERE r.user_id IS NOT NULL AND r.manager_id IS NOT NULL
  UNION ALL
  SELECT r.manager_id, r.user_id, 'MANAGES_RECRUITER'::text
    FROM public.recruiters r WHERE r.user_id IS NOT NULL AND r.manager_id IS NOT NULL
  UNION ALL
  SELECT c.user_id, r.user_id, 'RECRUITED_BY'::text
    FROM public.consultants c JOIN public.recruiters r ON r.id = c.recruiter_id
   WHERE c.user_id IS NOT NULL AND r.user_id IS NOT NULL
  UNION ALL
  SELECT r.user_id, c.user_id, 'RECRUITS'::text
    FROM public.consultants c JOIN public.recruiters r ON r.id = c.recruiter_id
   WHERE c.user_id IS NOT NULL AND r.user_id IS NOT NULL;

COMMENT ON VIEW public.v_user_relationships IS
  'Unified user→user relationship view. Read-only. Sources: users.reports_to, recruiter_managers, recruiters.manager_id, consultants.recruiter_id. Symmetric.';

NOTIFY pgrst, 'reload schema';
