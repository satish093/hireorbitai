import { Link } from 'react-router-dom';
import { fmtMinutes, type ContinueLesson } from './types';

/**
 * Top hero on the My training tab — the user's nearest in-progress lesson with
 * a one-tap resume. Renders nothing when there's no active lesson (the parent
 * decides whether to show it).
 */
export function ContinueLearningHero({ lesson }: { lesson: ContinueLesson }) {
  return (
    <div
      className="rounded-2xl p-5 text-white overflow-hidden relative"
      style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
    >
      <div className="flex items-center gap-4">
        <div
          className="shrink-0 grid place-items-center rounded-xl bg-white/15 text-2xl"
          style={{ width: 60, height: 60 }}
          aria-hidden="true"
        >
          ▶
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-white/75">
            Continue learning · {lesson.percent}% complete
          </div>
          <div className="mt-0.5 text-white/80 text-sm truncate">{lesson.course_title}</div>
          <div className="text-lg font-semibold leading-tight truncate">
            {lesson.lesson_title ?? 'Next lesson'}
            {lesson.remaining_min ? (
              <span className="font-normal text-white/75 text-sm">
                {' '}
                · ~{fmtMinutes(lesson.remaining_min)} remaining
              </span>
            ) : null}
          </div>

          {/* Progress over a translucent track */}
          <div className="mt-3 h-1.5 rounded-full bg-white/20 overflow-hidden max-w-md">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${Math.min(100, Math.max(0, lesson.percent))}%` }}
            />
          </div>
        </div>

        <Link
          to={`/training/assignments/${lesson.assignment_id}`}
          className="shrink-0 inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-white text-accent font-medium text-sm hover:bg-white/90 press"
        >
          Resume lesson
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
