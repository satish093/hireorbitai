-- TalentBridge AI — desired employment types for a consultant
-- Idempotent: safe to re-run.

alter table public.consultants
  add column if not exists desired_positions text[];
