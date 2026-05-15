-- HireOrbit AI — adds DEVELOPER + HR_MANAGER to the user_role enum.
-- Both are manager-tier internally: full org visibility + can manage day-to-day
-- operations, but NOT feature flags or other owner-only actions.
-- Idempotent: safe to re-run.

alter type user_role add value if not exists 'DEVELOPER';
alter type user_role add value if not exists 'HR_MANAGER';
