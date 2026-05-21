import clsx from 'clsx';

export const SOURCE_TONE: Record<string, string> = {
  remoteok:
    'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-500/20',
  greenhouse:
    'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20',
  lever:
    'bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-100 dark:border-purple-500/20',
  adzuna:
    'bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-100 dark:border-orange-500/20',
  remotive:
    'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-100 dark:border-sky-500/20',
  arbeitnow:
    'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-100 dark:border-amber-500/20',
  jsearch:
    'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-500/20',
  ashby:
    'bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-100 dark:border-fuchsia-500/20',
  jooble:
    'bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-100 dark:border-cyan-500/20',
  usajobs:
    'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-500/20',
  serpapi:
    'bg-yellow-50 dark:bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 border-yellow-100 dark:border-yellow-500/20',
  searchapi:
    'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-100 dark:border-violet-500/20',
  linkedin:
    'bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',
  monster:
    'bg-violet-100 dark:bg-violet-500/20 text-violet-800 dark:text-violet-300 border-violet-200 dark:border-violet-500/30',
  manual: 'bg-hover text-ink border-border',
};
export const SOURCE_LABEL: Record<string, string> = {
  remoteok: 'RemoteOK',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  adzuna: 'Adzuna',
  remotive: 'Remotive',
  arbeitnow: 'Arbeitnow',
  jsearch: 'JSearch (Indeed / LinkedIn)',
  ashby: 'Ashby',
  jooble: 'Jooble',
  usajobs: 'USAJobs',
  serpapi: 'SerpAPI Google Jobs',
  searchapi: 'SearchApi.io Google Jobs',
  linkedin: 'LinkedIn',
  monster: 'Monster',
  manual: 'Manual',
};

export function SourceBadge({ source }: { source: string }) {
  const tone = SOURCE_TONE[source] ?? 'bg-hover text-ink border-border';
  return (
    <span
      className={clsx(
        'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border',
        tone,
      )}
    >
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

// Publisher = the user-facing job board (LinkedIn, Dice, Monster, …).
// Distinct from `source`, which is the ingestion driver (e.g. JSearch).
export const PUBLISHER_TONE: Record<string, string> = {
  LinkedIn:
    'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-100 dark:border-sky-500/20',
  Dice: 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-100 dark:border-red-500/20',
  Monster:
    'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-100 dark:border-violet-500/20',
  CareerBuilder:
    'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/20',
  Indeed:
    'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-500/20',
  Glassdoor:
    'bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-100 dark:border-teal-500/20',
  ZipRecruiter:
    'bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-100 dark:border-orange-500/20',
};

export function PublisherBadge({ publisher }: { publisher: string }) {
  const tone = PUBLISHER_TONE[publisher] ?? 'bg-hover text-ink border-border';
  return (
    <span
      className={clsx(
        'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border',
        tone,
      )}
    >
      {publisher}
    </span>
  );
}
