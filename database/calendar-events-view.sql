-- ---------------------------------------------------------------------------
-- calendar-events-view.sql
--
-- Convenience read view that UNION ALLs a normalized "calendar event" shape
-- across the time-bearing tables that exist today: interviews, reminders, and
-- tasks (by due date). It is intended for FUTURE unified calendar querying.
--
-- The app currently still reads /interviews and /reminders directly; nothing
-- depends on this view yet. It is applied MANUALLY by an operator (psql -f),
-- not by node-pg-migrate.
--
-- Idempotent: CREATE OR REPLACE VIEW. Re-running is safe.
--
-- Schema assumptions (verified against database/schema.sql):
--   public.interviews(id, type, scheduled_at, duration_minutes, is_mock,
--                     consultant_id, status)
--   public.reminders(id, title, due_at, status)
--   public.tasks(id, title, due_at, status, related_consultant_id)
--
-- If a table or column is absent in some environment, that arm of the UNION
-- will fail to create — drop the offending arm before applying there. The
-- enum-typed status / type columns are cast to text so the unioned column is
-- a single, stable type.
-- ---------------------------------------------------------------------------

create or replace view public.calendar_events as
  -- Interviews (incl. mock interviews via is_mock = true; there is no separate
  -- mock_interviews table — mocks live in public.interviews with is_mock=true).
  select
    i.id                                  as id,
    'interview'::text                     as source,
    coalesce(i.type::text, 'Interview')   as title,
    i.scheduled_at                        as start_at,
    coalesce(i.duration_minutes, 60)      as duration_min,
    i.is_mock                             as is_mock,
    i.consultant_id                       as consultant_id,
    i.status::text                        as status
  from public.interviews i

  union all

  -- Reminders (no consultant scoping column; fixed 30-minute slot).
  select
    r.id                                  as id,
    'reminder'::text                      as source,
    r.title                               as title,
    r.due_at                              as start_at,
    30                                    as duration_min,
    false                                 as is_mock,
    null::uuid                            as consultant_id,
    r.status::text                        as status
  from public.reminders r

  union all

  -- Tasks with a due date (tasks.due_at is nullable — only surface dated tasks).
  select
    t.id                                  as id,
    'task'::text                          as source,
    t.title                               as title,
    t.due_at                              as start_at,
    30                                    as duration_min,
    false                                 as is_mock,
    t.related_consultant_id               as consultant_id,
    t.status::text                        as status
  from public.tasks t
  where t.due_at is not null;

comment on view public.calendar_events is
  'Convenience read-only view normalizing interviews/reminders/tasks into a '
  'unified calendar-event shape. For future unified querying; the app still '
  'reads /interviews + /reminders directly. Applied manually via psql.';
