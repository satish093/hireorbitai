import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../Button';
import { Avatar } from '../TaskBits';
import { PresenceDot } from '../PresenceDot';
import { Popover } from '../ui/Popover';
import type { DashConsultant, DashApplication } from './types';
import { scoreConsultant, TONE_RANK, consultantName, type Urgency } from '../../utils/urgency';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ScoredItem {
  c: DashConsultant;
  u: Urgency;
}

// ---------------------------------------------------------------------------
// Kebab icon (3 vertical dots)
// ---------------------------------------------------------------------------

function KebabIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="currentColor"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="7" cy="2.5" r="1.25" />
      <circle cx="7" cy="7" r="1.25" />
      <circle cx="7" cy="11.5" r="1.25" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tone chip background classes
// ---------------------------------------------------------------------------

const TONE_CHIP_BG: Record<Urgency['tone'], string> = {
  urgent: 'bg-danger-soft',
  warning: 'bg-warn-soft',
  info: 'bg-accent-soft',
};

// ---------------------------------------------------------------------------
// AttentionCard
// ---------------------------------------------------------------------------

function AttentionCard({ c, u }: ScoredItem) {
  const navigate = useNavigate();

  return (
    <article className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-3">
      {/* ---- Top: avatar + name / skill ---- */}
      <div className="flex items-center gap-2.5">
        {/* Avatar with presence dot overlay */}
        <div className="relative shrink-0">
          <Avatar name={consultantName(c)} email={c.user?.email} size={36} />
          <PresenceDot
            lastSeenAt={c.user?.last_seen_at}
            className="absolute -bottom-0.5 -right-0.5"
          />
        </div>

        {/* Name + role */}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink truncate leading-tight">
            {consultantName(c)}
          </p>
          <p className="text-[11px] text-muted truncate leading-tight mt-0.5">
            {c.primary_skill ?? 'Consultant'}
          </p>
        </div>
      </div>

      {/* ---- Reason chip ---- */}
      <div className={`rounded-lg px-3 py-2 ${TONE_CHIP_BG[u.tone]}`}>
        <p className="text-[13px] font-semibold text-ink leading-snug">{u.headline}</p>
        <p className="text-[11px] text-muted mt-0.5 leading-snug">{u.detail}</p>
      </div>

      {/* ---- Footer: primary action + overflow menu ---- */}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          onClick={() => navigate(u.action.route)}
        >
          {u.action.label}
        </Button>

        <Popover
          align="right"
          button={(open) => (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="More actions"
              aria-expanded={open}
              leftIcon={<KebabIcon />}
            />
          )}
        >
          {(close) => (
            <div className="flex flex-col gap-0.5">
              {[
                { label: 'View profile', route: '/consultants' },
                { label: 'Message', route: '/messages' },
                { label: 'Find roles', route: '/jobs' },
              ].map((a) => (
                <Button
                  key={a.label}
                  variant="ghost"
                  size="sm"
                  block
                  className="!justify-start"
                  onClick={() => {
                    close();
                    navigate(a.route);
                  }}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </Popover>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// NeedsAttentionStrip — public export
// ---------------------------------------------------------------------------

export function NeedsAttentionStrip({
  consultants,
  apps,
}: {
  consultants: DashConsultant[];
  apps: DashApplication[];
}): JSX.Element | null {
  const navigate = useNavigate();

  // Build lookup: consultant_id → DashApplication[]
  const appsByConsultant = useMemo<Map<string, DashApplication[]>>(() => {
    const map = new Map<string, DashApplication[]>();
    for (const app of apps) {
      const key = app.consultant_id ?? '';
      if (!key) continue;
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(app);
      } else {
        map.set(key, [app]);
      }
    }
    return map;
  }, [apps]);

  // Score every consultant and keep non-null results
  const scored = useMemo<ScoredItem[]>(() => {
    const results: ScoredItem[] = [];
    for (const c of consultants) {
      const u = scoreConsultant(c, { appsByConsultant });
      if (u !== null) results.push({ c, u });
    }
    // Sort by tone rank first, then by recency (updated_at desc) as tiebreaker
    results.sort((a, b) => {
      const rankDiff = TONE_RANK[a.u.tone] - TONE_RANK[b.u.tone];
      if (rankDiff !== 0) return rankDiff;
      const aTime = a.c.updated_at ? new Date(a.c.updated_at).getTime() : 0;
      const bTime = b.c.updated_at ? new Date(b.c.updated_at).getTime() : 0;
      return bTime - aTime; // descending — most recently touched first
    });
    return results;
  }, [consultants, appsByConsultant]);

  const totalCount = scored.length;

  // Hide the section entirely when there's nothing to flag
  if (totalCount === 0) return null;

  const visible = scored.slice(0, 4);

  return (
    <section aria-label="Needs attention today">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">Needs attention today</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/consultants?filter=needs_attention')}
        >
          See all {totalCount}
        </Button>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {visible.map(({ c, u }) => (
          <AttentionCard key={c.id} c={c} u={u} />
        ))}
      </div>
    </section>
  );
}
