-- Backfill consultants.skills from each consultant's CURRENT resume's
-- parsed_profile->'skills'.
--
-- The job-match engine reads consultants.skills, but parsed resume skills only
-- ever landed on resumes.parsed_profile — so every consultant had an empty
-- skills[] and the deterministic skill-overlap match scored 0. The upload /
-- parse-profile code now keeps consultants.skills in sync going forward; this
-- one-time backfill fills consultants who uploaded BEFORE that fix.
--
-- Only fills EMPTY skill lists, so manually-curated skills are never clobbered.
-- Idempotent: re-running is a no-op once skills are populated.

update public.consultants c
set skills = sub.skills
from (
  select
    r.consultant_id,
    array(select jsonb_array_elements_text(r.parsed_profile -> 'skills')) as skills
  from public.resumes r
  where r.is_current = true
    and r.parsed_profile ? 'skills'
    and jsonb_typeof(r.parsed_profile -> 'skills') = 'array'
) sub
where c.id = sub.consultant_id
  and array_length(sub.skills, 1) > 0
  and (c.skills is null or cardinality(c.skills) = 0);

notify pgrst, 'reload schema';
