import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import { TrainingTabs } from '../components/training/TrainingTabs';
import { MyTrainingView } from '../components/training/MyTrainingView';
import { StudyPlanView } from '../components/training/StudyPlanView';
import { CatalogView } from '../components/training/CatalogView';
import { AchievementsView } from '../components/training/AchievementsView';
import type { TrainingTab } from '../components/training/types';

/**
 * Learning workspace at /training. One tabbed surface (My training · Study plan
 * · Catalog · Achievements); the tab lives in `?tab=` so it's shareable. Each
 * tab owns its own data fetching.
 */
export function MyTraining() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TrainingTab) || 'mine';
  const setTab = (t: TrainingTab) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === 'mine') next.delete('tab');
        else next.set('tab', t);
        return next;
      },
      { replace: false },
    );

  const [hours, setHours] = useState<number | null>(null);
  // assignments fetched here so StudyPlanView can link plan items to the right assignment
  const [assignmentsByCourseId, setAssignmentsByCourseId] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/training/activity', { params: { days: 30 } }).catch(() => ({ data: null })),
      api.get('/training/my-training').catch(() => ({ data: [] })),
    ]).then(([act, asgn]) => {
      if (!alive) return;
      const total = (act.data?.series ?? []).reduce(
        (a: number, s: { minutes: number }) => a + s.minutes,
        0,
      );
      setHours(total / 60);
      const map: Record<string, string> = {};
      for (const a of asgn.data ?? []) {
        if (a.course_id) map[a.course_id] = a.id;
      }
      setAssignmentsByCourseId(map);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Layout
      title="Training"
      crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Training' }]}
    >
      <PageHeader
        title="Learning"
        description="Your courses, an AI study plan, the catalog, and what you've earned."
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => setTab('achievements')}>
              Certificates
            </Button>
            <Button variant="primary" size="sm" onClick={() => setTab('plan')}>
              ✦ AI study plan
            </Button>
          </>
        }
      />

      <TrainingTabs active={tab} onTab={setTab} hoursLogged={hours} />

      {tab === 'mine' ? (
        <MyTrainingView onBrowseCatalog={() => setTab('catalog')} />
      ) : tab === 'plan' ? (
        <StudyPlanView assignmentsByCourseId={assignmentsByCourseId} />
      ) : tab === 'catalog' ? (
        <CatalogView />
      ) : (
        <AchievementsView />
      )}
    </Layout>
  );
}
