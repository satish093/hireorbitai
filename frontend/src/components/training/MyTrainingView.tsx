import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Button } from '../Button';
import { SkeletonCard } from '../Skeleton';
import { EmptyState } from '../EmptyState';
import { ContinueLearningHero } from './ContinueLearningHero';
import { CourseGroup } from './CourseGroup';
import { CourseRow } from './CourseRow';
import { ComplianceCard } from './ComplianceCard';
import { StreakCard } from './StreakCard';
import {
  GROUP_LABEL,
  groupForStatus,
  type ActivityResp,
  type ComplianceItem,
  type ContinueLesson,
  type GroupKey,
  type MyAssignment,
} from './types';

const GROUP_ORDER: GroupKey[] = ['in_progress', 'up_next', 'completed'];

export function MyTrainingView({ onBrowseCatalog }: { onBrowseCatalog: () => void }) {
  const [rows, setRows] = useState<MyAssignment[]>([]);
  const [cont, setCont] = useState<ContinueLesson | null>(null);
  const [compliance, setCompliance] = useState<{ items: ComplianceItem[]; due_soon: number }>({
    items: [],
    due_soon: 0,
  });
  const [activity, setActivity] = useState<ActivityResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api.get('/training/my-training').catch(() => ({ data: [] })),
      api.get('/training/continue').catch(() => ({ data: null })),
      api.get('/training/compliance').catch(() => ({ data: { items: [], due_soon: 0 } })),
      api.get('/training/activity', { params: { days: 14 } }).catch(() => ({ data: null })),
    ])
      .then(([r, c, comp, act]) => {
        if (!alive) return;
        setRows(r.data ?? []);
        setCont(c.data ?? null);
        setCompliance(comp.data ?? { items: [], due_soon: 0 });
        setActivity(act.data ?? null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <SkeletonCard lines={6} />
        <SkeletonCard lines={4} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="🎓"
        title="No training yet"
        description="Browse the catalog and enrol in your first course to get started."
        action={
          <Button variant="primary" onClick={onBrowseCatalog}>
            Browse catalog
          </Button>
        }
      />
    );
  }

  const byGroup = new Map<GroupKey, MyAssignment[]>(GROUP_ORDER.map((k) => [k, []]));
  for (const a of rows) byGroup.get(groupForStatus(a.status))?.push(a);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
      <div className="space-y-4 min-w-0">
        {cont && <ContinueLearningHero lesson={cont} />}
        <div className="space-y-1">
          {GROUP_ORDER.map((key) => {
            const list = byGroup.get(key) ?? [];
            if (list.length === 0) return null;
            return (
              <CourseGroup
                key={key}
                groupKey={key}
                label={GROUP_LABEL[key]}
                count={list.length}
                defaultCollapsed={key === 'completed'}
              >
                {list.map((a) => (
                  <CourseRow key={a.id} a={a} />
                ))}
              </CourseGroup>
            );
          })}
        </div>
      </div>

      <aside className="space-y-4">
        <ComplianceCard items={compliance.items} dueSoon={compliance.due_soon} />
        {activity && <StreakCard activity={activity} />}
      </aside>
    </div>
  );
}
