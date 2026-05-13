-- TalentBridge AI — add ARCHIVED to the application_status enum so the
-- Applied tab can have an Archived sub-tab matching Jobright's pipeline view.
-- Postgres requires enum additions outside a transaction; we use the safe
-- "do nothing if it already exists" form so the migration is idempotent.

do $$
begin
  alter type application_status add value if not exists 'ARCHIVED';
exception
  when duplicate_object then null;
end$$;

notify pgrst, 'reload schema';
