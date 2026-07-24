-- HireOrbit AI — Training achievements (gamification registry).
--
-- Two tables:
--   training_achievements        — the catalog of earnable badges (admin-seeded)
--   training_user_achievements   — which user earned which, and when
--
-- Earning is evaluated server-side in services/trainingAchievements.service.ts
-- on lesson completion + quiz pass; the frontend only reads the joined result
-- via GET /training/achievements (earned rows have earned_at, the rest null).
--
-- Idempotent: create-if-not-exists + ON CONFLICT seed. Safe to re-run.

create table if not exists public.training_achievements (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,                    -- stable code, e.g. 'first_lesson'
  title       text not null,
  description text not null,
  criteria_json jsonb not null default '{}'::jsonb,    -- { type, threshold } for the engine
  tone        text not null default 'accent',          -- accent | success | warn | danger
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.training_user_achievements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  achievement_id uuid not null references public.training_achievements(id) on delete cascade,
  earned_at      timestamptz not null default now(),
  unique (user_id, achievement_id)
);
create index if not exists training_user_achievements_user_idx
  on public.training_user_achievements (user_id);

-- Seed the registry. ON CONFLICT (key) keeps titles/criteria current on re-run.
insert into public.training_achievements (key, title, description, criteria_json, tone, sort_order)
values
  ('first_lesson',    'First steps',     'Complete your very first lesson.',                '{"type":"lessons_completed","threshold":1}',  'accent',  10),
  ('quiz_ace',        'Quiz ace',        'Score 100% on a quiz.',                            '{"type":"quiz_perfect","threshold":1}',       'warn',    20),
  ('course_finisher', 'Course finisher', 'Complete a full course end to end.',               '{"type":"courses_completed","threshold":1}',  'success', 30),
  ('compliant',       'Compliant',       'Complete a required compliance course.',           '{"type":"compliance_completed","threshold":1}','success', 40),
  ('streak_7',        'On a roll',       'Study on 7 different days.',                        '{"type":"study_days","threshold":7}',         'accent',  50),
  ('scholar',         'Scholar',         'Complete five courses.',                           '{"type":"courses_completed","threshold":5}',  'success', 60),
  ('marathon',        'Marathon',        'Log 20 hours of study time.',                      '{"type":"study_minutes","threshold":1200}',   'warn',    70),
  ('perfectionist',   'Perfectionist',   'Pass three quizzes at 100%.',                      '{"type":"quiz_perfect","threshold":3}',       'danger',  80)
on conflict (key) do update
  set title = excluded.title,
      description = excluded.description,
      criteria_json = excluded.criteria_json,
      tone = excluded.tone,
      sort_order = excluded.sort_order;
