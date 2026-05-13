-- TalentBridge AI — extended user profile fields.
--
-- Adds first/last name and address fields on the shared users table so that
-- recruiters, managers, and directors can view full contact details for any
-- user (recruiter, consultant, manager, director) in a single profile page.
--
-- Idempotent: safe to re-run.

alter table public.users
  add column if not exists first_name     text,
  add column if not exists last_name      text,
  add column if not exists address_line1  text,
  add column if not exists address_line2  text,
  add column if not exists city           text,
  add column if not exists state          text,
  add column if not exists postal_code    text,
  add column if not exists country        text,
  add column if not exists timezone       text,
  add column if not exists linkedin_url   text;

-- Best-effort backfill: split existing full_name into first/last parts when
-- first_name is null. Safe to re-run — only touches rows still missing data.
update public.users
   set first_name = trim(split_part(full_name, ' ', 1)),
       last_name  = case
                      when position(' ' in full_name) > 0
                        then trim(substring(full_name from position(' ' in full_name) + 1))
                      else null
                    end
 where full_name is not null
   and first_name is null;

notify pgrst, 'reload schema';
