import { useEffect, useState, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Modal } from './Modal';
import { Pill, PillTone } from './Pill';
import { api } from '../services/api';

/**
 * Shared widgets for the Training module:
 *   TrainingCourseCard, LessonCard, TrainingProgressBar, QuizQuestionCard,
 *   AssignmentTable, TrainingStatusBadge, CourseCategoryBadge,
 *   AssignTrainingModal, FeedbackModal, VideoLessonPlayer, DocumentViewer.
 */

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------
// Training status tones, expressed as shared PillTone objects so the badges
// match every other status pill in the app (height, radius, dot, font).
const STATUS_TONE: Record<string, PillTone> = {
  NOT_STARTED: { bg: 'bg-hover', text: 'text-ink', dot: 'bg-muted' },
  IN_PROGRESS: {
    bg: 'bg-sky-50 dark:bg-sky-500/15',
    text: 'text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  COMPLETED: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  OVERDUE: {
    bg: 'bg-rose-50 dark:bg-rose-500/15',
    text: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  FAILED: {
    bg: 'bg-rose-50 dark:bg-rose-500/15',
    text: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  QUIZ_PENDING: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  ASSIGNMENT_PENDING: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  FINAL_ASSESSMENT_PENDING: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  MANAGER_REVIEW_PENDING: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  DRAFT: { bg: 'bg-hover', text: 'text-muted', dot: 'bg-muted' },
  ACTIVE: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  ARCHIVED: { bg: 'bg-hover', text: 'text-muted', dot: 'bg-muted' },
};
const STATUS_DEFAULT_TONE: PillTone = {
  bg: 'bg-hover',
  text: 'text-ink',
  dot: 'bg-muted',
};
// Active/waiting states get a soft pulsing dot so they draw the eye.
const STATUS_PULSING = new Set([
  'IN_PROGRESS',
  'QUIZ_PENDING',
  'ASSIGNMENT_PENDING',
  'FINAL_ASSESSMENT_PENDING',
  'MANAGER_REVIEW_PENDING',
]);
// Plain-language labels for the assignment + course statuses learners and
// managers see. Falls back to a de-underscored version for anything new.
const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  OVERDUE: 'Overdue',
  FAILED: 'Not passed',
  QUIZ_PENDING: 'Quiz to take',
  ASSIGNMENT_PENDING: 'Work to submit',
  FINAL_ASSESSMENT_PENDING: 'Final assessment due',
  MANAGER_REVIEW_PENDING: 'Awaiting manager review',
  DRAFT: 'Draft',
  ACTIVE: 'Published',
  ARCHIVED: 'Archived',
};
export function TrainingStatusBadge({ status }: { status: string }) {
  return (
    <Pill tone={STATUS_TONE[status] ?? STATUS_DEFAULT_TONE} pulseDot={STATUS_PULSING.has(status)}>
      {STATUS_LABEL[status] ?? status.replace(/_/g, ' ')}
    </Pill>
  );
}

const CATEGORY_TONE: Record<string, string> = {
  Java: 'bg-orange-50 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-100 dark:border-orange-500/20',
  'Spring Boot':
    'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20',
  React:
    'bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-100 dark:border-cyan-500/20',
  Angular:
    'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-500/20',
  'Node.js':
    'bg-lime-50 dark:bg-lime-500/15 text-lime-700 dark:text-lime-300 border-lime-100 dark:border-lime-500/20',
  'QA Automation':
    'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-100 dark:border-violet-500/20',
  Selenium:
    'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-100 dark:border-violet-500/20',
  Playwright:
    'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-100 dark:border-violet-500/20',
  Cypress:
    'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-100 dark:border-violet-500/20',
  DevOps:
    'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-100 dark:border-amber-500/20',
  AWS: 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-100 dark:border-amber-500/20',
  Azure:
    'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-100 dark:border-sky-500/20',
  SQL: 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-500/20',
  'Data Engineering':
    'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-500/20',
  'Data Science':
    'bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-100 dark:border-teal-500/20',
  'Machine Learning':
    'bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-100 dark:border-purple-500/20',
  AI: 'bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-100 dark:border-fuchsia-500/20',
  'Network Security':
    'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-100 dark:border-red-500/20',
  'Application Security':
    'bg-red-50 dark:bg-red-500/15 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30',
  Cybersecurity:
    'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-500/20',
  'Cloud Security':
    'bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-100 dark:border-orange-500/20',
  'Interview Preparation':
    'bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-100 dark:border-fuchsia-500/20',
  'Communication Skills':
    'bg-pink-50 dark:bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-100 dark:border-pink-500/20',
  'Resume Building':
    'bg-pink-50 dark:bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-100 dark:border-pink-500/20',
  'Banking Domain': 'bg-hover text-ink border-border',
  'Insurance Domain': 'bg-hover text-ink border-border',
  'Healthcare Domain': 'bg-hover text-ink border-border',
};
export function CourseCategoryBadge({ category }: { category: string }) {
  const tone = CATEGORY_TONE[category] ?? 'bg-hover text-ink border-border';
  return (
    <span
      className={clsx(
        'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border',
        tone,
      )}
    >
      {category}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------
export function TrainingProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const tone =
    pct >= 100
      ? 'bg-emerald-500'
      : pct >= 50
        ? 'bg-brand-500'
        : pct > 0
          ? 'bg-amber-400'
          : 'bg-muted';
  return (
    <div>
      {label && (
        <div className="flex justify-between text-[11px] text-muted mb-1">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-1.5 bg-hover rounded-full overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Course card
// ---------------------------------------------------------------------------
export interface CourseCardData {
  id: string;
  title: string;
  description?: string | null;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  estimated_duration_hours?: number | null;
  thumbnail_url?: string | null;
  tags?: string[];
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  content_status?: string | null;
  lessons?: { count: number }[];
  assignments?: { count: number }[];
}

// ---------------------------------------------------------------------------
// Course cover art
//
// Courses have no uploaded imagery (thumbnail_url is null for the seeded set),
// so we generate a deterministic SVG cover per course instead of shipping
// raster files. The gradient is keyed off the course category — matching the
// CourseCategoryBadge color families — and a hash of the course id rotates the
// gradient and seeds a few translucent motif circles, so two courses in the
// same category still look distinct. It's pure CSS-paint inside the card's
// aspect-video slot: zero network, zero storage, and theme-agnostic (the cover
// is its own saturated surface with white text, identical in light + dark).
// ---------------------------------------------------------------------------

// Vivid [from, to] gradient stops per category. Mirrors the hue families used
// by CATEGORY_TONE above so the cover and the badge read as the same color.
const CATEGORY_COVER: Record<string, [string, string]> = {
  Java: ['#fb923c', '#ea580c'],
  'Spring Boot': ['#10b981', '#059669'],
  React: ['#06b6d4', '#0891b2'],
  Angular: ['#fb7185', '#e11d48'],
  'Node.js': ['#84cc16', '#65a30d'],
  'QA Automation': ['#8b5cf6', '#7c3aed'],
  Selenium: ['#8b5cf6', '#7c3aed'],
  Playwright: ['#8b5cf6', '#7c3aed'],
  Cypress: ['#8b5cf6', '#7c3aed'],
  DevOps: ['#f59e0b', '#d97706'],
  AWS: ['#f59e0b', '#d97706'],
  Azure: ['#0ea5e9', '#0284c7'],
  SQL: ['#6366f1', '#4f46e5'],
  'Data Engineering': ['#6366f1', '#4f46e5'],
  'Data Science': ['#14b8a6', '#0d9488'],
  'Machine Learning': ['#a855f7', '#9333ea'],
  AI: ['#d946ef', '#c026d3'],
  'Network Security': ['#ef4444', '#dc2626'],
  'Application Security': ['#dc2626', '#b91c1c'],
  Cybersecurity: ['#fb7185', '#e11d48'],
  'Cloud Security': ['#fb923c', '#ea580c'],
  'Interview Preparation': ['#d946ef', '#c026d3'],
  'Communication Skills': ['#ec4899', '#db2777'],
  'Resume Building': ['#ec4899', '#db2777'],
  'Banking Domain': ['#64748b', '#475569'],
  'Insurance Domain': ['#64748b', '#475569'],
  'Healthcare Domain': ['#64748b', '#475569'],
};

// FNV-1a — small, fast, deterministic. Same input → same cover, every render.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Unknown categories fall back to a hue derived from the name, so a brand-new
// category still gets a stable, on-brand-looking gradient instead of grey.
function coverColors(category: string): [string, string] {
  const known = CATEGORY_COVER[category];
  if (known) return known;
  const hue = hashStr(category) % 360;
  return [`hsl(${hue} 68% 55%)`, `hsl(${(hue + 28) % 360} 72% 42%)`];
}

// Topic glyphs, drawn on a 24×24 grid (stroke-based, no fill) so the cover
// shows an *icon* rather than letters. Keyed by a small set of icon names that
// categories map onto below.
const ICON_PATHS: Record<string, string[]> = {
  shield: ['M12 2l7.5 3v6.5c0 4.6-3.2 7.9-7.5 9.5-4.3-1.6-7.5-4.9-7.5-9.5V5z', 'M9 11.5l2 2 4-4'],
  code: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4'],
  braces: [
    'M8 4c-1.6 0-2.5.9-2.5 2.5V9c0 1.1-.8 2-2 2 1.2 0 2 .9 2 2v2.5C5.5 19.1 6.4 20 8 20',
    'M16 4c1.6 0 2.5.9 2.5 2.5V9c0 1.1.8 2 2 2-1.2 0-2 .9-2 2v2.5c0 1.6-.9 2.5-2.5 2.5',
  ],
  check: ['M22 12a10 10 0 11-20 0 10 10 0 0120 0z', 'M8 12.5l2.5 2.5 5-5'],
  pipeline: [
    'M10 12a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z',
    'M21 12a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z',
  ],
  cloud: ['M7.5 19a4.5 4.5 0 01-.5-9 6 6 0 0111.4 1.4A4 4 0 0118 19z'],
  database: [
    'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z',
    'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
    'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  ],
  chart: ['M3 21h18', 'M6 21v-6', 'M11 21V8', 'M16 21v-10'],
  chip: [
    'M7 7h10v10H7z',
    'M10 10h4v4h-4z',
    'M9 7V4',
    'M15 7V4',
    'M9 20v-3',
    'M15 20v-3',
    'M7 9H4',
    'M7 15H4',
    'M20 9h-3',
    'M20 15h-3',
  ],
  chat: ['M20 12a8 8 0 01-8 8 8.5 8.5 0 01-3-.6L4 21l1.4-4.4A8 8 0 1120 12z'],
  document: [
    'M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V7z',
    'M14 3v4h4',
    'M9 12h6',
    'M9 16h4',
  ],
  building: [
    'M5 21V6l7-3 7 3v15',
    'M3 21h18',
    'M9 9h2',
    'M13 9h2',
    'M9 13h2',
    'M13 13h2',
    'M9 17h2',
    'M13 17h2',
  ],
  book: ['M5 4h12a1 1 0 011 1v15H7a2 2 0 01-2-2z', 'M5 18a2 2 0 002 2', 'M9 4v14'],
};

// Each category points at one glyph. Mirrors the CATEGORY_TONE families so the
// cover, icon, and badge all read as the same subject.
const CATEGORY_ICON: Record<string, string> = {
  Java: 'braces',
  'Spring Boot': 'braces',
  'Node.js': 'braces',
  React: 'code',
  Angular: 'code',
  'QA Automation': 'check',
  Selenium: 'check',
  Playwright: 'check',
  Cypress: 'check',
  DevOps: 'pipeline',
  AWS: 'cloud',
  Azure: 'cloud',
  SQL: 'database',
  'Data Engineering': 'database',
  'Data Science': 'chart',
  'Machine Learning': 'chip',
  AI: 'chip',
  'Network Security': 'shield',
  'Application Security': 'shield',
  Cybersecurity: 'shield',
  'Cloud Security': 'shield',
  'Interview Preparation': 'chat',
  'Communication Skills': 'chat',
  'Resume Building': 'document',
  'Banking Domain': 'building',
  'Insurance Domain': 'building',
  'Healthcare Domain': 'building',
};

function categoryIcon(category: string): string[] {
  return ICON_PATHS[CATEGORY_ICON[category] ?? 'book'] ?? ICON_PATHS.book!;
}

export function CourseCover({
  id,
  title,
  category,
}: {
  id: string;
  title: string;
  category: string;
}) {
  const [from, to] = coverColors(category);
  const h = hashStr(id || title);
  const gradId = `cv-${h.toString(36)}`;
  const angle = h % 360;
  // Derive motif-circle geometry from independent bytes of the hash. Circles
  // hug the corners so they never crowd the monogram.
  const b0 = h & 0xff;
  const b1 = (h >> 8) & 0xff;
  const b2 = (h >> 16) & 0xff;
  const b3 = (h >> 24) & 0xff;

  return (
    <svg
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      className="w-full h-full"
      role="img"
      aria-label={`${category} course cover`}
    >
      <defs>
        <linearGradient id={gradId} gradientTransform={`rotate(${angle} 0.5 0.5)`}>
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#${gradId})`} />
      <g fill="#ffffff">
        <circle cx={250 + (b0 % 70)} cy={20 + (b1 % 40)} r={46 + (b2 % 34)} opacity="0.10" />
        <circle cx={40 + (b2 % 60)} cy={150 + (b3 % 30)} r={26 + (b0 % 24)} opacity="0.08" />
        <circle cx={150 + (b3 % 120)} cy={90 + (b1 % 40)} r={14 + (b1 % 16)} opacity="0.07" />
      </g>
      {/* Topic glyph — drawn on a 24-grid, scaled up and stroked in white. */}
      <g
        transform="translate(28 26) scale(2.6)"
        fill="none"
        stroke="#ffffff"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.96"
      >
        {categoryIcon(category).map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <text
        x="30"
        y="150"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="12.5"
        fontWeight="700"
        letterSpacing="1.6"
        fill="#ffffff"
        opacity="0.85"
      >
        {category.toUpperCase()}
      </text>
    </svg>
  );
}

export function TrainingCourseCard({
  course,
  to,
  action,
}: {
  course: CourseCardData;
  to?: string;
  action?: ReactNode;
}) {
  const inner = (
    <div className="bg-surface border border-border rounded-xl overflow-hidden hover:border-brand-300 hover:shadow-sm transition flex flex-col h-full">
      <div className="aspect-video bg-hover overflow-hidden">
        {course.thumbnail_url ? (
          <img
            src={course.thumbnail_url}
            alt={course.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <CourseCover id={course.id} title={course.title} category={course.category} />
        )}
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <CourseCategoryBadge category={course.category} />
          <TrainingStatusBadge status={course.status} />
          {course.content_status &&
            course.content_status !== 'NONE' &&
            course.content_status !== 'READY' && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">
                {course.content_status === 'OUTLINE_READY'
                  ? 'needs content'
                  : course.content_status}
              </span>
            )}
          <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">
            {course.difficulty}
          </span>
        </div>
        <h3 className="text-base font-semibold text-ink leading-tight">{course.title}</h3>
        {course.description && (
          <p className="text-sm text-muted mt-1 line-clamp-2">{course.description}</p>
        )}
        <div className="mt-auto pt-3 flex items-center justify-between text-xs text-muted">
          <span>
            {course.lessons?.[0]?.count ?? 0} lessons · {course.assignments?.[0]?.count ?? 0}{' '}
            assigned
          </span>
          {typeof course.estimated_duration_hours === 'number' && (
            <span>~{course.estimated_duration_hours}h</span>
          )}
        </div>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ---------------------------------------------------------------------------
// Lesson card
// ---------------------------------------------------------------------------
export interface LessonRow {
  id: string;
  title: string;
  description?: string | null;
  estimated_minutes?: number | null;
  lesson_order: number;
  video_url?: string | null;
  document_url?: string | null;
}
export function LessonCard({
  lesson,
  completed,
  onToggle,
}: {
  lesson: LessonRow;
  completed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-lg p-3 flex items-start gap-3">
      <button
        onClick={onToggle}
        className={clsx(
          'w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center text-[10px] shrink-0 transition',
          completed
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'border-border hover:border-brand-500',
        )}
        title={completed ? 'Mark not completed' : 'Mark completed'}
      >
        {completed ? '✓' : ''}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-muted tabular-nums">
            #{lesson.lesson_order + 1}
          </span>
          <h4
            className={clsx(
              'text-sm font-semibold leading-tight',
              completed && 'line-through text-muted',
            )}
          >
            {lesson.title}
          </h4>
        </div>
        {lesson.description && (
          <p className="text-xs text-muted mt-0.5 truncate">{lesson.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted">
          {lesson.video_url && <span>🎬 video</span>}
          {lesson.document_url && <span>📄 doc</span>}
          {typeof lesson.estimated_minutes === 'number' && (
            <span>· {lesson.estimated_minutes} min</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz question card
// ---------------------------------------------------------------------------
export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  points?: number;
}
export function QuizQuestionCard({
  question,
  selected,
  onChange,
  result,
}: {
  question: QuizQuestion;
  selected: string | null;
  onChange: (v: string) => void;
  result?: { is_correct: boolean; correct_answer: string; explanation?: string };
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="text-sm font-semibold text-ink mb-3">{question.question}</div>
      <div className="space-y-2">
        {question.options.map((opt) => {
          const isPicked = selected === opt;
          const isCorrect = result?.correct_answer === opt;
          const isWrongPick = !!result && isPicked && !result.is_correct;
          return (
            <label
              key={opt}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition',
                isPicked && !result && 'border-brand-400 bg-brand-50',
                !isPicked && !result && 'border-border hover:bg-hover',
                result &&
                  isCorrect &&
                  'border-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-900',
                isWrongPick && 'border-rose-300 bg-rose-50 dark:bg-rose-500/15 text-rose-900',
                result && !isCorrect && !isWrongPick && 'border-border text-muted',
              )}
            >
              <input
                type="radio"
                className="hidden"
                checked={isPicked}
                onChange={() => onChange(opt)}
                disabled={!!result}
              />
              <span
                className={clsx(
                  'w-4 h-4 rounded-full border-2 flex-shrink-0',
                  isPicked ? 'border-brand-500 bg-brand-500' : 'border-border',
                )}
              />
              <span>{opt}</span>
              {result && isCorrect && (
                <span className="ml-auto text-xs font-semibold">Correct</span>
              )}
              {isWrongPick && <span className="ml-auto text-xs font-semibold">Your pick</span>}
            </label>
          );
        })}
      </div>
      {result?.explanation && (
        <div className="mt-3 text-xs text-muted bg-hover border border-border rounded-lg p-3">
          <strong className="text-ink">Explanation:</strong> {result.explanation}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignment table
// ---------------------------------------------------------------------------
export interface AssignmentRow {
  id: string;
  course?: { id: string; title: string; category: string } | null;
  assignee?: { id: string; full_name: string | null; email: string; role: string } | null;
  due_date: string | null;
  status: string;
  progress_percentage: number;
  completed_at: string | null;
}
export function AssignmentTable({
  rows,
  includeAssignee = true,
  viewBase = '/training/assignments',
}: {
  rows: AssignmentRow[];
  includeAssignee?: boolean;
  viewBase?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-10 text-center text-muted italic">
        No assignments.
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-hover text-[10px] font-semibold uppercase tracking-widest text-muted">
          <tr>
            <th className="text-left px-4 py-2.5">Course</th>
            {includeAssignee && <th className="text-left px-3 py-2.5">Assignee</th>}
            <th className="text-left px-3 py-2.5">Due</th>
            <th className="text-left px-3 py-2.5">Status</th>
            <th className="text-left px-3 py-2.5 w-48">Progress</th>
            <th className="text-right px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((a) => (
            <tr key={a.id} className="hover:bg-hover">
              <td className="px-4 py-2.5">
                <Link
                  to={`${viewBase}/${a.id}`}
                  className="font-medium text-ink hover:text-brand-700"
                >
                  {a.course?.title ?? '—'}
                </Link>
                {a.course?.category && (
                  <div className="mt-0.5">
                    <CourseCategoryBadge category={a.course.category} />
                  </div>
                )}
              </td>
              {includeAssignee && (
                <td className="px-3 py-2.5">
                  <div className="text-sm text-ink truncate">
                    {a.assignee?.full_name ?? a.assignee?.email ?? '—'}
                  </div>
                  {a.assignee?.role && (
                    <div className="text-[10px] uppercase tracking-wider text-muted">
                      {a.assignee.role}
                    </div>
                  )}
                </td>
              )}
              <td className="px-3 py-2.5 text-xs tabular-nums">{a.due_date ?? '—'}</td>
              <td className="px-3 py-2.5">
                <TrainingStatusBadge status={a.status} />
              </td>
              <td className="px-3 py-2.5">
                <TrainingProgressBar value={a.progress_percentage} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Link
                  to={`${viewBase}/${a.id}`}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign Training modal
// ---------------------------------------------------------------------------
interface UserLite {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

export function AssignTrainingModal({
  open,
  onClose,
  courseId,
  onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  courseId: string;
  onAssigned: () => void;
}) {
  const [users, setUsers] = useState<UserLite[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reuse the consultants endpoint as the source of assignable users —
    // it includes embedded user info already.
    api
      .get('/consultants', { params: {} })
      .then((r) =>
        setUsers(
          (r.data ?? [])
            .map((c: any) => ({
              id: c.user?.id,
              full_name: c.user?.full_name,
              email: c.user?.email,
              role: c.user?.role ?? 'CONSULTANT',
            }))
            .filter((u: UserLite) => u.id),
        ),
      )
      .catch(() => {
        /* silent — managers can paste IDs if /consultants is empty */
      });
  }, [open]);

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save() {
    if (picked.size === 0) {
      toast.error('Pick at least one user');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/training/assign', {
        course_id: courseId,
        user_ids: Array.from(picked),
        due_date: dueDate || null,
      });
      toast.success(
        `${r.data.created.length} assigned${r.data.skipped.length ? `, ${r.data.skipped.length} already had it` : ''}`,
      );
      setPicked(new Set());
      setDueDate('');
      onAssigned();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to assign');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign training"
      footer={
        <button
          onClick={save}
          disabled={busy}
          className="bg-ink text-bg text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Assigning…' : `Assign ${picked.size || ''}`.trim()}
        </button>
      }
    >
      <label className="block mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Due date (optional)
        </span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
        />
      </label>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
        Select users
      </div>
      <div className="max-h-72 overflow-y-auto border border-border rounded-lg divide-y divide-border">
        {users.length === 0 && (
          <div className="p-3 text-xs italic text-muted">No users loaded.</div>
        )}
        {users.map((u) => (
          <label
            key={u.id}
            className="flex items-center gap-2 px-3 py-2 hover:bg-hover cursor-pointer"
          >
            <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink truncate">{u.full_name ?? u.email}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted">{u.role}</div>
            </div>
          </label>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Feedback modal
// ---------------------------------------------------------------------------
export function FeedbackModal({
  open,
  onClose,
  assignmentId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  onSaved: () => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [rating, setRating] = useState(5);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!feedback.trim()) {
      toast.error('Feedback is required');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/training/assignments/${assignmentId}/feedback`, { feedback, rating });
      toast.success('Feedback saved');
      setFeedback('');
      setRating(5);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manager feedback"
      footer={
        <button
          onClick={save}
          disabled={busy}
          className="bg-ink text-bg text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
            Rating
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                className={clsx(
                  'w-9 h-9 rounded-md border text-base',
                  n <= rating
                    ? 'bg-amber-100 dark:bg-amber-500/20 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300'
                    : 'border-border text-muted',
                )}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Feedback
          </span>
          <textarea
            rows={6}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
            placeholder="What did they do well? What should they improve?"
          />
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// VideoLessonPlayer — handles YouTube embed-style URL or raw mp4.
// ---------------------------------------------------------------------------
export function VideoLessonPlayer({ url }: { url: string }) {
  const isYT = /youtube\.com\/watch\?v=|youtu\.be\//.test(url);
  if (isYT) {
    const id = url.split(/v=|youtu\.be\//)[1]?.split(/[&?]/)[0];
    return (
      <div className="aspect-video w-full bg-black rounded-xl overflow-hidden">
        <iframe
          className="w-full h-full"
          src={`https://www.youtube.com/embed/${id}`}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return <video controls src={url} className="w-full max-h-[60dvh] rounded-xl bg-black" />;
}

// ---------------------------------------------------------------------------
// DocumentViewer — iframe-embeds PDFs/docs.
// ---------------------------------------------------------------------------
export function DocumentViewer({ url }: { url: string }) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <iframe src={url} className="w-full h-[70dvh]" title="Document" />
      <div className="px-3 py-2 text-xs text-muted bg-hover border-t border-border">
        <a href={url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
          Open in new tab ↗
        </a>
      </div>
    </div>
  );
}
