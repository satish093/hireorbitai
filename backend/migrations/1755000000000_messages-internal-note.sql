-- HireOrbit AI — internal-note messages.
--
-- Adds a boolean `is_internal` flag to direct messages. An internal note is a
-- staff-only annotation inside a thread (e.g. a recruiter jotting context about
-- a consultant). The hard rule, enforced in messages.controller on send AND on
-- every read path (thread / conversations / unread-count / realtime push):
--
--   A CONSULTANT must NEVER see an internal note.
--
-- Only non-consultant senders may create one; consultant viewers have them
-- filtered server-side before the response is built, and the realtime push to a
-- consultant recipient is suppressed. Staff↔staff internal notes are visible to
-- both staff parties.
--
-- Idempotent: safe to re-run.

alter table public.messages
  add column if not exists is_internal boolean not null default false;
