-- Post-deploy data-integrity verification. Run AFTER migrations on prod:
--
--   set -a; source ~/hireorbitai/backend/.env; set +a
--   psql "$DATABASE_URL" -f ~/hireorbitai/scripts/postdeploy-verify.sql
--
-- Every row with status 'FAIL' is a blocker — investigate before declaring the
-- deploy healthy. 'info' rows are for eyeballing (e.g. per-role counts). This is
-- read-only.

-- ── Presence: active users, a super-admin, and feature flags survived ────────
SELECT 'active_users_present' AS check, count(*) AS n,
       CASE WHEN count(*) >= 1 THEN 'pass' ELSE 'FAIL' END AS status
  FROM public.users WHERE is_active IS NOT FALSE
UNION ALL
SELECT 'active_super_admin_present', count(*),
       CASE WHEN count(*) >= 1 THEN 'pass' ELSE 'FAIL' END
  FROM public.users WHERE role = 'SUPER_ADMIN' AND is_active IS NOT FALSE
UNION ALL
SELECT 'feature_flags_present', count(*),
       CASE WHEN count(*) >= 1 THEN 'pass' ELSE 'FAIL' END
  FROM public.feature_flags

-- ── Linkage integrity: no orphaned rows after the deploy ─────────────────────
UNION ALL
SELECT 'orphan_applications_consultant', count(*),
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END
  FROM public.applications a
  LEFT JOIN public.consultants c ON c.id = a.consultant_id
 WHERE a.consultant_id IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'orphan_applications_recruiter', count(*),
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END
  FROM public.applications a
  LEFT JOIN public.recruiters r ON r.id = a.recruiter_id
 WHERE a.recruiter_id IS NOT NULL AND r.id IS NULL
UNION ALL
SELECT 'orphan_resumes_consultant', count(*),
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END
  FROM public.resumes rs
  LEFT JOIN public.consultants c ON c.id = rs.consultant_id
 WHERE rs.consultant_id IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'orphan_consultants_recruiter', count(*),
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END
  FROM public.consultants c
  LEFT JOIN public.recruiters r ON r.id = c.recruiter_id
 WHERE c.recruiter_id IS NOT NULL AND r.id IS NULL
UNION ALL
SELECT 'orphan_consultants_user', count(*),
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END
  FROM public.consultants c
  LEFT JOIN public.users u ON u.id = c.user_id
 WHERE c.user_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'orphan_recruiters_user', count(*),
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END
  FROM public.recruiters r
  LEFT JOIN public.users u ON u.id = r.user_id
 WHERE r.user_id IS NOT NULL AND u.id IS NULL

-- ── New additive column applied (developer capabilities) ─────────────────────
UNION ALL
SELECT 'capabilities_column_exists', count(*),
       CASE WHEN count(*) = 1 THEN 'pass' ELSE 'FAIL' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'capabilities'

-- ── Info: per-role headcount (eyeball vs the pre-deploy snapshot) ────────────
UNION ALL
SELECT 'role_' || role, count(*), 'info'
  FROM public.users GROUP BY role

ORDER BY status DESC, check;
