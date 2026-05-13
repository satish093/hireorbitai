-- TalentBridge AI — backfill empty apply_url values to a Google-for-jobs
-- search so the "Apply on company site" button never opens an empty tab.
-- Existing rows where apply_url is null/empty get a query built from title +
-- company_name. New ingests already use the same fallback in code.
--
-- Idempotent: safe to re-run.

update public.jobs
   set apply_url = 'https://www.google.com/search?ibp=htl;jobs&q='
     || replace(replace(coalesce(title, '') || ' ' || coalesce(company_name, ''), ' ', '+'), '&', '%26')
 where apply_url is null
    or btrim(apply_url) = '';
