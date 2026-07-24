-- Phase 4 of the messaging-permission overhaul.
--
-- Unified view of user-to-user relationships across the four canonical
-- source tables. Lets ops + future denormalization read "who can reach
-- whom" from a single shape instead of UNIONing the same patterns at
-- every call site.
--
-- Sources:
--   1. users.reports_to              — generic org chain (any role → any role)
--   2. recruiter_managers (junction) — recruiter ↔ manager many-to-many
--   3. recruiters.manager_id         — legacy single-manager column (still
--                                       populated on rows pre-migration)
--   4. consultants.recruiter_id      — consultant → recruiter (single)
--
-- Symmetric: every relationship is emitted in BOTH directions (e.g. one
-- consultant.recruiter_id row generates both
--   (consultant_user_id, recruiter_user_id, 'RECRUITED_BY') and
--   (recruiter_user_id,  consultant_user_id, 'RECRUITS')
-- ) so a single point-lookup answers the question without an OR.
--
-- For now this is a plain SELECT-from-view — the underlying tables are
-- already individually indexed on the FK columns the view consults
-- (users_reports_to_idx, recruiter_managers_recruiter_idx, etc.), so a
-- targeted `WHERE user_id = ?` lookup against the view is O(log n) per
-- branch.
--
-- If/when we outgrow the view (concurrent index pressure, materialized-
-- view refresh latency, etc.) the next step is a real denormalized
-- public.user_relationships table maintained by triggers on each source.
-- For today's load the view is plenty.

CREATE OR REPLACE VIEW public.v_user_relationships AS
  -- (1) reports_to: user → their direct manager
  SELECT u.id                          AS user_id,
         u.reports_to                  AS related_user_id,
         'REPORTS_TO'::text            AS relationship_type
    FROM public.users u
   WHERE u.reports_to IS NOT NULL
  UNION ALL
  -- (1') reverse: manager → their direct report
  SELECT u.reports_to                  AS user_id,
         u.id                          AS related_user_id,
         'MANAGES'::text               AS relationship_type
    FROM public.users u
   WHERE u.reports_to IS NOT NULL
  UNION ALL
  -- (2) recruiter_managers junction: recruiter → manager
  SELECT r.user_id                     AS user_id,
         rm.manager_id                 AS related_user_id,
         'REPORTS_TO_VIA_RECRUITER'::text AS relationship_type
    FROM public.recruiter_managers rm
    JOIN public.recruiters r ON r.id = rm.recruiter_id
   WHERE r.user_id IS NOT NULL
  UNION ALL
  -- (2') reverse: manager → recruiter under their wing
  SELECT rm.manager_id                 AS user_id,
         r.user_id                     AS related_user_id,
         'MANAGES_RECRUITER'::text     AS relationship_type
    FROM public.recruiter_managers rm
    JOIN public.recruiters r ON r.id = rm.recruiter_id
   WHERE r.user_id IS NOT NULL
  UNION ALL
  -- (3) legacy recruiters.manager_id (still consulted for back-compat
  -- with rows pre-recruiter_managers-migration).
  SELECT r.user_id                     AS user_id,
         r.manager_id                  AS related_user_id,
         'REPORTS_TO_VIA_RECRUITER'::text AS relationship_type
    FROM public.recruiters r
   WHERE r.user_id IS NOT NULL AND r.manager_id IS NOT NULL
  UNION ALL
  SELECT r.manager_id                  AS user_id,
         r.user_id                     AS related_user_id,
         'MANAGES_RECRUITER'::text     AS relationship_type
    FROM public.recruiters r
   WHERE r.user_id IS NOT NULL AND r.manager_id IS NOT NULL
  UNION ALL
  -- (4) consultants.recruiter_id: consultant → recruiter
  SELECT c.user_id                     AS user_id,
         r.user_id                     AS related_user_id,
         'RECRUITED_BY'::text          AS relationship_type
    FROM public.consultants c
    JOIN public.recruiters r ON r.id = c.recruiter_id
   WHERE c.user_id IS NOT NULL AND r.user_id IS NOT NULL
  UNION ALL
  -- (4') reverse: recruiter → consultant
  SELECT r.user_id                     AS user_id,
         c.user_id                     AS related_user_id,
         'RECRUITS'::text              AS relationship_type
    FROM public.consultants c
    JOIN public.recruiters r ON r.id = c.recruiter_id
   WHERE c.user_id IS NOT NULL AND r.user_id IS NOT NULL;

COMMENT ON VIEW public.v_user_relationships IS
  'Unified user→user relationship view. Read-only. Sources: users.reports_to, recruiter_managers, recruiters.manager_id, consultants.recruiter_id. Symmetric (both directions emitted). Phase 4 of messaging-permission overhaul.';

NOTIFY pgrst, 'reload schema';
